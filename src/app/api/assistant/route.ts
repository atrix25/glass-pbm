import { NextResponse } from "next/server";
import { answerMember } from "@/lib/agents/member-service/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { question, memberId } = (await request.json()) as {
    question: string;
    memberId: string;
  };

  const answer = await answerMember({ question, memberId });
  return NextResponse.json(answer);
}
