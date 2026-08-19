/**
 * Recording a determination on a prior authorization.
 *
 * The only write path to `determination`, which is deliberate: the rule that
 * automation may approve and only a pharmacist may refuse is enforced here, by
 * `mayRecord`, rather than being asserted on a page. A caller that asks to record
 * a refusal as automation is answered with 403 and no row changes.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { idSchema, parseBody } from "@/lib/api/body";
import { prisma } from "@/lib/db";
import { paDeadlines } from "@/lib/pa/engine";
import { mayRecord } from "@/lib/pa/review";
import { getClock } from "@/lib/session";

// The reviewer and the action are the two things `mayRecord` decides on, so
// they are checked against their unions here rather than cast: an unrecognised
// `record` value would otherwise fall past every branch of that function and be
// written to the determination column verbatim.
const REVIEWER = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("automation"),
    label: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("pharmacist"),
    label: z.string().min(1).max(200),
    licence: z.string().min(1).max(100),
  }),
]);

const ACTION = z.discriminatedUnion("record", [
  z.object({
    record: z.literal("Approved"),
    approvedDays: z.number().int().positive().max(3650),
    decidingStep: z.number().int().nonnegative().max(1000).nullish(),
  }),
  z.object({
    record: z.literal("Denied"),
    reason: z.string().min(1).max(4000),
    decidingStep: z.number().int().nonnegative().max(1000).nullish(),
  }),
  z.object({
    record: z.literal("Escalated"),
    reason: z.string().min(1).max(4000),
  }),
]);

const BODY = z.object({
  paId: idSchema,
  reviewer: REVIEWER,
  action: ACTION,
  note: z.string().max(4000).nullish(),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, BODY);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const verdict = mayRecord(body.reviewer, body.action);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: verdict.refusal, requiresSignature: verdict.requiresSignature },
      { status: 403 },
    );
  }

  const pa = await prisma.priorAuthorization.findUnique({
    where: { id: body.paId },
    select: {
      id: true,
      determination: true,
      decidedAt: true,
      receivedAt: true,
      urgency: true,
      requestType: true,
      prescriberStatementAt: true,
    },
  });
  if (!pa) {
    return NextResponse.json({ error: "No such request." }, { status: 404 });
  }

  const clock = await getClock();
  const now = clock.now;

  /*
   * Whether this request has already been answered, asked of the current
   * instant rather than of the column.
   *
   * A stored determination with a decision time still in the future is not an
   * answer yet; it is what the book says will happen if nobody intervenes. The
   * reviewer console exists precisely to intervene, so the guard has to be
   * about the moment and not about whether the field is populated. Re-deciding
   * something genuinely already answered is what an appeal is for, and an
   * appeal is a new request with its own clock rather than an edit to this one.
   */
  if (pa.determination && pa.decidedAt && pa.decidedAt <= now) {
    return NextResponse.json(
      {
        error:
          "This request has already been determined. Contest it by filing an appeal, which is decided by a different reviewer and carries its own deadline.",
      },
      { status: 409 },
    );
  }

  const action = body.action;

  if (action.record === "Escalated") {
    await prisma.priorAuthorization.update({
      where: { id: pa.id },
      data: { escalated: true, status: "InReview", reviewerNote: body.note ?? null },
    });
    return NextResponse.json({ ok: true, escalated: true });
  }

  const deadlines = paDeadlines(
    pa.receivedAt,
    pa.urgency === "Expedited" ? "Expedited" : "Standard",
    "Commercial",
    { requestType: pa.requestType, supportingStatementAt: pa.prescriberStatementAt },
  );
  const sla = deadlines.binding;

  const approved = action.record === "Approved";
  await prisma.priorAuthorization.update({
    where: { id: pa.id },
    data: {
      status: action.record,
      determination: action.record,
      decidingStepNumber: action.decidingStep ?? null,
      denyReason: approved ? null : action.reason,
      approvedDays: approved ? action.approvedDays : null,
      approvedEffectiveDate: approved ? now : null,
      approvedTerminationDate: approved
        ? new Date(now.getTime() + action.approvedDays * 86_400_000)
        : null,
      decidedAt: now,
      decidedBy: verdict.decidedBy ?? null,
      decisionDueAt: sla.dueAt,
      reviewerNote: body.note ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    determination: action.record,
    decidedBy: verdict.decidedBy,
    onTime: now <= sla.dueAt,
    dueAt: sla.dueAt,
    boundBy: deadlines.bindingSource,
    regulatoryDueAt: deadlines.regulatory.dueAt,
    contractualDueAt: deadlines.contractual.dueAt,
  });
}
