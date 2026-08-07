/**
 * Money movement, cut against the simulation clock.
 *
 * The schedule for the whole plan year is laid down in advance: twenty-four
 * pharmacy remittance cycles, twelve sponsor invoices, and a rebate invoice
 * per manufacturer per quarter. None of them carry a status column. Whether a
 * cycle has been paid, an invoice has gone out, or a receivable has aged past
 * terms is decided here by comparing its dates to the clock, so the payment
 * calendar advances on its own as the demo runs and pinning the clock to a
 * past date reproduces the ledger exactly as it stood.
 *
 * The period currently in flight is the one exception to reading the prebuilt
 * rows. Its stored totals cover the whole cycle including days that have not
 * happened, so it is recomputed live from claims up to now.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { DEFAULT_BOOK, MICHIGAN_DEMO_SPONSOR_ID } from "@/lib/book-context";
import { WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";
import { MICHIGAN_CONTRACT } from "@/lib/contracts/michigan";

const DAY_MS = 86_400_000;

/** Admin / rebate-admin PMPM for a sponsor, preferring the Contract row. */
async function adminFeesForSponsor(sponsorId: string): Promise<{
  adminFeePmpmCommercialCents: number;
  rebateAdminFeePmpmCents: number;
}> {
  const sponsor = await prisma.planSponsor.findUnique({
    where: { id: sponsorId },
    select: {
      contract: {
        select: {
          adminFeePmpmCommercialCents: true,
          rebateAdminFeePmpmCents: true,
        },
      },
    },
  });
  if (sponsor?.contract) {
    return {
      adminFeePmpmCommercialCents:
        sponsor.contract.adminFeePmpmCommercialCents,
      rebateAdminFeePmpmCents: sponsor.contract.rebateAdminFeePmpmCents,
    };
  }
  if (sponsorId === MICHIGAN_DEMO_SPONSOR_ID) {
    return {
      adminFeePmpmCommercialCents:
        MICHIGAN_CONTRACT.adminFeePmpmCommercialCents,
      rebateAdminFeePmpmCents: MICHIGAN_CONTRACT.rebateAdminFeePmpmCents,
    };
  }
  return {
    adminFeePmpmCommercialCents:
      WISCONSIN_CONTRACT.adminFeePmpmCommercialCents,
    rebateAdminFeePmpmCents: WISCONSIN_CONTRACT.rebateAdminFeePmpmCents,
  };
}

// ---------------------------------------------------------------------------
// Pharmacy remittance
// ---------------------------------------------------------------------------

export interface RemittanceCycle {
  id: string;
  cycleStart: Date;
  cycleEnd: Date;
  paidAt: Date;
  /** "Paid" once the payment date has passed, "Scheduled" before then. */
  status: "Paid" | "Scheduled" | "In flight";
  pharmacyCount: number;
  claimCount: number;
  reversalCount: number;
  grossCents: number;
  reversalCents: number;
  netCents: number;
}

export interface PharmacyPayment {
  pharmacyId: string;
  name: string;
  chain: string | null;
  claimCount: number;
  reversalCount: number;
  grossCents: number;
  reversalCents: number;
  netCents: number;
}

export interface SettlementOverview {
  cycles: RemittanceCycle[];
  /** The cycle whose window contains now, recomputed from claims to date. */
  inFlight: RemittanceCycle | null;
  /** Pharmacy detail for the most recently paid cycle. */
  lastPaid: { cycle: RemittanceCycle; lines: PharmacyPayment[] } | null;
  paidToDateCents: number;
  scheduledCents: number;
  /** Reversals recovered from the network so far, as a positive number. */
  recoveredFromNetworkCents: number;
}

export async function getSettlementOverview(
  clock: SimulationClock,
  sponsorId: string = DEFAULT_BOOK.sponsorId,
): Promise<SettlementOverview> {
  const runs = await prisma.remittanceRun.findMany({
    where: { sponsorId, cycleStart: { lte: clock.now } },
    orderBy: { cycleStart: "desc" },
  });

  const cycles: RemittanceCycle[] = [];
  let inFlight: RemittanceCycle | null = null;

  for (const r of runs) {
    if (r.cycleEnd >= clock.now) {
      inFlight = {
        ...r,
        status: "In flight",
        ...(await cycleToDate(r.id, r.cycleStart, clock.now, sponsorId)),
      };
      continue;
    }
    cycles.push({
      ...r,
      status: r.paidAt <= clock.now ? "Paid" : "Scheduled",
    });
  }

  const paidToDateCents = cycles
    .filter((c) => c.status === "Paid")
    .reduce((s, c) => s + c.netCents, 0);
  const scheduledCents =
    cycles
      .filter((c) => c.status === "Scheduled")
      .reduce((s, c) => s + c.netCents, 0) + (inFlight?.netCents ?? 0);
  const recoveredFromNetworkCents = -cycles
    .filter((c) => c.status === "Paid")
    .reduce((s, c) => s + c.reversalCents, 0);

  const lastPaidCycle = cycles.find((c) => c.status === "Paid") ?? null;
  const lastPaid = lastPaidCycle
    ? { cycle: lastPaidCycle, lines: await paymentLines(lastPaidCycle.id) }
    : null;

  return {
    cycles,
    inFlight,
    lastPaid,
    paidToDateCents,
    scheduledCents,
    recoveredFromNetworkCents,
  };
}

/** Recomputes a cycle from the claims that have actually landed in it. */
async function cycleToDate(
  runId: string,
  start: Date,
  now: Date,
  sponsorId: string,
): Promise<
  Pick<
    RemittanceCycle,
    | "pharmacyCount"
    | "claimCount"
    | "reversalCount"
    | "grossCents"
    | "reversalCents"
    | "netCents"
  >
> {
  void runId;
  const [row] = await prisma.$queryRaw<
    Array<{
      pharmacies: number;
      claims: number;
      reversals: number;
      gross: number | null;
      reversed: number | null;
    }>
  >`
    SELECT COUNT(DISTINCT pharmacyId) AS pharmacies,
           SUM(CASE WHEN transactionCode = 'B1' THEN 1 ELSE 0 END) AS claims,
           SUM(CASE WHEN transactionCode = 'B2' THEN 1 ELSE 0 END) AS reversals,
           SUM(CASE WHEN transactionCode = 'B1' THEN pharmacyPaidCents ELSE 0 END) AS gross,
           SUM(CASE WHEN transactionCode = 'B2' THEN pharmacyPaidCents ELSE 0 END) AS reversed
    FROM Claim
    WHERE (responseStatus = 'P' OR responseStatus = 'A')
      AND sponsorId = ${sponsorId}
      AND dateOfService >= ${start} AND dateOfService <= ${now}
  `;
  const gross = Number(row?.gross ?? 0);
  const reversed = Number(row?.reversed ?? 0);
  return {
    pharmacyCount: Number(row?.pharmacies ?? 0),
    claimCount: Number(row?.claims ?? 0),
    reversalCount: Number(row?.reversals ?? 0),
    grossCents: gross,
    reversalCents: reversed,
    netCents: gross + reversed,
  };
}

async function paymentLines(runId: string): Promise<PharmacyPayment[]> {
  const rows = await prisma.remittanceLine.findMany({
    where: { runId },
    include: { pharmacy: { select: { name: true, chainName: true } } },
    orderBy: { netCents: "desc" },
  });
  return rows.map((r) => ({
    pharmacyId: r.pharmacyId,
    name: r.pharmacy.name,
    chain: r.pharmacy.chainName,
    claimCount: r.claimCount,
    reversalCount: r.reversalCount,
    grossCents: r.grossCents,
    reversalCents: r.reversalCents,
    netCents: r.netCents,
  }));
}

// ---------------------------------------------------------------------------
// Sponsor invoicing
// ---------------------------------------------------------------------------

export interface SponsorBill {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  dueAt: Date;
  status: "Paid" | "Issued" | "Accruing";
  claimCount: number;
  reversalCount: number;
  drugCostCents: number;
  memberMonths: number;
  adminFeeCents: number;
  rebateCreditCents: number;
  rebateAdminFeeCents: number;
  totalDueCents: number;
}

export interface InvoiceOverview {
  bills: SponsorBill[];
  billedToDateCents: number;
  adminFeeToDateCents: number;
  /**
   * Administrative fee as a share of total billings. The number that makes the
   * point: the PBM's own revenue is a rounding error next to the drug spend it
   * sits on top of, which is why the spread has to be hidden somewhere else.
   */
  adminFeeShareBps: number;
  adminFeePmpmCents: number;
}

export async function getInvoiceOverview(
  clock: SimulationClock,
  sponsorId: string = DEFAULT_BOOK.sponsorId,
): Promise<InvoiceOverview> {
  const [rows, fees] = await Promise.all([
    prisma.sponsorInvoice.findMany({
      where: { sponsorId, periodStart: { lte: clock.now } },
      orderBy: { periodStart: "desc" },
    }),
    adminFeesForSponsor(sponsorId),
  ]);

  const bills: SponsorBill[] = [];
  for (const r of rows) {
    const accruing = r.periodEnd >= clock.now;
    const bill: SponsorBill = {
      ...r,
      status: accruing ? "Accruing" : r.dueAt <= clock.now ? "Paid" : "Issued",
    };
    if (accruing) {
      /*
       * The stored row covers the whole month, including days that have not
       * happened. Drug cost and the rebate credit both have to be cut at the
       * clock, or a half-finished month shows a full month of rebate against
       * half a month of spend and comes out looking like a refund.
       */
      const live = await monthToDate(r.periodStart, clock.now, sponsorId);
      bill.claimCount = live.claims;
      bill.reversalCount = live.reversals;
      bill.drugCostCents = live.drugCost;
      bill.rebateCreditCents = await rebatesCollectedBetween(
        r.periodStart,
        clock.now,
        sponsorId,
      );
      bill.totalDueCents =
        live.drugCost + r.adminFeeCents - bill.rebateCreditCents;
    }
    bills.push(bill);
  }

  const settled = bills.filter((b) => b.status !== "Accruing");
  const billedToDateCents = settled.reduce((s, b) => s + b.totalDueCents, 0);
  const adminFeeToDateCents = settled.reduce(
    (s, b) => s + b.adminFeeCents + b.rebateAdminFeeCents,
    0,
  );

  return {
    bills,
    billedToDateCents,
    adminFeeToDateCents,
    adminFeeShareBps:
      billedToDateCents > 0
        ? Math.round((adminFeeToDateCents / billedToDateCents) * 10_000)
        : 0,
    adminFeePmpmCents:
      fees.adminFeePmpmCommercialCents + fees.rebateAdminFeePmpmCents,
  };
}

async function rebatesCollectedBetween(
  start: Date,
  end: Date,
  sponsorId: string,
): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ credited: number | null }>>`
    SELECT SUM(collectedCents) AS credited FROM RebateInvoice
    WHERE sponsorId = ${sponsorId}
      AND collectedAt IS NOT NULL
      AND collectedAt >= ${start} AND collectedAt <= ${end}
  `;
  return Number(row?.credited ?? 0);
}

async function monthToDate(start: Date, now: Date, sponsorId: string) {
  const [row] = await prisma.$queryRaw<
    Array<{ claims: number; reversals: number; drugCost: number | null }>
  >`
    SELECT SUM(CASE WHEN transactionCode = 'B1' THEN 1 ELSE 0 END) AS claims,
           SUM(CASE WHEN transactionCode = 'B2' THEN 1 ELSE 0 END) AS reversals,
           SUM(planPaidCents) AS drugCost
    FROM Claim
    WHERE (responseStatus = 'P' OR responseStatus = 'A')
      AND sponsorId = ${sponsorId}
      AND dateOfService >= ${start} AND dateOfService <= ${now}
  `;
  return {
    claims: Number(row?.claims ?? 0),
    reversals: Number(row?.reversals ?? 0),
    drugCost: Number(row?.drugCost ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Rebate receivables
// ---------------------------------------------------------------------------

export interface RebateQuarter {
  quarter: string;
  periodEnd: Date;
  submittedAt: Date;
  dueAt: Date;
  status: "Accruing" | "Invoiced" | "Overdue" | "Collected";
  manufacturers: number;
  claimCount: number;
  invoicedCents: number;
  collectedCents: number;
  disputedCents: number;
  outstandingCents: number;
  /** Days past the due date, once it has passed. */
  daysLate: number;
}

export interface AgingBucket {
  label: string;
  invoices: number;
  cents: number;
}

export interface RebateLedger {
  quarters: RebateQuarter[];
  aging: AgingBucket[];
  accruedCents: number;
  collectedCents: number;
  outstandingCents: number;
  disputedCents: number;
  /** Mean days between the fill and the cash arriving, weighted by dollars. */
  meanDaysToCash: number;
  topDebtors: Array<{
    manufacturer: string;
    outstandingCents: number;
    oldestDays: number;
  }>;
  /**
   * Interest a PBM would earn holding the outstanding balance for the average
   * collection period, at the assumed short-term rate. This is the float.
   */
  floatValueCents: number;
  floatRateBps: number;
}

/**
 * Short-term rate used to value the float. Deliberately conservative: the
 * point is the size of the balance, not the yield assumption.
 */
const FLOAT_RATE_BPS = 450;

export async function getRebateLedger(
  clock: SimulationClock,
  sponsorId: string = DEFAULT_BOOK.sponsorId,
): Promise<RebateLedger> {
  const invoices = await prisma.rebateInvoice.findMany({
    where: { sponsorId },
    orderBy: [{ periodEnd: "asc" }, { invoicedCents: "desc" }],
  });

  const now = clock.now;
  const collected = (i: (typeof invoices)[number]) =>
    i.collectedAt && i.collectedAt <= now ? i.collectedCents : 0;
  const invoiced = (i: (typeof invoices)[number]) =>
    i.submittedAt <= now ? i.invoicedCents : 0;

  // Everything the book has earned is a receivable the moment it is earned,
  // whether or not the quarter has closed. That is the number that matters.
  const accruedCents = invoices
    .filter((i) => i.periodStart <= now)
    .reduce((s, i) => s + earnedToDate(i, now), 0);
  const collectedCents = invoices.reduce((s, i) => s + collected(i), 0);
  const outstandingCents = accruedCents - collectedCents;
  const disputedCents = invoices
    .filter((i) => i.submittedAt <= now)
    .reduce((s, i) => s + i.disputedCents, 0);

  // --- By quarter ---------------------------------------------------------
  const byQuarter = new Map<string, typeof invoices>();
  for (const i of invoices) {
    if (i.periodStart > now) continue;
    byQuarter.set(i.quarter, [...(byQuarter.get(i.quarter) ?? []), i]);
  }

  const quarters: RebateQuarter[] = [];
  for (const [quarter, group] of byQuarter) {
    const head = group[0];
    const inv = group.reduce((s, i) => s + invoiced(i), 0);
    const coll = group.reduce((s, i) => s + collected(i), 0);
    const earned = group.reduce((s, i) => s + earnedToDate(i, now), 0);
    const allCollected = group.every(
      (i) => i.collectedAt && i.collectedAt <= now,
    );
    const daysLate =
      head.dueAt <= now
        ? Math.floor((now.getTime() - head.dueAt.getTime()) / DAY_MS)
        : 0;

    quarters.push({
      quarter,
      periodEnd: head.periodEnd,
      submittedAt: head.submittedAt,
      dueAt: head.dueAt,
      status: allCollected
        ? "Collected"
        : head.submittedAt > now
          ? "Accruing"
          : daysLate > 0
            ? "Overdue"
            : "Invoiced",
      manufacturers: new Set(group.map((g) => g.manufacturer)).size,
      claimCount: group.reduce((s, i) => s + i.claimCount, 0),
      invoicedCents: inv,
      collectedCents: coll,
      disputedCents: group.reduce(
        (s, i) => s + (i.submittedAt <= now ? i.disputedCents : 0),
        0,
      ),
      outstandingCents: earned - coll,
      daysLate,
    });
  }
  quarters.sort((a, b) => a.periodEnd.getTime() - b.periodEnd.getTime());

  // --- Aging ---------------------------------------------------------------
  const buckets: Array<[label: string, min: number, max: number]> = [
    ["Not yet invoiced", -Infinity, -1],
    ["Current", 0, 30],
    ["31 to 60 days", 31, 60],
    ["61 to 90 days", 61, 90],
    ["Over 90 days", 91, Infinity],
  ];
  const aging: AgingBucket[] = buckets.map(([label]) => ({
    label,
    invoices: 0,
    cents: 0,
  }));

  for (const i of invoices) {
    if (i.periodStart > now) continue;
    if (i.collectedAt && i.collectedAt <= now) continue;
    const open = earnedToDate(i, now);
    if (open <= 0) continue;
    const age =
      i.submittedAt > now
        ? -1
        : Math.floor((now.getTime() - i.submittedAt.getTime()) / DAY_MS);
    const idx = buckets.findIndex(([, min, max]) => age >= min && age <= max);
    aging[idx].invoices++;
    aging[idx].cents += open;
  }

  // --- Debtors -------------------------------------------------------------
  const debtors = new Map<string, { cents: number; oldest: number }>();
  for (const i of invoices) {
    if (i.periodStart > now) continue;
    if (i.collectedAt && i.collectedAt <= now) continue;
    const open = earnedToDate(i, now);
    if (open <= 0) continue;
    const age = Math.max(
      0,
      Math.floor((now.getTime() - i.periodEnd.getTime()) / DAY_MS),
    );
    const cur = debtors.get(i.manufacturer) ?? { cents: 0, oldest: 0 };
    debtors.set(i.manufacturer, {
      cents: cur.cents + open,
      oldest: Math.max(cur.oldest, age),
    });
  }
  const topDebtors = [...debtors.entries()]
    .map(([manufacturer, v]) => ({
      manufacturer,
      outstandingCents: v.cents,
      oldestDays: v.oldest,
    }))
    .sort((a, b) => b.outstandingCents - a.outstandingCents)
    .slice(0, 8);

  // --- Float ---------------------------------------------------------------
  // Days from the midpoint of the earning quarter to the scheduled collection,
  // weighted by dollars, is how long the money is in somebody else's hands.
  let weighted = 0;
  let weight = 0;
  for (const i of invoices) {
    if (!i.collectedAt) continue;
    const mid = (i.periodStart.getTime() + i.periodEnd.getTime()) / 2;
    weighted +=
      ((i.collectedAt.getTime() - mid) / DAY_MS) * i.invoicedCents;
    weight += i.invoicedCents;
  }
  const meanDaysToCash = weight > 0 ? Math.round(weighted / weight) : 0;

  return {
    quarters,
    aging,
    accruedCents,
    collectedCents,
    outstandingCents,
    disputedCents,
    meanDaysToCash,
    topDebtors,
    floatValueCents: Math.round(
      (outstandingCents * (FLOAT_RATE_BPS / 10_000) * meanDaysToCash) / 365,
    ),
    floatRateBps: FLOAT_RATE_BPS,
  };
}

/**
 * Rebate earned so far on a quarter's fills.
 *
 * A quarter still in progress has only earned the part of it that has
 * happened, pro-rated by elapsed days. Once the quarter closes the whole
 * invoice is earned whether or not it has been sent.
 */
function earnedToDate(
  invoice: { periodStart: Date; periodEnd: Date; invoicedCents: number },
  now: Date,
): number {
  if (now >= invoice.periodEnd) return invoice.invoicedCents;
  if (now <= invoice.periodStart) return 0;
  const total = invoice.periodEnd.getTime() - invoice.periodStart.getTime();
  const done = now.getTime() - invoice.periodStart.getTime();
  return Math.round(invoice.invoicedCents * (done / total));
}
