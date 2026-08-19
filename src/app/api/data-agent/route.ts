import { NextResponse } from "next/server";
import { z } from "zod";
import { answerDataQuestion } from "@/lib/agents/data-agent/agent";
import { parseBody } from "@/lib/api/body";
import { getClock } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const BODY = z.object({ question: z.string().trim().min(1).max(2000) });

export async function POST(request: Request) {
  const body = await parseBody(request, BODY);
  if (!body.ok) return body.response;

  const clock = await getClock();
  const answer = await answerDataQuestion({
    question: body.data.question,
    clock,
    at: clock.now,
  });
  return NextResponse.json(answer);
}
