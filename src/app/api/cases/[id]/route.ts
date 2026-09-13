import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { canMutate } from "@/lib/auth";
import { demoFeaturesEnabled } from "@/lib/config";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

const OperatorSchema = {
  operatorLabel: z.string().trim().min(1).max(160).optional(),
};

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    owner: z.string().trim().min(1).max(160),
    ...OperatorSchema,
  }),
  z.object({
    action: z.literal("resolve"),
    resolution: z.string().trim().min(1).max(5_000),
    ...OperatorSchema,
  }),
  z.object({
    action: z.literal("reopen"),
    ...OperatorSchema,
  }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid case update.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const demoMode = demoFeaturesEnabled();
  const sessionUser = await getSessionUser();
  if (!demoMode && (!sessionUser || !canMutate(sessionUser.role))) {
    return NextResponse.json({ error: "Insufficient role." }, { status: 403 });
  }
  if (demoMode && !sessionUser && !parsed.data.operatorLabel) {
    return NextResponse.json(
      { error: "An operator label is required in demo mode." },
      { status: 400 },
    );
  }

  const existing = await prisma.serviceCase.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  if (parsed.data.action === "reopen" && existing.status !== "Resolved") {
    return NextResponse.json(
      { error: "Only a resolved case can be reopened." },
      { status: 409 },
    );
  }
  if (parsed.data.action !== "reopen" && existing.status !== "Open") {
    return NextResponse.json(
      { error: "Reopen this case before changing it." },
      { status: 409 },
    );
  }

  const updated =
    parsed.data.action === "assign"
      ? await prisma.serviceCase.update({
          where: { id },
          data: { owner: parsed.data.owner },
        })
      : parsed.data.action === "resolve"
        ? await prisma.serviceCase.update({
            where: { id },
            data: {
              status: "Resolved",
              resolution: parsed.data.resolution,
              resolvedAt: new Date(),
            },
          })
        : await prisma.serviceCase.update({
            where: { id },
            data: {
              status: "Open",
              resolution: null,
              resolvedAt: null,
            },
          });

  const actorLabel =
    sessionUser?.name ??
    sessionUser?.email ??
    parsed.data.operatorLabel ??
    "Demo case operator";
  await recordAudit({
    actorId: sessionUser?.id,
    action: `service_case.${parsed.data.action}`,
    entity: "ServiceCase",
    entityId: id,
    detail: {
      caseNumber: existing.caseNumber,
      operator: actorLabel,
      previousOwner: existing.owner,
      owner: updated.owner,
      previousStatus: existing.status,
      status: updated.status,
    },
  });

  revalidatePath("/cases");
  revalidatePath(`/cases/${id}`);
  return NextResponse.json({
    id: updated.id,
    owner: updated.owner,
    status: updated.status,
    resolution: updated.resolution,
    resolvedAt: updated.resolvedAt,
  });
}
