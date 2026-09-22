import { NextResponse } from "next/server";
import { z } from "zod";
import { getClock, getSessionUser, getRole } from "@/lib/session";
import { demoFeaturesEnabled } from "@/lib/config";
import { prisma } from "@/lib/db";
import { GoalsSchema } from "@/lib/agents/account-management/model";
import { activateBenefit } from "@/lib/agents/account-management/service";
import { recordAudit } from "@/lib/audit";
export const runtime = "nodejs";
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("analyze"), goals: GoalsSchema }).strict(),
  z
    .object({
      action: z.literal("activate"),
      proposalId: z.string().min(1),
      approved: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("review"),
      proposalId: z.string().min(1),
      note: z.string().trim().min(5).max(1000),
    })
    .strict(),
]);
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host;
    return ["https:", "http:"].includes(url.protocol) && url.host === host;
  } catch {
    return false;
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const user = await getSessionUser();
  const demo =
    demoFeaturesEnabled() && ["admin", "sponsor"].includes(await getRole());
  if (!(user && ["admin", "plan_sponsor", "ops"].includes(user.role)) && !demo)
    return NextResponse.json(
      { error: "Sign in as a benefits lead or administrator." },
      { status: 403 },
    );
  const actor = user?.email ?? "Demo benefits lead";
  try {
    const body = Action.parse(await request.json());
    if (body.action === "analyze") {
      const clock = await getClock();
      const job = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(74839202)::text`;
        const existing = await tx.job.findFirst({
          where: {
            type: "account_management",
            status: { in: ["pending", "running"] },
          },
        });
        if (existing) throw Error("An analysis is already queued or running.");
        return tx.job.create({
          data: {
            type: "account_management",
            payload: JSON.stringify({
              goals: body.goals,
              asOf: clock.now.toISOString(),
            }),
            createdById: user?.id,
            maxAttempts: 1,
            status: "pending",
          },
        });
      });
      await recordAudit({
        actorId: user?.id,
        action: "account-management.analyze",
        entity: "Job",
        entityId: job.id,
      });
      return NextResponse.json({ jobId: job.id }, { status: 202 });
    }
    if (body.action === "activate") {
      const result = await activateBenefit(body.proposalId, actor);
      await recordAudit({
        actorId: user?.id,
        action: "account-management.activate",
        entity: "ConfigVersion",
        entityId: result.id,
      });
      return NextResponse.json(result);
    }
    const updated = await prisma.agentProposal.updateMany({
      where: {
        id: body.proposalId,
        action: "review-benefit-release",
        subjectType: "BenefitRelease",
        status: "Proposed",
      },
      data: {
        status: "Applied",
        reviewedBy: actor,
        reviewedAt: new Date(),
        appliedAt: new Date(),
      },
    });
    if (!updated.count)
      return NextResponse.json(
        { error: "Review is no longer pending." },
        { status: 409 },
      );
    await recordAudit({
      actorId: user?.id,
      action: "account-management.rollout-review",
      entity: "AgentProposal",
      entityId: body.proposalId,
      detail: { note: body.note, reviewer: actor },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: error instanceof z.ZodError ? 400 : 409 },
    );
  }
}
