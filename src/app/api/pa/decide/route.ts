/**
 * Recording a determination on a prior authorization.
 *
 * The only write path to `determination`, which is deliberate: the rule that
 * automation may approve and only a pharmacist may refuse is enforced here, by
 * `mayRecord`, rather than being asserted on a page. A caller that asks to record
 * a refusal as automation is answered with 403 and no row changes.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { paDeadlines } from "@/lib/pa/engine";
import {
  mayDecideAppeal,
  mayRecord,
  parseContestedPaNumber,
  type ReviewAction,
  type Reviewer,
} from "@/lib/pa/review";
import { getClock, getSessionUser } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { canDecidePa } from "@/lib/auth";
import { demoFeaturesEnabled } from "@/lib/config";

interface Body {
  paId: string;
  reviewer: Reviewer;
  action: ReviewAction;
  note?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;

  if (!body?.paId || !body?.reviewer || !body?.action) {
    return NextResponse.json(
      { error: "paId, reviewer, and action are required." },
      { status: 400 },
    );
  }

  const verdict = mayRecord(body.reviewer, body.action);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: verdict.refusal, requiresSignature: verdict.requiresSignature },
      { status: 403 },
    );
  }

  if (!demoFeaturesEnabled()) {
    const user = await getSessionUser();
    if (!user || !canDecidePa(user.role)) {
      return NextResponse.json({ error: "Insufficient role." }, { status: 403 });
    }
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
      reviewerNote: true,
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
      data: {
        escalated: true,
        status: "InReview",
        reviewerNote: mergeAppealNote(pa.requestType, pa.reviewerNote, body.note),
      },
    });
    return NextResponse.json({ ok: true, escalated: true });
  }

  /*
   * Appeal independence is enforced on the determination write, not only on
   * filing. `mayAppeal` already returns `mustDifferFrom`, but a caller that
   * skips the intake UI (or files correctly and then signs with the original
   * pharmacist) would otherwise grant coverage without the independent review
   * 29 CFR 2560.503-1(h) requires — and that the seed already refuses to write.
   */
  if (pa.requestType === "Appeal") {
    const contestedNumber = parseContestedPaNumber(pa.reviewerNote);
    if (!contestedNumber) {
      return NextResponse.json(
        {
          error:
            "This appeal does not name the determination it contests, so reviewer independence cannot be checked. Re-file the appeal against the refusal.",
        },
        { status: 409 },
      );
    }
    const contested = await prisma.priorAuthorization.findUnique({
      where: { paNumber: contestedNumber },
      select: { decidedBy: true },
    });
    if (!contested) {
      return NextResponse.json(
        {
          error: `This appeal contests ${contestedNumber}, which is not on file.`,
        },
        { status: 409 },
      );
    }
    const independence = mayDecideAppeal({
      mustDifferFrom: contested.decidedBy,
      decidedBy: verdict.decidedBy ?? null,
    });
    if (!independence.allowed) {
      return NextResponse.json({ error: independence.reason }, { status: 403 });
    }
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
      reviewerNote: mergeAppealNote(pa.requestType, pa.reviewerNote, body.note),
    },
  });

  const actor = await getSessionUser();
  await recordAudit({
    actorId: actor?.id,
    action: "pa.decide",
    entity: "PriorAuthorization",
    entityId: pa.id,
    detail: { determination: action.record, reviewer: body.reviewer },
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

/**
 * Keep the `Contests {paNumber}.` prefix on appeal notes. The decide path reads
 * that linkage to enforce reviewer independence; replacing the whole note with
 * a free-text pharmacist comment would erase the only pointer to the original
 * refusal.
 */
function mergeAppealNote(
  requestType: string,
  existing: string | null,
  next: string | null | undefined,
): string | null {
  if (requestType !== "Appeal") return next ?? null;
  const contested = parseContestedPaNumber(existing);
  if (!contested) return next ?? existing;
  const prefix = `Contests ${contested}.`;
  if (!next) return existing;
  if (parseContestedPaNumber(next)) return next;
  return `${prefix} ${next}`;
}
