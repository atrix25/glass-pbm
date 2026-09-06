/**
 * The claims that came back, and the ones that should not have been paid.
 *
 * Two different failures, both invisible in a demo that only ever shows the
 * happy path.
 *
 * A reversal is the pharmacy telling the processor that a fill it already
 * adjudicated did not happen. NCPDP calls it a B2, it carries the original
 * date of service, and it has to unwind everything the original B1 did: the
 * pharmacy's remittance, the plan's billing, and the member's accumulators.
 * Around two per cent of fills reverse, and a processor that cannot back a
 * claim out cleanly will quietly overstate spend all year.
 *
 * A retroactive termination is the employer telling the plan that somebody
 * left, weeks after they left. Every claim paid in the gap was paid for a
 * person who was not covered. Nothing about those claims was wrong when they
 * adjudicated, which is why this is a query rather than a correction: the
 * recovery worklist is whatever falls outside eligibility as it stands today.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { PLAN_YEAR_START } from "@/lib/clock";

export interface ReversalReason {
  reason: string;
  count: number;
  planPaidCents: number;
}

export interface ReversalRow {
  claimNumber: string;
  originalClaimNumber: string | null;
  memberId: string;
  drugName: string;
  pharmacyName: string;
  dateOfService: Date;
  reversedAt: Date;
  lagDays: number;
  planPaidCents: number;
  patientPayCents: number;
  reason: string | null;
}

export interface ReversalOverview {
  reversals: number;
  reversedFills: number;
  reversalRateBps: number;
  planPaidCents: number;
  patientPayCents: number;
  rebateCents: number;
  medianLagDays: number;
  withinFourteenDaysPct: number;
  reasons: ReversalReason[];
  recent: ReversalRow[];
}

export async function getReversalOverview(
  clock: SimulationClock,
): Promise<ReversalOverview> {
  const [totals] = await prisma.$queryRaw<
    Array<{
      n: number;
      plan: number | null;
      member: number | null;
      rebate: number | null;
    }>
  >`
    SELECT COUNT(*) AS n, SUM(planPaidCents) AS plan,
           SUM(patientPayCents) AS member, SUM(estimatedRebateCents) AS rebate
    FROM Claim
    WHERE transactionCode = 'B2' AND adjudicatedAt <= ${clock.now}
  `;

  const [paid] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*) AS n FROM Claim
    WHERE transactionCode = 'B1' AND responseStatus = 'P'
      AND dateOfService >= ${PLAN_YEAR_START} AND dateOfService <= ${clock.now}
  `;

  const reversals = Number(totals?.n ?? 0);
  const paidClaims = Number(paid?.n ?? 0);

  const reasons = await prisma.$queryRaw<
    Array<{ reason: string; count: number; plan: number }>
  >`
    SELECT rejectMessage AS reason, COUNT(*) AS count, SUM(planPaidCents) AS plan
    FROM Claim
    WHERE transactionCode = 'B2' AND adjudicatedAt <= ${clock.now}
    GROUP BY rejectMessage ORDER BY count DESC
  `;

  // The lag between the fill and the reversal is the operational tell: a
  // processor that only accepts same-day reversals is not a processor.
  const lags = await prisma.$queryRaw<Array<{ lag: number; n: number }>>`
    SELECT CAST(EXTRACT(EPOCH FROM ("adjudicatedAt" - "dateOfService")) / 86400 AS INTEGER) AS lag,
           COUNT(*) AS n
    FROM "Claim"
    WHERE "transactionCode" = 'B2' AND "adjudicatedAt" <= ${clock.now}
    GROUP BY lag ORDER BY lag
  `;
  let seen = 0;
  let medianLagDays = 0;
  let withinFourteen = 0;
  for (const l of lags) {
    const n = Number(l.n);
    if (seen < reversals / 2 && seen + n >= reversals / 2) {
      medianLagDays = Number(l.lag);
    }
    seen += n;
    if (Number(l.lag) <= 14) withinFourteen += n;
  }

  const recentRows = await prisma.$queryRaw<
    Array<{
      claimNumber: string;
      originalClaimNumber: string | null;
      memberId: string;
      drugName: string;
      pharmacyName: string;
      dateOfService: Date;
      reversedAt: Date;
      planPaidCents: number;
      patientPayCents: number;
      reason: string | null;
    }>
  >`
    SELECT r.claimNumber AS claimNumber, o.claimNumber AS originalClaimNumber,
           r.memberId AS memberId, d.name AS drugName, p.name AS pharmacyName,
           r.dateOfService AS dateOfService, r.adjudicatedAt AS reversedAt,
           r.planPaidCents AS planPaidCents, r.patientPayCents AS patientPayCents,
           r.rejectMessage AS reason
    FROM Claim r
    LEFT JOIN Claim o ON o.id = r.reversalOfClaimId
    JOIN Drug d ON d.id = r.drugId
    JOIN Pharmacy p ON p.id = r.pharmacyId
    WHERE r.transactionCode = 'B2' AND r.adjudicatedAt <= ${clock.now}
    ORDER BY r.adjudicatedAt DESC
    LIMIT 25
  `;

  return {
    reversals,
    reversedFills: reversals,
    reversalRateBps:
      paidClaims > 0 ? Math.round((reversals / paidClaims) * 10_000) : 0,
    planPaidCents: Number(totals?.plan ?? 0),
    patientPayCents: Number(totals?.member ?? 0),
    rebateCents: Number(totals?.rebate ?? 0),
    medianLagDays,
    withinFourteenDaysPct:
      reversals > 0 ? Math.round((withinFourteen / reversals) * 100) : 0,
    reasons: reasons.map((r) => ({
      reason: r.reason,
      count: Number(r.count),
      planPaidCents: Number(r.plan),
    })),
    recent: recentRows.map((r) => ({
      ...r,
      dateOfService: new Date(r.dateOfService),
      reversedAt: new Date(r.reversedAt),
      lagDays: Math.round(
        (new Date(r.reversedAt).getTime() -
          new Date(r.dateOfService).getTime()) /
          86_400_000,
      ),
      planPaidCents: Number(r.planPaidCents),
      patientPayCents: Number(r.patientPayCents),
    })),
  };
}

// ---------------------------------------------------------------------------
// Retroactive terminations
// ---------------------------------------------------------------------------

export interface RecoveryRow {
  memberId: string;
  memberName: string;
  terminationDate: Date;
  reportedAt: Date;
  reportingLagDays: number;
  claims: number;
  planPaidCents: number;
  lastFill: Date;
}

export interface RecoveryOverview {
  membersAffected: number;
  claims: number;
  planPaidCents: number;
  medianLagDays: number;
  worst: RecoveryRow[];
  /** How the exposure splits between the network and the member. */
  patientPayCents: number;
}

export async function getRecoveryOverview(
  clock: SimulationClock,
): Promise<RecoveryOverview> {
  /*
   * A claim is recoverable when its date of service falls after the
   * termination the employer eventually reported, and the report has already
   * arrived as of the clock. Before the report lands nobody knows, which is
   * exactly the problem being demonstrated.
   *
   * B2s leave the original B1 marked paid. Once the reversal has posted as of
   * the clock, remittance already clawed the planPaid back — those fills are
   * not still sitting on a recovery worklist.
   */
  const rows = await prisma.$queryRaw<
    Array<{
      memberId: string;
      memberName: string;
      terminationDate: Date;
      reportedAt: Date;
      claims: number;
      plan: number;
      member: number;
      lastFill: number;
    }>
  >`
    SELECT c.memberId AS memberId,
           MAX(m.firstName || ' ' || m.lastName) AS memberName,
           MAX(e.reportedTerminationDate) AS terminationDate,
           MAX(e.retroReportedAt) AS reportedAt,
           COUNT(*) AS claims,
           SUM(c.planPaidCents) AS plan,
           SUM(c.patientPayCents) AS member,
           (EXTRACT(EPOCH FROM MAX(c.dateOfService)) * 1000) AS lastFill
    FROM Claim c
    JOIN EligibilitySpan e ON e.memberId = c.memberId
    JOIN Member m ON m.id = c.memberId
    WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
      AND e.retroReportedAt IS NOT NULL
      AND e.retroReportedAt <= ${clock.now}
      AND c.dateOfService > e.reportedTerminationDate
      AND c.dateOfService <= ${clock.now}
      AND NOT EXISTS (
        SELECT 1 FROM Claim r
        WHERE r.reversalOfClaimId = c.id
          AND r.transactionCode = 'B2'
          AND r.adjudicatedAt <= ${clock.now}
      )
    GROUP BY c.memberId
    ORDER BY SUM(c.planPaidCents) DESC
  `;

  const lags = rows
    .map((r) =>
      Math.round(
        (new Date(r.reportedAt).getTime() -
          new Date(r.terminationDate).getTime()) /
          86_400_000,
      ),
    )
    .sort((a, b) => a - b);

  return {
    membersAffected: rows.length,
    claims: rows.reduce((s, r) => s + Number(r.claims), 0),
    planPaidCents: rows.reduce((s, r) => s + Number(r.plan), 0),
    patientPayCents: rows.reduce((s, r) => s + Number(r.member), 0),
    medianLagDays: lags.length ? lags[Math.floor(lags.length / 2)] : 0,
    worst: rows.slice(0, 15).map((r) => ({
      memberId: r.memberId,
      memberName: r.memberName,
      terminationDate: new Date(r.terminationDate),
      reportedAt: new Date(r.reportedAt),
      reportingLagDays: Math.round(
        (new Date(r.reportedAt).getTime() -
          new Date(r.terminationDate).getTime()) /
          86_400_000,
      ),
      claims: Number(r.claims),
      planPaidCents: Number(r.plan),
      lastFill: new Date(Number(r.lastFill)),
    })),
  };
}
