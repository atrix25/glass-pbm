import { NextResponse } from "next/server";
import { planCalls, runPlan } from "@/lib/agent/plan";
import { compose, type ToolRun } from "@/lib/agent/compose";
import type { ToolResult } from "@/lib/agent/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const started = Date.now();
  const { question, memberId } = (await request.json()) as {
    question: string;
    memberId: string;
  };

  const plan = await planCalls(question, memberId);
  const runs = (await runPlan(plan.calls)) as ToolRun[];
  const answer = compose(question, plan.intent, runs);

  return NextResponse.json({
    question,
    intent: plan.intent,
    drug: plan.drug,
    paragraphs: answer.paragraphs,
    citations: answer.citations,
    links: answer.links,
    handoff: answer.handoff ?? null,
    work: runs.map((r) => ({
      tool: r.tool,
      because: r.because,
      args: r.args,
      error: r.error,
      summary: (r.result as ToolResult | null)?.summary ?? null,
      data: (r.result as ToolResult | null)?.data ?? null,
      citations: (r.result as ToolResult | null)?.citations ?? [],
    })),
    elapsedMs: Date.now() - started,
  });
}
