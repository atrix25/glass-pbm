import { NextResponse } from "next/server";
import { answerMember } from "@/lib/agents/member-service/agent";
import { HttpError, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route("POST /api/assistant", async (request: Request) => {
  const { question, memberId } = await readJson<{
    question?: string;
    memberId?: string;
  }>(request);

  if (!question?.trim()) throw new HttpError(400, "A question is required.");
  if (!memberId) throw new HttpError(400, "A member is required.");

  const answer = await answerMember({ question, memberId });
  return NextResponse.json(answer);
});
