/**
 * The parts of a PBM that move money rather than decide it.
 *
 * Adjudication answers what a claim is worth. It does not reverse the fill the
 * patient never collected, chase the rebate a manufacturer owes two quarters
 * later, pay the pharmacy on Friday, or invoice the plan at month end. Those
 * are the operations, and leaving them out is what makes a demo feel like a
 * demo: the happy path priced perfectly and nothing ever going wrong or
 * actually settling.
 *
 * Four things get built here, in order, because each depends on the last:
 *
 *   1. Reversals. About two per cent of fills never leave the counter.
 *   2. Retroactive terminations. Employers report leavers late, so some claims
 *      were paid for people who had already gone.
 *   3. Rebate invoicing. Earned on the fill, invoiced a quarter later,
 *      collected months after that.
 *   4. Settlement. Pharmacies paid on the contractual cycle, the plan invoiced
 *      monthly, and the two tied together.
 *
 *   npx tsx scripts/build-financials.ts
 */

import { prisma } from "../src/lib/db.js";
import { Rng } from "./seed/population.js";
import { WISCONSIN_CONTRACT } from "../src/lib/contracts/wisconsin.js";

const PLAN_YEAR = 2026;
const DAY_MS = 86_400_000;

/**
 * Industry reversal rates sit around two per cent of fills: the patient never
 * came back for it, the prescriber changed the therapy, the pharmacy keyed the
 * wrong strength, or coverage turned out to be elsewhere.
 */
const REVERSAL_RATE = 0.021;

async function main() {
  const started = Date.now();
  await buildReversals();
  await buildRetroTerminations();
  await buildRebateInvoices();
  await buildSettlement();
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------------------
// 1. Reversals
// ---------------------------------------------------------------------------

const REVERSAL_REASONS = [
  "Prescription not collected within the pharmacy's hold period",
  "Therapy changed by the prescriber before pick-up",
  "Dispensed in error; wrong strength keyed",
  "Member presented other coverage after the fill",
  "Quantity corrected and rebilled",
  "Duplicate submission by the pharmacy",
];

async function buildReversals() {
  console.log("Reversals...");
  await prisma.claim.deleteMany({ where: { transactionCode: "B2" } });

  const [{ maxSeq }] = await prisma.$queryRaw<Array<{ maxSeq: bigint | null }>>`
    SELECT MAX(CAST(SUBSTR(claimNumber, 4) AS INTEGER)) AS maxSeq FROM Claim
  `;
  let seq = Number(maxSeq ?? 0) + 100_000;

  /*
   * Selected deterministically off the claim sequence rather than at random,
   * so the same fills reverse on every run and the book does not change shape
   * between rehearsal and the meeting.
   */
  const modulus = Math.round(1 / REVERSAL_RATE);
  const originals = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      claimNumber: string;
      sponsorId: string;
      memberId: string;
      eligibilitySpanId: string | null;
      benefitPlanId: string;
      pharmacyId: string;
      drugId: string;
      contractId: string;
      dateOfService: number;
      rxNumber: string;
      fillNumber: number;
      quantityDispensed: number;
      daysSupply: number;
      prescriberNpi: string | null;
      totalBilledCents: number;
      planPaidCents: number;
      patientPayCents: number;
      totalAllowedCents: number;
      pharmacyPaidCents: number;
      allowedIngredientCostCents: number;
      allowedDispensingFeeCents: number;
      billedIngredientCostCents: number;
      billedDispensingFeeCents: number;
      appliedToDeductibleCents: number;
      copayCoinsuranceCents: number;
      brandSelectionPenaltyCents: number;
      estimatedRebateCents: number;
      channel: string;
      formularyLevel: string | null;
      brandGenericClass: string | null;
      isSpecialtyClaim: boolean;
      scenarioTag: string | null;
    }>
  >(`
    SELECT id, claimNumber, sponsorId, memberId, eligibilitySpanId, benefitPlanId,
           pharmacyId, drugId, contractId, CAST(dateOfService AS REAL) AS dateOfService,
           rxNumber, fillNumber, quantityDispensed, daysSupply, prescriberNpi,
           totalBilledCents, planPaidCents, patientPayCents, totalAllowedCents,
           pharmacyPaidCents, allowedIngredientCostCents, allowedDispensingFeeCents,
           billedIngredientCostCents, billedDispensingFeeCents,
           appliedToDeductibleCents, copayCoinsuranceCents, brandSelectionPenaltyCents,
           estimatedRebateCents, channel, formularyLevel, brandGenericClass,
           isSpecialtyClaim, scenarioTag
    FROM Claim
    WHERE responseStatus = 'P' AND transactionCode = 'B1'
      AND CAST(SUBSTR(claimNumber, 4) AS INTEGER) % ${modulus} = 7
  `);

  const rng = new Rng(4242);
  const rows = originals.map((o) => {
    seq++;
    const reason = REVERSAL_REASONS[rng.int(0, REVERSAL_REASONS.length - 1)];
    // Reversals land within a fortnight, weighted early: most are the fill
    // nobody came back for, which the pharmacy clears on its own schedule.
    const lagDays = rng.next() < 0.6 ? rng.int(1, 4) : rng.int(5, 14);
    return {
      claimNumber: `CLM${String(seq).padStart(9, "0")}`,
      transactionCode: "B2",
      sponsorId: o.sponsorId,
      memberId: o.memberId,
      eligibilitySpanId: o.eligibilitySpanId,
      benefitPlanId: o.benefitPlanId,
      pharmacyId: o.pharmacyId,
      drugId: o.drugId,
      contractId: o.contractId,
      // NCPDP carries the original date of service on a reversal, so the
      // money backs out of the day it was booked to.
      dateOfService: new Date(Number(o.dateOfService)),
      rxNumber: o.rxNumber,
      fillNumber: o.fillNumber,
      quantityDispensed: -o.quantityDispensed,
      daysSupply: o.daysSupply,
      prescriberNpi: o.prescriberNpi,
      responseStatus: "A",
      rejectCodes: "[]",
      rejectMessage: reason,
      allowedIngredientCostCents: -o.allowedIngredientCostCents,
      allowedDispensingFeeCents: -o.allowedDispensingFeeCents,
      totalAllowedCents: -o.totalAllowedCents,
      pharmacyPaidCents: -o.pharmacyPaidCents,
      billedIngredientCostCents: -o.billedIngredientCostCents,
      billedDispensingFeeCents: -o.billedDispensingFeeCents,
      totalBilledCents: -o.totalBilledCents,
      planPaidCents: -o.planPaidCents,
      patientPayCents: -o.patientPayCents,
      appliedToDeductibleCents: -o.appliedToDeductibleCents,
      copayCoinsuranceCents: -o.copayCoinsuranceCents,
      brandSelectionPenaltyCents: -o.brandSelectionPenaltyCents,
      estimatedRebateCents: -o.estimatedRebateCents,
      channel: o.channel,
      formularyLevel: o.formularyLevel,
      brandGenericClass: o.brandGenericClass,
      isSpecialtyClaim: o.isSpecialtyClaim,
      scenarioTag: o.scenarioTag,
      reversalOfClaimId: o.id,
      adjudicatedAt: new Date(Number(o.dateOfService) + lagDays * DAY_MS),
    };
  });

  for (let i = 0; i < rows.length; i += 2000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.claim.createMany({ data: rows.slice(i, i + 2000) as any });
  }

  // The daily rollup carries reversals in their own columns so a day's paid
  // total stays a paid total and the two can be reconciled separately.
  await prisma.$executeRawUnsafe(`
    UPDATE BookDay SET
      reversalsProcessed = 0, reversalBilledCents = 0, reversalPlanPaidCents = 0,
      reversalPatientPayCents = 0, reversalRebateCents = 0
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE BookDay SET
      reversalsProcessed = COALESCE((SELECT COUNT(*) FROM Claim c
        WHERE c.transactionCode = 'B2' AND c.scenarioTag IS NULL
          AND c.dateOfService = BookDay.date), 0),
      reversalBilledCents = COALESCE((SELECT SUM(c.totalBilledCents) FROM Claim c
        WHERE c.transactionCode = 'B2' AND c.scenarioTag IS NULL
          AND c.dateOfService = BookDay.date), 0),
      reversalPlanPaidCents = COALESCE((SELECT SUM(c.planPaidCents) FROM Claim c
        WHERE c.transactionCode = 'B2' AND c.scenarioTag IS NULL
          AND c.dateOfService = BookDay.date), 0),
      reversalPatientPayCents = COALESCE((SELECT SUM(c.patientPayCents) FROM Claim c
        WHERE c.transactionCode = 'B2' AND c.scenarioTag IS NULL
          AND c.dateOfService = BookDay.date), 0),
      reversalRebateCents = COALESCE((SELECT SUM(c.estimatedRebateCents) FROM Claim c
        WHERE c.transactionCode = 'B2' AND c.scenarioTag IS NULL
          AND c.dateOfService = BookDay.date), 0)
  `);

  const [check] = await prisma.$queryRaw<
    Array<{ n: number; plan: number }>
  >`
    SELECT COUNT(*) AS n, SUM(planPaidCents) AS plan
    FROM Claim WHERE transactionCode = 'B2'
  `;
  console.log(
    `  ${Number(check.n).toLocaleString()} reversals, ` +
      `$${(Math.abs(Number(check.plan)) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} backed out`,
  );
}

// ---------------------------------------------------------------------------
// 2. Retroactive terminations
// ---------------------------------------------------------------------------

/**
 * Employers report leavers late. The eligibility file arrives with a
 * termination date already in the past, and every claim paid in between is
 * money the plan is entitled to recover.
 *
 * The reported termination is recorded alongside the span rather than written
 * over it. Every one of those claims was correct against eligibility as it
 * stood on the date of service, and still reproduces that way; what changed is
 * what the plan knows now. Recovery is therefore a query over history rather
 * than a rewrite of it, which is both how it works in life and the only
 * version that survives an audit.
 */
async function buildRetroTerminations() {
  console.log("Retroactive terminations...");

  // Reset any prior run so this is repeatable.
  await prisma.eligibilitySpan.updateMany({
    where: { retroReportedAt: { not: null } },
    data: { reportedTerminationDate: null, retroReportedAt: null },
  });

  const candidates = await prisma.$queryRawUnsafe<
    Array<{ id: string; memberId: string; firstClaim: number; lastClaim: number }>
  >(`
    SELECT e.id AS id, e.memberId AS memberId,
           CAST(MIN(c.dateOfService) AS REAL) AS firstClaim,
           CAST(MAX(c.dateOfService) AS REAL) AS lastClaim
    FROM EligibilitySpan e
    JOIN Claim c ON c.memberId = e.memberId AND c.responseStatus = 'P'
    WHERE e.terminationDate IS NULL
    GROUP BY e.id
    HAVING COUNT(*) >= 6
    ORDER BY e.memberId
    LIMIT 800
  `);

  /*
   * Terminations are spread across the year and the notice follows between
   * thirty and ninety days later, which is the reporting lag employers
   * actually run at. Anchoring either date to the member's last fill would
   * bunch every notice into December and leave the worklist empty for most of
   * the year the demo is being shown in.
   */
  const rng = new Rng(1717);
  let moved = 0;
  for (const c of candidates) {
    const term = new Date(
      Date.UTC(PLAN_YEAR, 1, 1) + rng.int(0, 272) * DAY_MS,
    );
    if (term.getTime() <= Number(c.firstClaim)) continue;
    const reported = new Date(term.getTime() + rng.int(30, 90) * DAY_MS);
    await prisma.eligibilitySpan.update({
      where: { id: c.id },
      data: { reportedTerminationDate: term, retroReportedAt: reported },
    });
    moved++;
  }

  const [recov] = await prisma.$queryRaw<
    Array<{ claims: number; members: number; amount: number }>
  >`
    SELECT COUNT(*) AS claims, COUNT(DISTINCT c.memberId) AS members,
           SUM(c.planPaidCents) AS amount
    FROM Claim c
    JOIN EligibilitySpan e ON e.memberId = c.memberId
    WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
      AND e.reportedTerminationDate IS NOT NULL
      AND c.dateOfService > e.reportedTerminationDate
  `;
  console.log(
    `  ${moved} spans backdated; ${Number(recov.claims).toLocaleString()} claims ` +
      `worth $${(Number(recov.amount) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} now recoverable`,
  );
}

// ---------------------------------------------------------------------------
// 3. Rebate invoicing
// ---------------------------------------------------------------------------

/**
 * Rebates are earned on the fill and collected much later.
 *
 * The waterfall report already shows what the book accrued. This is the part
 * that matters to cash: a quarter closes, the invoice goes to the manufacturer
 * some weeks after that, and payment arrives on terms measured in months. At
 * any moment most of what has been earned is still a receivable, and under a
 * traditional contract that float belongs to the PBM rather than the plan.
 *
 * ETG0013 fixes the amount of the rebate and the administrative fee taken out
 * of it, but the extracted terms say nothing about when the money moves. The
 * two lags below are therefore modeling assumptions on customary practice, not
 * contract text, and the receivables page says so where it uses them.
 *
 * B2s leave the original B1 paid with a positive estimatedRebateCents and
 * store the clawback as a negative on the reversal. Invoicing every paid B1
 * without dropping reversed fills would bill manufacturers for rebates the
 * plan never keeps (and overstate sponsor rebate credits that read this table).
 */
const INVOICE_LAG_DAYS = 45;
const PAYMENT_TERMS_DAYS = 60;

async function buildRebateInvoices() {
  console.log("Rebate invoicing...");
  await prisma.rebateInvoice.deleteMany({});

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      quarter: number;
      manufacturer: string;
      claims: number;
      amount: number;
    }>
  >(`
    SELECT
      (CAST(STRFTIME('%m', c.dateOfService / 1000, 'unixepoch') AS INTEGER) - 1) / 3 AS quarter,
      COALESCE(d.labeler, 'Unattributed labeler') AS manufacturer,
      COUNT(*) AS claims,
      SUM(c.estimatedRebateCents) AS amount
    FROM Claim c JOIN Drug d ON d.id = c.drugId
    WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
      AND c.estimatedRebateCents > 0 AND c.scenarioTag IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM Claim r
        WHERE r.reversalOfClaimId = c.id AND r.transactionCode = 'B2'
      )
    GROUP BY quarter, manufacturer
    HAVING amount > 0
  `);

  const rng = new Rng(2929);
  const invoices = rows.map((r, i) => {
    const q = Math.min(3, Number(r.quarter));
    const periodStart = new Date(Date.UTC(PLAN_YEAR, q * 3, 1));
    const periodEnd = new Date(Date.UTC(PLAN_YEAR, q * 3 + 3, 0));
    const submittedAt = new Date(
      periodEnd.getTime() + INVOICE_LAG_DAYS * DAY_MS,
    );
    const dueAt = new Date(submittedAt.getTime() + PAYMENT_TERMS_DAYS * DAY_MS);

    // Manufacturers dispute a slice of roughly a third of invoices, usually
    // over whether particular claims qualified, and the disputed part sits
    // unpaid while it is worked.
    const invoiced = Number(r.amount);
    const disputedCents =
      rng.next() < 0.35 ? Math.round(invoiced * (rng.int(2, 9) / 100)) : 0;

    return {
      id: `reb-${String(i + 1).padStart(5, "0")}`,
      manufacturer: r.manufacturer,
      quarter: `${PLAN_YEAR}Q${q + 1}`,
      periodStart,
      periodEnd,
      submittedAt,
      dueAt,
      // Payers are late as often as not; a fifth of the schedule slips past
      // terms and is what the aging buckets are there to catch.
      collectedAt: new Date(dueAt.getTime() + rng.int(0, 40) * DAY_MS),
      claimCount: Number(r.claims),
      invoicedCents: invoiced,
      collectedCents: invoiced - disputedCents,
      disputedCents,
    };
  });

  for (let i = 0; i < invoices.length; i += 1000) {
    await prisma.rebateInvoice.createMany({ data: invoices.slice(i, i + 1000) });
  }

  const accrued = invoices.reduce((s, i) => s + i.invoicedCents, 0);
  console.log(
    `  ${invoices.length} invoices across ${new Set(invoices.map((i) => i.manufacturer)).size} manufacturers; ` +
      `$${(accrued / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} scheduled across the year`,
  );
}

// ---------------------------------------------------------------------------
// 4. Settlement
// ---------------------------------------------------------------------------

/**
 * Semi-monthly to the network, monthly to the plan.
 *
 * A PBM is a payments company wearing a clinical hat. It collects from the
 * plan and pays the network on a contractual cycle, and under pass-through the
 * two sides are equal by construction. The invariant suite checks that they
 * are, which is the whole argument for the model in one line of SQL.
 *
 * The whole year's schedule is laid down here. Which cycles have run is a
 * question the simulation clock answers at read time, the same way it answers
 * it for claims, so the payment calendar advances by itself.
 */
async function buildSettlement() {
  console.log("Settlement...");
  await prisma.remittanceLine.deleteMany({});
  await prisma.remittanceRun.deleteMany({});
  await prisma.sponsorInvoice.deleteMany({});

  // --- Pharmacy remittance, twice a month ---------------------------------
  const cycles: Array<{ start: Date; end: Date; paid: Date }> = [];
  for (let m = 0; m < 12; m++) {
    const firstHalfStart = new Date(Date.UTC(PLAN_YEAR, m, 1));
    const firstHalfEnd = new Date(Date.UTC(PLAN_YEAR, m, 15));
    const secondHalfStart = new Date(Date.UTC(PLAN_YEAR, m, 16));
    const secondHalfEnd = new Date(Date.UTC(PLAN_YEAR, m + 1, 0));
    cycles.push({
      start: firstHalfStart,
      end: firstHalfEnd,
      paid: new Date(firstHalfEnd.getTime() + 14 * DAY_MS),
    });
    cycles.push({
      start: secondHalfStart,
      end: secondHalfEnd,
      paid: new Date(secondHalfEnd.getTime() + 14 * DAY_MS),
    });
  }

  const runs: Array<Record<string, unknown>> = [];
  const lines: Array<Record<string, unknown>> = [];

  for (let i = 0; i < cycles.length; i++) {
    const c = cycles[i];

    const perPharmacy = await prisma.$queryRawUnsafe<
      Array<{
        pharmacyId: string;
        claims: number;
        reversals: number;
        gross: number;
        reversed: number;
      }>
    >(`
      SELECT pharmacyId,
             SUM(CASE WHEN transactionCode = 'B1' THEN 1 ELSE 0 END) AS claims,
             SUM(CASE WHEN transactionCode = 'B2' THEN 1 ELSE 0 END) AS reversals,
             SUM(CASE WHEN transactionCode = 'B1' THEN pharmacyPaidCents ELSE 0 END) AS gross,
             SUM(CASE WHEN transactionCode = 'B2' THEN pharmacyPaidCents ELSE 0 END) AS reversed
      FROM Claim
      WHERE (responseStatus = 'P' OR responseStatus = 'A')
        AND dateOfService >= ${c.start.getTime()} AND dateOfService <= ${c.end.getTime()}
      GROUP BY pharmacyId
    `);
    if (perPharmacy.length === 0) continue;

    const runId = `rem-${String(i + 1).padStart(3, "0")}`;
    let claimCount = 0;
    let reversalCount = 0;
    let gross = 0;
    let reversed = 0;

    for (const p of perPharmacy) {
      const g = Number(p.gross);
      const r = Number(p.reversed);
      claimCount += Number(p.claims);
      reversalCount += Number(p.reversals);
      gross += g;
      reversed += r;
      lines.push({
        id: `${runId}-${p.pharmacyId}`,
        runId,
        pharmacyId: p.pharmacyId,
        claimCount: Number(p.claims),
        reversalCount: Number(p.reversals),
        grossCents: g,
        reversalCents: r,
        netCents: g + r,
      });
    }

    runs.push({
      id: runId,
      cycleStart: c.start,
      cycleEnd: c.end,
      paidAt: c.paid,
      pharmacyCount: perPharmacy.length,
      claimCount,
      reversalCount,
      grossCents: gross,
      reversalCents: reversed,
      netCents: gross + reversed,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.remittanceRun.createMany({ data: runs as any });
  for (let i = 0; i < lines.length; i += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.remittanceLine.createMany({ data: lines.slice(i, i + 1000) as any });
  }
  console.log(
    `  ${runs.length} remittance cycles, ${lines.length} pharmacy lines, ` +
      `$${(runs.reduce((s, r) => s + (r.netCents as number), 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} net to the network`,
  );

  // --- Sponsor invoicing, monthly -----------------------------------------
  const sponsor = await prisma.planSponsor.findFirstOrThrow();
  const invoices: Array<Record<string, unknown>> = [];

  for (let m = 0; m < 12; m++) {
    const start = new Date(Date.UTC(PLAN_YEAR, m, 1));
    const end = new Date(Date.UTC(PLAN_YEAR, m + 1, 0, 23, 59, 59));

    const [claims] = await prisma.$queryRawUnsafe<
      Array<{
        claims: number;
        reversals: number;
        drugCost: number;
      }>
    >(`
      SELECT SUM(CASE WHEN transactionCode = 'B1' THEN 1 ELSE 0 END) AS claims,
             SUM(CASE WHEN transactionCode = 'B2' THEN 1 ELSE 0 END) AS reversals,
             SUM(planPaidCents) AS drugCost
      FROM Claim
      WHERE (responseStatus = 'P' OR responseStatus = 'A')
        AND dateOfService >= ${start.getTime()} AND dateOfService <= ${end.getTime()}
    `);

    // Member months are the lives actually covered during the month, which is
    // what the administrative fee is charged on.
    const [{ lives }] = await prisma.$queryRawUnsafe<Array<{ lives: number }>>(`
      SELECT COUNT(*) AS lives FROM EligibilitySpan
      WHERE effectiveDate <= ${end.getTime()}
        AND (terminationDate IS NULL OR terminationDate >= ${start.getTime()})
    `);

    const memberMonths = Number(lives);
    const adminFeeCents =
      memberMonths * WISCONSIN_CONTRACT.adminFeePmpmCommercialCents;
    const rebateAdminFeeCents =
      memberMonths * WISCONSIN_CONTRACT.rebateAdminFeePmpmCents;

    // Only rebates actually collected in the month credit the invoice, which
    // is why the credit lags the spend by two quarters.
    const [{ credited }] = await prisma.$queryRawUnsafe<
      Array<{ credited: number }>
    >(`
      SELECT COALESCE(SUM(collectedCents), 0) AS credited FROM RebateInvoice
      WHERE collectedAt IS NOT NULL
        AND collectedAt >= ${start.getTime()} AND collectedAt <= ${end.getTime()}
    `);

    const drugCost = Number(claims?.drugCost ?? 0);
    const rebateCredit = Number(credited);
    const issuedAt = new Date(end.getTime() + 5 * DAY_MS);
    const dueAt = new Date(issuedAt.getTime() + 30 * DAY_MS);

    invoices.push({
      id: `inv-${PLAN_YEAR}-${String(m + 1).padStart(2, "0")}`,
      sponsorId: sponsor.id,
      periodStart: start,
      periodEnd: end,
      issuedAt,
      dueAt,
      paidAt: dueAt,
      claimCount: Number(claims?.claims ?? 0),
      reversalCount: Number(claims?.reversals ?? 0),
      drugCostCents: drugCost,
      memberMonths,
      adminFeeCents,
      rebateCreditCents: rebateCredit,
      rebateAdminFeeCents,
      totalDueCents: drugCost + adminFeeCents - rebateCredit,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.sponsorInvoice.createMany({ data: invoices as any });
  console.log(
    `  ${invoices.length} sponsor invoices, ` +
      `$${(invoices.reduce((s, i) => s + (i.totalDueCents as number), 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} billed`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
