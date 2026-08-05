/**
 * The member service agent, as a loop rather than a lookup.
 *
 * The earlier version routed a question to a fixed set of tool calls and wrote
 * the answer from what came back. That is a good design and it is most of what
 * this still is. What it could not do is react: if the formulary said a drug
 * needed prior authorisation, the answer said so and stopped, because the
 * decision about which tools to call had already been made before any of them
 * ran.
 *
 * This version decides one call at a time and looks at the result before
 * deciding the next. That is the whole difference, and it is the difference
 * between "this needs prior authorisation" and "this needs prior
 * authorisation, yours was approved on the fourth of March, and it runs to the
 * end of June".
 *
 * The constraint from the earlier version is unchanged and is the reason this
 * agent is allowed to talk to members at all: it selects tools and narrates
 * what they return. It computes nothing. Every figure in every answer came
 * back from a function that reads the same book the claim was adjudicated
 * against.
 */

import { prisma } from "@/lib/db";
import { startRun } from "../runtime";
import { planCalls, type PlannedCall } from "@/lib/agent/plan";
import { TOOL_REGISTRY } from "@/lib/agent/tools";
import { compose, clinicalRefusal, type ToolRun } from "@/lib/agent/compose";
import type { ToolResult } from "@/lib/agent/tools";

const MAX_CALLS = 6;

type Data = Record<string, unknown>;

/**
 * What to do about what just came back.
 *
 * Each rule is a thing a good representative does without being asked: they
 * hear "prior authorisation required" and reach for the member's requests
 * before the member has to ask a second question. The rule fires on the
 * observation, not on the question, which is why it works on questions nobody
 * anticipated.
 */
interface FollowUp {
  id: string;
  /** The tool whose result might trigger this. */
  after: string;
  when: (data: Data, ctx: Ctx) => boolean;
  build: (data: Data, ctx: Ctx) => PlannedCall;
}

interface Ctx {
  memberId: string;
  drug: string | null;
  called: Set<string>;
}

const FOLLOW_UPS: FollowUp[] = [
  {
    id: "coverage-needs-pa",
    after: "checkCoverage",
    when: (d, c) =>
      d.priorAuthorizationRequired === true && !c.called.has("getPriorAuthStatus"),
    build: (_d, c) => ({
      tool: "getPriorAuthStatus",
      args: { memberId: c.memberId },
      because:
        "The formulary says this product needs prior authorisation, so the next thing the member needs to know is whether theirs is already approved.",
    }),
  },
  {
    id: "coverage-needs-step",
    after: "checkCoverage",
    when: (d, c) =>
      (d.stepTherapyRequired === true || d.planExclusion === true) &&
      !c.called.has("findAlternatives"),
    build: (d, c) => ({
      tool: "findAlternatives",
      args: { memberId: c.memberId, drugName: (d.drug as string) ?? c.drug ?? "" },
      because:
        "The plan will not pay for this as things stand, so an answer that stops there leaves the member with nothing to do next. Find what it does pay for.",
    }),
  },
  {
    id: "no-approved-pa",
    after: "getPriorAuthStatus",
    when: (d, c) =>
      Array.isArray(d.requests) &&
      (d.requests as unknown[]).length === 0 &&
      Boolean(c.drug) &&
      !c.called.has("explainCriteria"),
    build: (_d, c) => ({
      tool: "explainCriteria",
      args: { drugName: c.drug ?? "" },
      because:
        "There is no request on file, so the useful thing is what the prescriber will have to document to get one approved.",
    }),
  },
  {
    id: "denied-pa",
    after: "getPriorAuthStatus",
    when: (d, c) => {
      const reqs = (d.requests as { status?: string }[] | undefined) ?? [];
      return (
        reqs.some((r) => r.status === "Denied") && !c.called.has("findAlternatives")
      );
    },
    build: (_d, c) => ({
      tool: "findAlternatives",
      args: { memberId: c.memberId, drugName: c.drug ?? "" },
      because:
        "A request was denied. The member's next question is always what the plan will cover instead, so answer it before it is asked.",
    }),
  },
  {
    id: "too-soon",
    after: "refillEligibility",
    when: (d, c) => d.eligible === false && !c.called.has("findPharmacies"),
    build: () => ({
      tool: "findPharmacies",
      args: { limit: 4 },
      because:
        "The refill is too early at the usual pharmacy. A vacation supply is handled at the counter, so the member needs somewhere to take that request.",
    }),
  },
  {
    id: "specialty-channel",
    after: "estimateCost",
    when: (d, c) =>
      d.specialtyPharmacyRequired === true && !c.called.has("findPharmacies"),
    build: () => ({
      tool: "findPharmacies",
      args: { limit: 3, specialtyOnly: true },
      because:
        "This product can only be dispensed through a specialty pharmacy, so the quote is no use without the two places that can fill it.",
    }),
  },
];

export interface MemberAnswer {
  runId: string;
  question: string;
  intent: string;
  drug: string | null;
  paragraphs: string[];
  citations: ReturnType<typeof compose>["citations"];
  links: { label: string; href: string }[];
  handoff: string | null;
  /** Everything a person needs if this goes to them, assembled in advance. */
  handoffPacket: HandoffPacket | null;
  work: {
    tool: string;
    because: string;
    args: unknown;
    error: string | null;
    summary: string | null;
    data: unknown;
    citations: unknown[];
    /** True when the call was chosen after seeing an earlier result. */
    followUp: boolean;
  }[];
  autonomy: string;
  elapsedMs: number;
}

export interface HandoffPacket {
  reason: string;
  memberName: string;
  cardholderId: string;
  question: string;
  /** What the agent already established, so nobody asks the member twice. */
  established: string[];
  suggestedOwner: string;
}

export async function answerMember(opts: {
  question: string;
  memberId: string;
  at?: Date;
  persist?: boolean;
}): Promise<MemberAnswer> {
  const started = Date.now();
  const run = await startRun({
    agentId: "member-service",
    goal: opts.question,
    subject: { type: "Member", id: opts.memberId },
    at: opts.at,
  });

  const plan = await planCalls(opts.question, opts.memberId);
  const ctx: Ctx = { memberId: opts.memberId, drug: plan.drug, called: new Set() };

  const refusal = clinicalRefusal(opts.question);
  if (refusal) {
    run.refuse(
      "Clinical question. Handed to the prescriber, not answered.",
      "Whether a medication is right for somebody is not a question the plan's data can answer, and answering it from coverage data would be worse than not answering it.",
    );
    const packet = await buildPacket(
      opts.memberId,
      opts.question,
      "Clinical question, outside what the plan can answer",
      [],
      "The member's prescriber",
    );
    run.propose({
      subjectType: "MemberQuestion",
      subjectId: opts.memberId,
      action: "handoff",
      headline: "Refused and handed off: clinical question.",
      rationale:
        "The question asks whether a medication is appropriate for this person. The agent has coverage data, not a clinical relationship, and says so.",
      payload: packet,
      confidence: 0.99,
    });
    if (opts.persist !== false) {
      await run.finish("Refused", "Clinical question. Referred to the prescriber.");
    }
    return {
      runId: run.id,
      question: opts.question,
      intent: "clinical-refusal",
      drug: plan.drug,
      paragraphs: [refusal],
      citations: [],
      links: [],
      handoff: "clinical",
      handoffPacket: packet,
      work: [],
      autonomy: run.autonomy,
      elapsedMs: Date.now() - started,
    };
  }

  const queue: (PlannedCall & { followUp?: boolean })[] = [...plan.calls];
  const runs: ToolRun[] = [];
  const work: MemberAnswer["work"] = [];

  while (queue.length > 0 && work.length < MAX_CALLS) {
    const call = queue.shift()!;
    if (ctx.called.has(call.tool)) continue;
    ctx.called.add(call.tool);

    const def = TOOL_REGISTRY[call.tool as keyof typeof TOOL_REGISTRY];
    const parsed = def.schema.safeParse(call.args);
    if (!parsed.success) {
      const error = parsed.error.issues.map((i) => i.message).join("; ");
      runs.push({ tool: call.tool, args: call.args, because: call.because, error, result: null });
      work.push({
        tool: call.tool,
        because: call.because,
        args: call.args,
        error,
        summary: null,
        data: null,
        citations: [],
        followUp: Boolean(call.followUp),
      });
      continue;
    }

    const exec = def.execute as (a: unknown) => Promise<ToolResult<Data>>;
    const result = await run.tool(
      call.tool,
      call.because,
      () => exec(parsed.data),
      (r) => r.summary,
    );

    runs.push({
      tool: call.tool,
      args: parsed.data,
      because: call.because,
      error: null,
      result,
    });
    work.push({
      tool: call.tool,
      because: call.because,
      args: parsed.data,
      error: null,
      summary: result.summary,
      data: result.data,
      citations: result.citations,
      followUp: Boolean(call.followUp),
    });

    // Look at what came back before choosing what to do next. This is the part
    // the one-shot planner could not do.
    for (const rule of FOLLOW_UPS) {
      if (rule.after !== call.tool) continue;
      if (!rule.when(result.data, ctx)) continue;
      const next = rule.build(result.data, ctx);
      if (ctx.called.has(next.tool)) continue;
      queue.push({ ...next, followUp: true });
    }
  }

  const answer = compose(opts.question, plan.intent, runs);

  const answered =
    answer.paragraphs.length > 0 && !answer.handoff && runs.some((r) => !r.error);
  let packet: HandoffPacket | null = null;
  if (!answered) {
    packet = await buildPacket(
      opts.memberId,
      opts.question,
      answer.handoff ?? "The agent could not answer from the plan's data.",
      work.map((w) => w.summary).filter((s): s is string => Boolean(s)),
      "Member services",
    );
    run.propose({
      subjectType: "MemberQuestion",
      subjectId: opts.memberId,
      action: "handoff",
      headline: "Handed to a person, with the context attached.",
      rationale:
        "Everything the agent established is on the ticket, so the member is not asked the same questions again.",
      payload: packet,
      confidence: 0.9,
    });
  }

  if (opts.persist !== false) {
    await run.finish(
      answered ? "Completed" : "Escalated",
      answered
        ? `${plan.intent}: answered from ${work.length} tool ${work.length === 1 ? "call" : "calls"}.`
        : "Could not answer from the plan's data. Handed off with context.",
    );
  }

  return {
    runId: run.id,
    question: opts.question,
    intent: plan.intent,
    drug: plan.drug,
    paragraphs: answer.paragraphs,
    citations: answer.citations,
    links: answer.links,
    handoff: answer.handoff ?? null,
    handoffPacket: packet,
    work,
    autonomy: run.autonomy,
    elapsedMs: Date.now() - started,
  };
}

async function buildPacket(
  memberId: string,
  question: string,
  reason: string,
  established: string[],
  suggestedOwner: string,
): Promise<HandoffPacket> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { firstName: true, lastName: true, cardholderId: true },
  });
  return {
    reason,
    memberName: member ? `${member.firstName} ${member.lastName}` : "Unknown member",
    cardholderId: member?.cardholderId ?? "",
    question,
    established,
    suggestedOwner,
  };
}
