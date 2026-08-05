/**
 * Guarantee reconciliation: what was promised, what happened, what is owed.
 *
 * The financial guarantees are measured on the whole book to date and cannot
 * really be missed, for a reason worth saying out loud: the discount is applied
 * when the claim is priced, not reconciled afterwards. A contract that prices
 * at the guaranteed rate every time has nothing to true up. That is the point
 * of the design, and it is also why the interesting half of this page is the
 * other half.
 *
 * The operational guarantees are measured monthly, because an annual
 * measurement absorbs almost anything. Four bad days in June against a full
 * year of prior authorisations is 99.6% and a clean scorecard; against June it
 * is 94.9% and a credit. Both numbers are true. Which one appears in the
 * report is a drafting decision, and it is the single cheapest concession a
 * sponsor gives away without noticing.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { PLAN_YEAR, PLAN_YEAR_START } from "@/lib/clock";
import { WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";
import {
  PERFORMANCE_GUARANTEES,
  RECONCILIATION_CALENDAR,
  penaltyFor,
  type PerformanceGuarantee,
} from "@/lib/contracts/guarantees";

const DAY_MS = 86_400_000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface PeriodResult {
  month: number;
  label: string;
  /** Cases the measure was taken over. A percentage without one is a claim. */
  sample: number;
  hits: number;
  measured: number;
  met: boolean;
  shortfall: number;
  creditCents: number;
  band: string;
}

export interface ScorecardRow {
  guarantee: PerformanceGuarantee;
  periods: PeriodResult[];
  /** The same measure taken across the whole year to date, for contrast. */
  annualMeasured: number;
  annualSample: number;
  annualMet: boolean;
  missedPeriods: number;
  creditCents: number;
}

export interface Scorecard {
  rows: ScorecardRow[];
  closedMonths: number;
  totalCreditCents: number;
  /** What the same year would have produced measured annually instead. */
  creditIfMeasuredAnnuallyCents: number;
}

/** Months that have fully elapsed against the clock. */
function closedMonths(clock: SimulationClock): number[] {
  const out: number[] = [];
  for (let m = 0; m < 12; m++) {
    const end = Date.UTC(PLAN_YEAR, m + 1, 1);
    if (end <= clock.now.getTime()) out.push(m);
  }
  return out;
}

/** Business days between two instants, counting Saturday and Sunday out. */
function businessDaysBetween(from: Date, to: Date): number {
  let days = 0;
  const cursor = new Date(from.getTime());
  while (cursor < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

interface Measurement {
  month: number;
  sample: number;
  hits: number;
}

/** Prior authorisation turnaround, measured from receipt to decision. */
async function measurePa(
  urgency: string,
  hours: number,
): Promise<Measurement[]> {
  const rows = await prisma.$queryRaw<
    Array<{ month: number; sample: number; hits: number }>
  >`
    SELECT CAST(STRFTIME('%m', receivedAt / 1000, 'unixepoch') AS INTEGER) - 1 AS month,
           COUNT(*) AS sample,
           SUM(CASE WHEN (decidedAt - receivedAt) <= ${hours * 3_600_000}
                    THEN 1 ELSE 0 END) AS hits
    FROM PriorAuthorization
    WHERE decidedAt IS NOT NULL AND urgency = ${urgency}
      AND STRFTIME('%Y', receivedAt / 1000, 'unixepoch') = ${String(PLAN_YEAR)}
    GROUP BY month
  `;
  return rows.map((r) => ({
    month: Number(r.month),
    sample: Number(r.sample),
    hits: Number(r.hits),
  }));
}

/** Eligibility files loaded inside two business days of arrival. */
async function measureEligibility(): Promise<Measurement[]> {
  const files = await prisma.eligibilityFile.findMany({
    where: {
      receivedAt: {
        gte: new Date(Date.UTC(PLAN_YEAR, 0, 1)),
        lt: new Date(Date.UTC(PLAN_YEAR + 1, 0, 1)),
      },
    },
    select: { receivedAt: true, processedAt: true },
  });
  const byMonth = new Map<number, Measurement>();
  for (const f of files) {
    const month = f.receivedAt.getUTCMonth();
    const entry = byMonth.get(month) ?? { month, sample: 0, hits: 0 };
    entry.sample++;
    if (businessDaysBetween(f.receivedAt, f.processedAt) <= 2) entry.hits++;
    byMonth.set(month, entry);
  }
  return [...byMonth.values()];
}

/** MAC appeals resolved inside the twenty-one days the statute allows. */
async function measureAppeals(): Promise<Measurement[]> {
  const rows = await prisma.$queryRaw<
    Array<{ month: number; sample: number; hits: number }>
  >`
    SELECT CAST(STRFTIME('%m', submittedAt / 1000, 'unixepoch') AS INTEGER) - 1 AS month,
           COUNT(*) AS sample,
           SUM(CASE WHEN (decidedAt - submittedAt) <= ${21 * DAY_MS}
                    THEN 1 ELSE 0 END) AS hits
    FROM MacAppeal
    WHERE STRFTIME('%Y', submittedAt / 1000, 'unixepoch') = ${String(PLAN_YEAR)}
    GROUP BY month
  `;
  return rows.map((r) => ({
    month: Number(r.month),
    sample: Number(r.sample),
    hits: Number(r.hits),
  }));
}

/**
 * Financial accuracy, measured by auditing every paid claim rather than a
 * sample of two hundred.
 *
 * A claim is accurate when the money it moved obeys the contract: the plan is
 * billed exactly what the network collects, the member's share never exceeds
 * what the benefit allows on that fill, and nothing was paid on a claim that
 * was rejected. Those are the three ways money goes wrong, and all three are
 * checkable on every row.
 */
async function measureAccuracy(): Promise<Measurement[]> {
  const rows = await prisma.$queryRaw<
    Array<{ month: number; sample: number; defects: number }>
  >`
    SELECT CAST(STRFTIME('%m', dateOfService / 1000, 'unixepoch') AS INTEGER) - 1 AS month,
           COUNT(*) AS sample,
           SUM(CASE
                 WHEN transactionCode = 'B1' AND responseStatus = 'P'
                      AND (totalBilledCents <> pharmacyPaidCents + patientPayCents
                           OR planPaidCents + patientPayCents <> totalBilledCents
                           OR patientPayCents > totalBilledCents)
                 THEN 1
                 WHEN responseStatus = 'R'
                      AND (planPaidCents <> 0 OR patientPayCents <> 0
                           OR pharmacyPaidCents <> 0)
                 THEN 1
                 ELSE 0
               END) AS defects
    FROM Claim
    WHERE STRFTIME('%Y', dateOfService / 1000, 'unixepoch') = ${String(PLAN_YEAR)}
    GROUP BY month
  `;
  return rows.map((r) => ({
    month: Number(r.month),
    sample: Number(r.sample),
    hits: Number(r.sample) - Number(r.defects),
  }));
}

const MEASURES: Record<string, () => Promise<Measurement[]>> = {
  "pa-standard": () => measurePa("Standard", 72),
  "pa-expedited": () => measurePa("Expedited", 24),
  "eligibility-load": measureEligibility,
  "mac-appeal": measureAppeals,
  "claim-accuracy": measureAccuracy,
};

export async function getScorecard(clock: SimulationClock): Promise<Scorecard> {
  const months = closedMonths(clock);
  const measured = await Promise.all(
    PERFORMANCE_GUARANTEES.map(async (g) => ({
      guarantee: g,
      data: await MEASURES[g.id](),
    })),
  );

  const rows: ScorecardRow[] = measured.map(({ guarantee, data }) => {
    const inYear = data.filter((d) => months.includes(d.month));

    const periods = inYear
      .filter((d) => d.sample > 0)
      .map((d) => {
        const value = (d.hits / d.sample) * 100;
        const penalty = penaltyFor(guarantee, value);
        /*
         * A twelfth of the annual amount is at risk each month, which is what
         * makes a monthly measurement fair rather than punitive: a single bad
         * month costs a twelfth, not the year.
         */
        const creditCents = Math.round(
          (guarantee.atRiskCents / 12) * penalty.share,
        );
        return {
          month: d.month,
          label: MONTHS[d.month],
          sample: d.sample,
          hits: d.hits,
          measured: value,
          met: penalty.shortfall <= 0,
          shortfall: penalty.shortfall,
          creditCents,
          band: penalty.band,
        };
      })
      .sort((a, b) => a.month - b.month);

    const sample = inYear.reduce((s, d) => s + d.sample, 0);
    const hits = inYear.reduce((s, d) => s + d.hits, 0);
    const annualMeasured = sample > 0 ? (hits / sample) * 100 : 100;

    return {
      guarantee,
      periods,
      annualMeasured,
      annualSample: sample,
      annualMet: penaltyFor(guarantee, annualMeasured).shortfall <= 0,
      missedPeriods: periods.filter((p) => !p.met).length,
      creditCents: periods.reduce((s, p) => s + p.creditCents, 0),
    };
  });

  return {
    rows,
    closedMonths: months.length,
    totalCreditCents: rows.reduce((s, r) => s + r.creditCents, 0),
    creditIfMeasuredAnnuallyCents: rows.reduce(
      (s, r) =>
        s +
        Math.round(
          r.guarantee.atRiskCents * penaltyFor(r.guarantee, r.annualMeasured).share,
        ),
      0,
    ),
  };
}

export interface IncidentRow {
  id: string;
  startedAt: Date;
  endedAt: Date;
  notifiedAt: Date;
  title: string;
  severity: string;
  summary: string;
  cause: string;
  remedy: string;
  guaranteeId: string | null;
  /** Hours from the start of the incident to telling the sponsor. */
  notifiedWithinHours: number;
}

export async function getIncidents(
  clock: SimulationClock,
): Promise<IncidentRow[]> {
  const rows = await prisma.serviceIncident.findMany({
    where: { startedAt: { lte: clock.now } },
    orderBy: { startedAt: "desc" },
  });
  return rows.map((r) => ({
    ...r,
    notifiedWithinHours: Math.round(
      (r.notifiedAt.getTime() - r.startedAt.getTime()) / 3_600_000,
    ),
  }));
}

export interface CalendarStage {
  label: string;
  date: Date;
  detail: string;
  status: "done" | "current" | "ahead";
}

export interface SettlementPlan {
  stages: CalendarStage[];
  /** Credits owed to the sponsor for the year so far. */
  creditCents: number;
  /** Administrative fees billed to date, which is what the credit offsets. */
  adminFeeCents: number;
  creditAsShareOfFeesBps: number;
  auditWindowYears: number;
}

export async function getSettlementPlan(
  clock: SimulationClock,
  creditCents: number,
): Promise<SettlementPlan> {
  const yearEnd = new Date(Date.UTC(PLAN_YEAR + 1, 0, 1));
  const runoutClose = new Date(
    yearEnd.getTime() + RECONCILIATION_CALENDAR.runoutDays * DAY_MS,
  );
  const published = new Date(
    runoutClose.getTime() + RECONCILIATION_CALENDAR.publishDays * DAY_MS,
  );
  const settled = new Date(
    published.getTime() + RECONCILIATION_CALENDAR.settleDays * DAY_MS,
  );

  const stage = (
    label: string,
    date: Date,
    detail: string,
  ): CalendarStage => ({
    label,
    date,
    detail,
    status: date <= clock.now ? "done" : "ahead",
  });

  const stages = [
    stage(
      "Plan year opens",
      PLAN_YEAR_START,
      "Guarantees begin. Every measure below is computed from records created after this date.",
    ),
    stage(
      "Plan year closes",
      yearEnd,
      "Last date of service inside the measurement year.",
    ),
    stage(
      "Runout closes",
      runoutClose,
      `${RECONCILIATION_CALENDAR.runoutDays} days for pharmacies to submit and reverse against the closed year.`,
    ),
    stage(
      "Reconciliation published",
      published,
      "Every measure, every period, and the claim-level file behind each one.",
    ),
    stage(
      "Credits applied",
      settled,
      "Applied against the administrative fee on the next invoice, or paid if the contract has ended.",
    ),
  ];

  const current = stages.find((s) => s.status === "ahead");
  if (current) current.status = "current";

  const invoices = await prisma.sponsorInvoice.aggregate({
    where: { periodEnd: { lte: clock.now } },
    _sum: { adminFeeCents: true },
  });
  const adminFeeCents = invoices._sum.adminFeeCents ?? 0;

  return {
    stages,
    creditCents,
    adminFeeCents,
    creditAsShareOfFeesBps:
      adminFeeCents > 0 ? Math.round((creditCents / adminFeeCents) * 10_000) : 0,
    auditWindowYears: RECONCILIATION_CALENDAR.auditWindowYears,
  };
}

export interface RebateFloor {
  brandClaims: number;
  floorPerClaimCents: number;
  floorCents: number;
  actualCents: number;
  perClaimCents: number;
  met: boolean;
  surplusCents: number;
}

/**
 * The rebate floor, which is the one financial guarantee that can genuinely
 * be missed, because it depends on what manufacturers pay rather than on how a
 * claim is priced.
 */
export async function getRebateFloor(
  clock: SimulationClock,
): Promise<RebateFloor> {
  const agg = await prisma.bookDay.aggregate({
    where: { date: { gte: PLAN_YEAR_START, lte: clock.today } },
    _sum: { estimatedRebateCents: true, brandClaims: true },
  });

  const brandClaims = agg._sum.brandClaims ?? 0;
  const actualCents = agg._sum.estimatedRebateCents ?? 0;
  // Exhibit C, commercial retail brand: the per-brand-claim minimum.
  const floorPerClaimCents = 10_000;
  const floorCents = brandClaims * floorPerClaimCents;

  return {
    brandClaims,
    floorPerClaimCents,
    floorCents,
    actualCents,
    perClaimCents: brandClaims > 0 ? Math.round(actualCents / brandClaims) : 0,
    met: actualCents >= floorCents,
    surplusCents: actualCents - floorCents,
  };
}

export const CONTRACT_NAME = WISCONSIN_CONTRACT.name;
