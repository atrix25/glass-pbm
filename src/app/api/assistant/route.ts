import { NextResponse } from "next/server";
import { z } from "zod";
import { answerMember } from "@/lib/agents/member-service/agent";
import { idSchema, parseBody } from "@/lib/api/body";

export const runtime = "nodejs";
export const maxDuration = 60;

// A question long enough to be a real one and short enough that the body is
// not a way to spend the model budget of whoever is hosting the demo.
const BODY = z.object({
  question: z.string().trim().min(1).max(2000),
  memberId: idSchema,
});

export async function POST(request: Request) {
  const body = await parseBody(request, BODY);
  if (!body.ok) return body.response;

  const answer = await answerMember(body.data);
  return NextResponse.json(answer);
}
