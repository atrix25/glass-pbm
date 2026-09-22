/**
 * Reading a hundred thousand people's year out of the book.
 *
 * The schedule in rubric.ts scores a small flat object per member. This builds
 * those objects. It is deliberately separate from the scoring, because the same
 * shape has to be producible two ways: from the stored book, which is what this
 * file does, and from a hypothetical book produced by re-adjudicating against a
 * proposed benefit, which is what replay does. Neither needs to know about the
 * other, and the schedule needs to know about neither.
 *
 * Everything is cut against the simulation clock, like every other figure in
 * the application. A member cannot be annoyed by a fill that has not happened.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import type { MemberExperience } from "./rubric";

/** Contractual promises, from the guarantee schedule. Hours. */
const STANDARD_PROMISE_HOURS = 72;
const EXPEDITED_PROMISE_HOURS = 24;

export function emptyExperience(memberId: string): MemberExperience {
  return {
    memberId,
    totalClaims: 0,
    paidClaims: 0,
    rejectsPaRequired: 0,
    rejectsStepTherapy: 0,
    rejectsQuantity: 0,
    rejectsRefillTooSoon: 0,
    rejectsTerminated: 0,
    rejectsOutOfNetwork: 0,
    paDenied: 0,
    paSlow: 0,
    paOnTime: 0,
    oopCents: 0,
    worstFillCents: 0,
    brandPenaltyClaims: 0,
    deductibleClaims: 0,
    retroClawback: false,
    reversals: 0,
    majorDurAlerts: 0,
    extendedSupplyClaims: 0,
  };
}

interface ClaimAgg {
  memberId: string;
  totalClaims: number | bigint;
  paidClaims: number | bigint;
  oopCents: number | bigint | null;
  worstFillCents: number | bigint | null;
  brandPenaltyClaims: number | bigint;
  deductibleClaims: number | bigint;
  extendedSupplyClaims: number | bigint;
  reversals: number | bigint;
  rejPa: number | bigint;
  rejStep: number | bigint;
  rejQty: number | bigint;
  rejRefill: number | bigint;
  rejTerm: number | bigint;
  rejOon: number | bigint;
}

const n = (v: number | bigint | null | undefined): number => Number(v ?? 0);

/**
 * Every claim-derived signal in a single grouped pass.
 *
 * One statement rather than eight, because the claim table has 1.7 million rows
 * and the difference between touching it once and touching it repeatedly is the
 * difference between a page that loads and a page that does not. The covering
 * index on (memberId, dateOfService, responseStatus, ...) makes this cheap
 * despite the width.
 *
 * Reject codes are a JSON array on the claim; only the first is read, which is
 * the one the pharmacy shows the member.
 */
async function claimSignals(cutoff: Date): Promise<Map<string, ClaimAgg>> {
  const rows = await prisma.$queryRaw<ClaimAgg[]>`
    SELECT
      c.memberId AS memberId,
      COUNT(*) AS totalClaims,
      SUM(CASE WHEN c.responseStatus = 'P' AND c.transactionCode = 'B1' THEN 1 ELSE 0 END) AS paidClaims,
      SUM(CASE WHEN c.responseStatus = 'P' AND c.transactionCode = 'B1' THEN c.patientPayCents ELSE 0 END) AS oopCents,
      MAX(CASE WHEN c.responseStatus = 'P' AND c.transactionCode = 'B1' THEN c.patientPayCents ELSE 0 END) AS worstFillCents,
      SUM(CASE WHEN c.responseStatus = 'P' AND c.brandSelectionPenaltyCents > 0 THEN 1 ELSE 0 END) AS brandPenaltyClaims,
      SUM(CASE WHEN c.responseStatus = 'P' AND c.appliedToDeductibleCents > 0 THEN 1 ELSE 0 END) AS deductibleClaims,
      SUM(CASE WHEN c.responseStatus = 'P' AND c.channel IN ('Mail', 'Retail90') THEN 1 ELSE 0 END) AS extendedSupplyClaims,
      SUM(CASE WHEN c.transactionCode = 'B2' THEN 1 ELSE 0 END) AS reversals,
      SUM(CASE WHEN c.responseStatus = 'R' AND (c.rejectCodes::json->>0) = '75'  THEN 1 ELSE 0 END) AS rejPa,
      SUM(CASE WHEN c.responseStatus = 'R' AND (c.rejectCodes::json->>0) = '608' THEN 1 ELSE 0 END) AS rejStep,
      SUM(CASE WHEN c.responseStatus = 'R' AND (c.rejectCodes::json->>0) = '76'  THEN 1 ELSE 0 END) AS rejQty,
      SUM(CASE WHEN c.responseStatus = 'R' AND (c.rejectCodes::json->>0) = '79'  THEN 1 ELSE 0 END) AS rejRefill,
      SUM(CASE WHEN c.responseStatus = 'R' AND (c.rejectCodes::json->>0) = '69'  THEN 1 ELSE 0 END) AS rejTerm,
      SUM(CASE WHEN c.responseStatus = 'R' AND (c.rejectCodes::json->>0) = '40'  THEN 1 ELSE 0 END) AS rejOon
    FROM Claim c
    WHERE c.dateOfService <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
      AND c.adjudicatedAt <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY c.memberId
  `;

  const map = new Map<string, ClaimAgg>();
  for (const r of rows) map.set(r.memberId, r);
  return map;
}

interface PaAgg {
  memberId: string;
  denied: number | bigint;
  slow: number | bigint;
  onTime: number | bigint;
}

/**
 * Authorisation outcomes, measured against what the contract promised.
 *
 * "Slow" is not a judgement invented here: it is the turnaround guarantee in
 * src/lib/contracts/guarantees.ts, 72 hours standard and 24 expedited.
 * Latency is measured in milliseconds via EXTRACT(EPOCH …).
 */
async function paSignals(cutoff: Date): Promise<Map<string, PaAgg>> {
  const standardMs = STANDARD_PROMISE_HOURS * 3_600_000;
  const expeditedMs = EXPEDITED_PROMISE_HOURS * 3_600_000;

  const rows = await prisma.$queryRaw<PaAgg[]>`
    SELECT
      p."memberId" AS "memberId",
      SUM(CASE WHEN p.determination = 'Denied' THEN 1 ELSE 0 END) AS denied,
      SUM(CASE
            WHEN p.determination = 'Approved'
             AND (EXTRACT(EPOCH FROM (p."decidedAt" - p."receivedAt")) * 1000) >
                 (CASE WHEN p.urgency = 'Expedited' THEN ${expeditedMs} ELSE ${standardMs} END)
            THEN 1 ELSE 0 END) AS slow,
      SUM(CASE
            WHEN p.determination = 'Approved'
             AND (EXTRACT(EPOCH FROM (p."decidedAt" - p."receivedAt")) * 1000) <=
                 (CASE WHEN p.urgency = 'Expedited' THEN ${expeditedMs} ELSE ${standardMs} END)
            THEN 1 ELSE 0 END) AS "onTime"
    FROM "PriorAuthorization" p
    WHERE p."decidedAt" IS NOT NULL AND p."decidedAt" <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY p."memberId"
  `;

  const map = new Map<string, PaAgg>();
  for (const r of rows) map.set(r.memberId, r);
  return map;
}

async function durSignals(cutoff: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<
    { memberId: string; major: number | bigint }[]
  >`
    SELECT memberId, COUNT(*) AS major
    FROM DurAlert
    WHERE severity = 'Major' AND dateOfService <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY memberId
  `;
  return new Map(rows.map((r) => [r.memberId, n(r.major)]));
}

/**
 * Members whose coverage was withdrawn backwards over fills they had already
 * collected. The same definition the reversals page uses, so the two pages
 * cannot disagree about who this happened to.
 */
async function clawbackMembers(cutoff: Date): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ memberId: string }[]>`
    SELECT DISTINCT c.memberId AS memberId
    FROM Claim c
    JOIN EligibilitySpan e ON e.memberId = c.memberId
    WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
      AND e.retroReportedAt IS NOT NULL
      AND e.retroReportedAt <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
      AND c.dateOfService > e.reportedTerminationDate
      AND c.dateOfService <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
  `;
  return new Set(rows.map((r) => r.memberId));
}

/**
 * Build the experience of everyone who presented a prescription.
 *
 * That includes members who never got one filled. Being turned away at a
 * counter three times and going home empty-handed is an experience of the
 * benefit, and a strongly held one; scoring only the members who succeeded
 * would be measuring satisfaction among the satisfied.
 *
 * Members who never presented anything at all do not appear in the claim table
 * and so are never returned here. They are the one group with nothing to say,
 * and inventing answers for them would put tens of thousands of manufactured
 * opinions into a number that is supposed to be about what happened to people.
 */
export async function buildExperiences(
  clock: SimulationClock,
): Promise<MemberExperience[]> {
  const cutoff = clock.now;

  // Run sequentially: each claim pass can hold a pool connection for a long
  // time, and parallelising them exhausts Prisma behind PgBouncer (P2024).
  const claims = await claimSignals(cutoff);
  const pas = await paSignals(cutoff);
  const durs = await durSignals(cutoff);
  const clawbacks = await clawbackMembers(cutoff);

  const out: MemberExperience[] = [];

  for (const [memberId, c] of claims) {
    const exp = emptyExperience(memberId);
    exp.totalClaims = n(c.totalClaims);
    exp.paidClaims = n(c.paidClaims);
    exp.oopCents = n(c.oopCents);
    exp.worstFillCents = n(c.worstFillCents);
    exp.brandPenaltyClaims = n(c.brandPenaltyClaims);
    exp.deductibleClaims = n(c.deductibleClaims);
    exp.extendedSupplyClaims = n(c.extendedSupplyClaims);
    exp.reversals = n(c.reversals);
    exp.rejectsPaRequired = n(c.rejPa);
    exp.rejectsStepTherapy = n(c.rejStep);
    exp.rejectsQuantity = n(c.rejQty);
    exp.rejectsRefillTooSoon = n(c.rejRefill);
    exp.rejectsTerminated = n(c.rejTerm);
    exp.rejectsOutOfNetwork = n(c.rejOon);

    const pa = pas.get(memberId);
    if (pa) {
      exp.paDenied = n(pa.denied);
      exp.paSlow = n(pa.slow);
      exp.paOnTime = n(pa.onTime);
    }

    exp.majorDurAlerts = durs.get(memberId) ?? 0;
    exp.retroClawback = clawbacks.has(memberId);

    out.push(exp);
  }

  // Sorted so that anything downstream which samples or truncates does so the
  // same way every time.
  out.sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
  return out;
}
