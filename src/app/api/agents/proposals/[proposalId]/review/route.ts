import { NextResponse } from "next/server";
import { z } from "zod";
import { canMutate } from "@/lib/auth";
import { demoFeaturesEnabled } from "@/lib/config";
import {
  ActionReviewError,
  reviewProposal,
} from "@/lib/agents/actions/execute";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

const BodySchema = z.object({
  decision: z.enum(["Approved", "Rejected"]),
  note: z.string().trim().max(2_000).optional(),
  reviewerLabel: z.string().trim().min(1).max(160).optional(),
  reviewerRole: z
    .enum(["plan_sponsor", "ops", "pharmacist", "admin"])
    .optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  const { proposalId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid review request.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const sessionUser = await getSessionUser();
  if (!demoFeaturesEnabled() && (!sessionUser || !canMutate(sessionUser.role))) {
    return NextResponse.json({ error: "Insufficient role." }, { status: 403 });
  }

  const reviewer = sessionUser
    ? {
        id: sessionUser.id,
        label: sessionUser.name ?? sessionUser.email,
        role: sessionUser.role,
      }
    : {
        id: null,
        label: parsed.data.reviewerLabel ?? "Demo operations reviewer",
        role: parsed.data.reviewerRole ?? "admin",
      };

  try {
    const result = await reviewProposal({
      proposalId,
      decision: parsed.data.decision,
      reviewer,
      note: parsed.data.note,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ActionReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("proposal review failed", error);
    return NextResponse.json(
      { error: "Proposal review failed." },
      { status: 500 },
    );
  }
}
