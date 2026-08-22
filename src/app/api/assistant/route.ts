import { NextResponse } from "next/server";
import { answerMember } from "@/lib/agents/member-service/agent";
import { requireApiIdentity } from "@/lib/require-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const { question, memberId } = (await request.json()) as {
    question: string;
    memberId: string;
  };

  const answer = await answerMember({ question, memberId });
  return NextResponse.json(answer);
}
