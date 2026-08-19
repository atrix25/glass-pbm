/**
 * Filing an exception to coverage, an appeal, or a grievance.
 *
 * These are the paths a member has when the answer was no, and they are separate
 * requests rather than edits to the original — which is the point. An appeal that
 * mutates the record it contests destroys the evidence of what was first decided
 * and by whom, and the reviewer independence requirement then has nothing to
 * check against.
 *
 * So each one lands as its own `PriorAuthorization` row with its own clock. For
 * an exception, that clock does not start on filing: it starts when the
 * prescriber's supporting statement arrives, because an exception turns on a
 * clinical assertion only the prescriber can make.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, readJson, route } from "@/lib/http";
import { paDeadlines } from "@/lib/pa/engine";
import { exceptionKind, mayAppeal, type ExceptionKind } from "@/lib/pa/review";
import { getClock } from "@/lib/session";

interface Body {
  /** The request being contested, for an appeal; the drug's own PA otherwise. */
  againstPaId?: string;
  memberId?: string;
  drugId?: string;
  kind: ExceptionKind;
  urgency?: "Standard" | "Expedited";
  /** The prescriber's supporting statement, if it came in with the filing. */
  supportingStatement?: string;
  rationale?: string;
}

export const POST = route("POST /api/pa/exception", async (request: Request) => {
  const body = await readJson<Body>(request);
  const info = exceptionKind(body?.kind);
  if (!info) throw new HttpError(400, "Unrecognised request kind.");

  let memberId = body.memberId;
  let drugId = body.drugId;
  let against: {
    id: string;
    paNumber: string;
    determination: string | null;
    decidedBy: string | null;
    treeId: string | null;
  } | null = null;

  if (body.againstPaId) {
    against = await prisma.priorAuthorization.findUnique({
      where: { id: body.againstPaId },
      select: {
        id: true,
        paNumber: true,
        determination: true,
        decidedBy: true,
        treeId: true,
        memberId: true,
        drugId: true,
      },
    });
    if (!against) throw new HttpError(404, "No such request to contest.");
    const source = against as typeof against & {
      memberId: string;
      drugId: string;
    };
    memberId ??= source.memberId;
    drugId ??= source.drugId;
  }

  if (!memberId || !drugId) {
    throw new HttpError(400, "A member and a drug are required.");
  }

  if (body.kind === "Appeal") {
    if (!against) {
      throw new HttpError(
        400,
        "An appeal must name the determination it contests.",
      );
    }
    const verdict = mayAppeal(against);
    if (!verdict.allowed) throw new HttpError(409, verdict.reason);
  }

  // Filed against the simulated present, so a request filed on stage lands in
  // the queue the rest of the application is looking at.
  const { now } = await getClock();
  const urgency = body.urgency ?? "Standard";
  const supportingStatementAt =
    info.needsSupportingStatement && body.supportingStatement ? now : null;

  const deadlines = paDeadlines(now, urgency, "Commercial", {
    requestType: body.kind,
    supportingStatementAt,
  });
  const sla = deadlines.binding;

  const count = await prisma.priorAuthorization.count();
  const created = await prisma.priorAuthorization.create({
    data: {
      paNumber: `${body.kind === "Appeal" ? "AP" : body.kind === "Grievance" ? "GR" : "EX"}-${String(count + 1).padStart(7, "0")}`,
      memberId,
      drugId,
      treeId: against?.treeId ?? null,
      requestType: body.kind,
      urgency,
      status: supportingStatementAt || !info.needsSupportingStatement
        ? "Received"
        : "PendingInfo",
      receivedAt: now,
      prescriberStatementAt: supportingStatementAt,
      // A grievance is a complaint about conduct, not a coverage request, so it
      // never carries a determination deadline.
      decisionDueAt: body.kind === "Grievance" ? null : sla.dueAt,
      reviewerNote: [
        against ? `Contests ${against.paNumber}.` : null,
        body.rationale ?? null,
        body.supportingStatement
          ? `Prescriber supporting statement: ${body.supportingStatement}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
    select: { id: true, paNumber: true, status: true },
  });

  return NextResponse.json({
    ok: true,
    id: created.id,
    paNumber: created.paNumber,
    status: created.status,
    kind: info.label,
    clockStarted: !sla.awaitingSupportingStatement,
    dueAt: body.kind === "Grievance" ? null : sla.dueAt,
    citation: info.citation,
    note: sla.awaitingSupportingStatement
      ? "Filed. The regulatory clock has not started, because an exception request needs the prescriber's supporting statement before the plan can decide it."
      : "Filed, and the clock is running.",
  });
});
