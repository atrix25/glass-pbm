import { NextResponse } from "next/server";
import { z } from "zod";
import { demoFeaturesEnabled } from "@/lib/config";
import { DEMO_MEMBER_STORIES } from "@/lib/demo-members";
import { answerMember } from "@/lib/agents/member-service/agent";

export const runtime = "nodejs";
export const maxDuration = 60;
const Input = z.object({
  memberId: z.string().refine(id => DEMO_MEMBER_STORIES.some(m => m.id === id)),
  question: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  if (!demoFeaturesEnabled()) return NextResponse.json({ error: "Simulation is unavailable." }, { status: 404 });
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Choose a demo member and enter a question." }, { status: 400 });
  try {
    // Run the real read-only service tools without recording operational work
    // or placing simulated handoff proposals into staff queues.
    const { runId: _runId, ...answer } = await answerMember({ ...input.data, persist: false });
    void _runId;
    return NextResponse.json(answer);
  } catch {
    return NextResponse.json({ error: "The agent could not finish. Please try again." }, { status: 503 });
  }
}
