/**
 * The data agent: sponsor Q&A and report briefings from the claim ledger.
 *
 * Same loop as member-service — plan tools, execute, compose — with an optional
 * brain step to route intent and (when a key is present) narrate tool JSON
 * without inventing dollars.
 */

import { z } from "zod";
import { resolveClock, type SimulationClock } from "@/lib/clock";
import { startRun } from "../runtime";
import { judge } from "../brain";
import { planDataCalls } from "@/lib/agent/data-plan";
import { composeDataAnswer, type DataToolRun } from "@/lib/agent/data-compose";
import {
  DATA_TOOL_REGISTRY,
  type DataToolName,
} from "@/lib/agent/data-tools";
import type { ToolResult } from "@/lib/agent/tools";

const MAX_CALLS = 10;

const NARRATIVE_SCHEMA = z.object({
  paragraphs: z.array(z.string()).min(1).max(12),
});

export interface DataAnswer {
  runId: string;
  question: string;
  intent: string;
  paragraphs: string[];
  citations: ReturnType<typeof composeDataAnswer>["citations"];
  links: { label: string; href: string }[];
  briefingMarkdown: string | null;
  handoff: string | null;
  work: {
    tool: string;
    because: string;
    args: unknown;
    error: string | null;
    summary: string | null;
    data: unknown;
    citations: unknown[];
    followUp: boolean;
  }[];
  autonomy: string;
  elapsedMs: number;
  brain: string | null;
}

export async function answerDataQuestion(opts: {
  question: string;
  /** Simulation instant; defaults to the live plan-year clock. */
  at?: Date;
  /** Prefer an explicit clock (API routes pass the session clock). */
  clock?: SimulationClock;
  persist?: boolean;
}): Promise<DataAnswer> {
  const started = Date.now();
  const clock =
    opts.clock ??
    (opts.at ? resolveClock(opts.at.toISOString()) : resolveClock(null));

  const run = await startRun({
    agentId: "data-agent",
    goal: opts.question,
    subject: { type: "PlanSponsor", id: "steel-potatoes" },
    at: opts.at ?? clock.now,
  });

  const plan = await planDataCalls(opts.question);
  run.evidence(
    `Routed as ${plan.intent} with ${plan.calls.length} planned tool call(s).`,
    "Intent routing for the sponsor question",
    { intent: plan.intent, callCount: plan.calls.length },
  );

  const runs: DataToolRun[] = [];
  const work: DataAnswer["work"] = [];
  const called = new Set<string>();

  for (const call of plan.calls) {
    if (work.length >= MAX_CALLS) break;
    const callKey = `${call.tool}:${JSON.stringify(call.args)}`;
    if (called.has(callKey)) continue;
    called.add(callKey);

    const def = DATA_TOOL_REGISTRY[call.tool as DataToolName];
    if (!def) {
      work.push({
        tool: call.tool,
        because: call.because,
        args: call.args,
        error: `Unknown tool ${call.tool}`,
        summary: null,
        data: null,
        citations: [],
        followUp: false,
      });
      continue;
    }

    const parsed = def.schema.safeParse(call.args);
    if (!parsed.success) {
      const error = parsed.error.issues.map((i) => i.message).join("; ");
      runs.push({
        tool: call.tool,
        args: call.args,
        because: call.because,
        error,
        result: null,
      });
      work.push({
        tool: call.tool,
        because: call.because,
        args: call.args,
        error,
        summary: null,
        data: null,
        citations: [],
        followUp: false,
      });
      continue;
    }

    const result = await run.tool(
      call.tool,
      call.because,
      () => def.execute(parsed.data, clock) as Promise<ToolResult>,
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
      followUp: false,
    });
  }

  let answer = composeDataAnswer(opts.question, plan.intent, runs);

  // Optional narration: restate only figures already present in the template
  // answer / tool summaries. Never a source of new dollars.
  if (process.env.ANTHROPIC_API_KEY && answer.paragraphs.length > 0 && !answer.handoff) {
    const toolDigest = work
      .filter((w) => w.summary)
      .map((w) => `${w.tool}: ${w.summary}`)
      .join("\n");
    const thought = await judge({
      system: `You narrate Glass PBM analytics for a plan sponsor.
Rules:
- Use ONLY figures that already appear in the draft paragraphs or tool summaries below.
- Do not compute, round creatively, or invent dollars, percentages, or claim counts.
- Keep 2–6 short paragraphs in plain language.
- You may mention deep links by name (Reports, Trends, Settlement) but not invent URLs.`,
      prompt: `Question: ${opts.question}\n\nDraft paragraphs:\n${answer.paragraphs.join("\n")}\n\nTool summaries:\n${toolDigest}`,
      schema: NARRATIVE_SCHEMA,
      fallback: () => ({ paragraphs: answer.paragraphs }),
    });
    run.absorb(
      thought,
      "Narrate only figures already returned by tools",
      "Narrated tool-backed answer",
    );
    if (thought.value.paragraphs.length > 0) {
      answer = { ...answer, paragraphs: thought.value.paragraphs };
    }
  }

  if (answer.briefingMarkdown) {
    answer = {
      ...answer,
      paragraphs: [
        ...answer.paragraphs,
        "——",
        ...answer.briefingMarkdown.split("\n").filter(Boolean),
      ],
    };
  }

  const answered =
    answer.paragraphs.length > 0 && !answer.handoff && runs.some((r) => !r.error);

  if (opts.persist !== false) {
    await run.finish(
      answered ? "Completed" : "Escalated",
      answered
        ? `${plan.intent}: answered from ${work.length} tool ${work.length === 1 ? "call" : "calls"}.`
        : "Could not answer from the plan's data.",
    );
  }

  return {
    runId: run.id,
    question: opts.question,
    intent: plan.intent,
    paragraphs: answer.paragraphs,
    citations: answer.citations,
    links: answer.links,
    briefingMarkdown: answer.briefingMarkdown,
    handoff: answer.handoff,
    work,
    autonomy: run.autonomy,
    elapsedMs: Date.now() - started,
    brain: process.env.ANTHROPIC_API_KEY ? "model" : "deterministic",
  };
}
