import { NextResponse } from "next/server";
import { answerDataQuestion } from "@/lib/agents/data-agent/agent";
import { HttpError, readJson, route } from "@/lib/http";
import { getClock } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route("POST /api/data-agent", async (request: Request) => {
  const { question } = await readJson<{ question?: string }>(request);
  if (!question?.trim()) throw new HttpError(400, "A question is required.");

  const clock = await getClock();
  const answer = await answerDataQuestion({ question, clock, at: clock.now });
  return NextResponse.json(answer);
});
