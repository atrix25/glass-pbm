import { NextResponse } from "next/server";
import { answerDataQuestion } from "@/lib/agents/data-agent/agent";
import { getClock } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { question } = (await request.json()) as { question: string };
  if (!question?.trim()) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }
  const clock = await getClock();
  const answer = await answerDataQuestion({ question, clock, at: clock.now });
  return NextResponse.json(answer);
}
