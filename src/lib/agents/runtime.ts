/**
 * The loop every agent runs inside, and the record it leaves behind.
 *
 * There is one rule here worth reading the code for. An agent cannot change
 * anything. It can think, it can call tools, and it can write a proposal. A
 * proposal becomes real when a person approves it, or when the policy in force
 * allows that class of action to apply itself — and never, at any autonomy
 * level, when the action moves money or denies care.
 *
 * That is enforced in `propose` rather than described in a document, and
 * tests/invariants.test.ts checks the table afterwards to confirm no run ever
 * got around it.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { agent, type Autonomy } from "./registry";
import type { BrainKind, Thought } from "./brain";
import { executeAutoAppliedProposal } from "./actions/execute";
import { actionDefinition } from "./actions/registry";

export interface ProposalInput {
  subjectType: string;
  subjectId: string;
  action: string;
  headline: string;
  rationale: string;
  payload?: unknown;
  /** 0 to 1. */
  confidence: number;
}

export interface StepRecord {
  ordinal: number;
  kind: "Think" | "Tool" | "Evidence" | "Proposal" | "Gate" | "Refusal";
  tool: string | null;
  because: string;
  summary: string;
  detail: unknown;
  brain: BrainKind;
  elapsedMs: number;
}

/** Autonomy in force for an agent at a given instant. */
export async function autonomyAt(
  agentId: string,
  at: Date,
): Promise<Autonomy> {
  const policy = await prisma.agentPolicy.findFirst({
    where: {
      agentId,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  return (policy?.autonomy as Autonomy) ?? agent(agentId).autonomy;
}

export class Run {
  readonly id = randomUUID();
  readonly steps: StepRecord[] = [];
  readonly proposals: (ProposalInput & {
    id: string;
    consequential: boolean;
    autoApplied: boolean;
    status: string;
  })[] = [];

  private started = Date.now();
  private inputTokens = 0;
  private outputTokens = 0;
  private costMillicents = 0;
  private brains = new Set<BrainKind>();
  private modelName: string | null = null;

  constructor(
    readonly agentId: string,
    readonly goal: string,
    readonly autonomy: Autonomy,
    readonly subject?: { type: string; id: string },
    /** Anchors the run to the simulation clock rather than wall time. */
    readonly at: Date = new Date(),
  ) {}

  /** Fold a brain's judgement into the run, and record it as a step. */
  absorb<T>(
    thought: Thought<T>,
    because: string,
    summary: string,
    detail?: unknown,
  ): T {
    this.inputTokens += thought.usage.inputTokens;
    this.outputTokens += thought.usage.outputTokens;
    this.costMillicents += thought.usage.costMillicents;
    if (thought.model) this.modelName = thought.model;
    this.push({
      kind: "Think",
      tool: null,
      because,
      summary,
      detail: detail ?? thought.value,
      brain: thought.brain,
      elapsedMs: thought.elapsedMs,
    });
    return thought.value;
  }

  /**
   * Call a tool. The registry says which tools an agent may use, and this is
   * where that is checked, so a prompt cannot talk an agent into reaching
   * somewhere it has no business being.
   */
  async tool<T>(
    name: string,
    because: string,
    fn: () => Promise<T>,
    describe?: (result: T) => string,
  ): Promise<T> {
    if (!agent(this.agentId).tools.includes(name)) {
      throw new Error(`${this.agentId} may not call ${name}`);
    }
    const started = Date.now();
    const result = await fn();
    this.push({
      kind: "Tool",
      tool: name,
      because,
      summary: describe ? describe(result) : `${name} returned`,
      detail: result,
      brain: "deterministic",
      elapsedMs: Date.now() - started,
    });
    return result;
  }

  /** A fact the agent found and is relying on. */
  evidence(summary: string, because: string, detail?: unknown) {
    this.push({
      kind: "Evidence",
      tool: null,
      because,
      summary,
      detail: detail ?? {},
      brain: "deterministic",
      elapsedMs: 0,
    });
  }

  refuse(summary: string, because: string) {
    this.push({
      kind: "Refusal",
      tool: null,
      because,
      summary,
      detail: {},
      brain: "deterministic",
      elapsedMs: 0,
    });
  }

  propose(input: ProposalInput) {
    const definition = actionDefinition(input.action);
    const consequential = definition.humanRequired;
    // The two conditions are deliberately separate. Autonomy is a policy
    // choice that can change; the consequential bar is not, and it wins.
    const autoApplied =
      !consequential &&
      (this.autonomy === "Act" || this.autonomy === "ActWithReview");

    const id = randomUUID();
    this.proposals.push({
      ...input,
      id,
      consequential,
      autoApplied,
      status: "Proposed",
    });

    this.push({
      kind: consequential ? "Gate" : "Proposal",
      tool: null,
      because: input.rationale,
      summary: consequential
        ? `Held for a person: ${input.headline}`
        : input.headline,
      detail: { action: input.action, payload: input.payload ?? {} },
      brain: "deterministic",
      elapsedMs: 0,
    });
    return id;
  }

  /**
   * A step's detail is there so a reviewer can re-run it by hand. A tool that
   * returns a thousand rows defeats that, and storing it defeats the database,
   * so an oversized payload is cut and says it was cut.
   */
  private static serialise(detail: unknown): string {
    const json = JSON.stringify(detail ?? {});
    if (json.length <= 6000) return json;
    return JSON.stringify({
      truncated: true,
      bytes: json.length,
      head: json.slice(0, 5000),
    });
  }

  private push(s: Omit<StepRecord, "ordinal">) {
    this.brains.add(s.brain);
    this.steps.push({ ...s, ordinal: this.steps.length + 1 });
  }

  private brainLabel(): string {
    if (this.brains.size === 0) return "deterministic";
    if (this.brains.size > 1) return "mixed";
    return [...this.brains][0];
  }

  /** Write the run, its steps and its proposals. */
  async finish(
    outcome: "Completed" | "Escalated" | "Refused" | "Failed",
    summary: string,
  ) {
    const elapsedMs = Date.now() - this.started;
    const endedAt = new Date(this.at.getTime() + elapsedMs);

    await prisma.agentRun.create({
      data: {
        id: this.id,
        agentId: this.agentId,
        startedAt: this.at,
        endedAt,
        goal: this.goal,
        subjectType: this.subject?.type ?? null,
        subjectId: this.subject?.id ?? null,
        outcome,
        summary,
        brain: this.brainLabel(),
        modelName: this.modelName,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        costMillicents: this.costMillicents,
        elapsedMs,
        autonomy: this.autonomy,
        steps: {
          create: this.steps.map((s) => ({
            id: randomUUID(),
            ordinal: s.ordinal,
            kind: s.kind,
            tool: s.tool,
            because: s.because,
            summary: s.summary,
            detail: Run.serialise(s.detail),
            brain: s.brain,
            elapsedMs: s.elapsedMs,
          })),
        },
        proposals: {
          create: this.proposals.map((p) => ({
            id: p.id,
            agentId: this.agentId,
            subjectType: p.subjectType,
            subjectId: p.subjectId,
            action: p.action,
            headline: p.headline,
            rationale: p.rationale,
            payload: JSON.stringify(p.payload ?? {}),
            confidenceBps: Math.round(p.confidence * 10000),
            consequential: p.consequential,
            status: p.status,
            autoApplied: p.autoApplied,
            appliedAt: null,
            createdAt: endedAt,
          })),
        },
      },
    });

    // `autoApplied` means policy approved the action, not that setting a status
    // changed the book. Every eligible proposal still passes through the same
    // typed, idempotent effect executor and receives an execution receipt.
    for (const proposal of this.proposals.filter((p) => p.autoApplied)) {
      await executeAutoAppliedProposal(proposal.id);
      proposal.status = "Applied";
    }
    return { id: this.id, elapsedMs, outcome, summary };
  }

  /** Everything the UI needs, without a database round trip. */
  snapshot(
    outcome: "Completed" | "Escalated" | "Refused" | "Failed",
    summary: string,
  ) {
    return {
      id: this.id,
      agentId: this.agentId,
      goal: this.goal,
      autonomy: this.autonomy,
      outcome,
      summary,
      brain: this.brainLabel(),
      model: this.modelName,
      costMillicents: this.costMillicents,
      elapsedMs: Date.now() - this.started,
      steps: this.steps,
      proposals: this.proposals,
    };
  }
}

export async function startRun(opts: {
  agentId: string;
  goal: string;
  subject?: { type: string; id: string };
  at?: Date;
}): Promise<Run> {
  const at = opts.at ?? new Date();
  const autonomy = await autonomyAt(opts.agentId, at);
  return new Run(opts.agentId, opts.goal, autonomy, opts.subject, at);
}
