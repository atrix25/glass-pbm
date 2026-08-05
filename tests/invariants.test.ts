/**
 * Invariants over the whole book.
 *
 * A golden test proves one claim is right. These prove that nothing anywhere
 * in 1.6 million claims violates a property the contract guarantees. They are
 * the tests that would catch a rounding bug that only shows up on one drug, or
 * a pass-through leak that only opens on one channel.
 *
 * Each invariant is expressed as a search for counterexamples in SQL rather
 * than a scan over rows pulled into memory. At this size the book does not fit
 * in a Node heap, and the database can check every row and hand back the first
 * few offenders, which is what a failure needs to be actionable anyway.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { reproduceClaim } from "@/lib/engine/reproduce";
import { simulateFill } from "@/lib/engine/pos";
import {
  PLAN_YEAR,
  PLAN_YEAR_END,
  resolveClock,
  type SimulationClock,
} from "@/lib/clock";
import { WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";
import {
  getClassDrivers,
  getCostConcentration,
  getRelationshipTrend,
  getTrendOverview,
} from "@/lib/queries/trends";
import { getScorecard } from "@/lib/queries/reconciliation";
import { buildExperiences, emptyExperience } from "@/lib/nps/experience";
import { readingFrom } from "@/lib/nps/reading";
import { RUBRIC_BY_ID, scoreMember } from "@/lib/nps/rubric";

/**
 * Returns up to five paid claims that satisfy `predicate`, with whichever
 * columns the caller asked for so the failure message shows the numbers that
 * disagree rather than only an identifier.
 */
async function counterexamples(
  columns: Prisma.Sql,
  predicate: Prisma.Sql,
): Promise<Array<Record<string, unknown>>> {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT claimNumber, ${columns}
    FROM Claim
    WHERE responseStatus = 'P' AND (${predicate})
    LIMIT 5
  `;
}

const NONE: Array<Record<string, unknown>> = [];

let paidCount = 0;

beforeAll(async () => {
  paidCount = await prisma.claim.count({ where: { responseStatus: "P" } });
  expect(paidCount).toBeGreaterThan(1000);
});

describe("pass-through", () => {
  /*
   * The amount remitted to the pharmacy is the total less what the member
   * hands over at the counter, so the pass-through property is not
   * "remittance equals billed". It is that the plan is billed exactly what the
   * pharmacy is entitled to: one rate row prices both sides.
   */
  it("bills the plan exactly what the pharmacy is owed, on every claim", async () => {
    expect(
      await counterexamples(
        Prisma.sql`totalBilledCents AS billedToPlan, totalAllowedCents AS allowedToPharmacy`,
        Prisma.sql`totalBilledCents <> totalAllowedCents`,
      ),
    ).toEqual(NONE);
  });

  it("retains zero spread in aggregate", async () => {
    const [row] = await prisma.$queryRaw<Array<{ spread: number | bigint }>>`
      SELECT COALESCE(SUM(totalBilledCents - totalAllowedCents), 0) AS spread
      FROM Claim WHERE responseStatus = 'P'
    `;
    expect(Number(row.spread)).toBe(0);
  });

  it("leaves the pharmacy whole between the remittance and the counter", async () => {
    expect(
      await counterexamples(
        Prisma.sql`pharmacyPaidCents, patientPayCents, totalAllowedCents`,
        Prisma.sql`pharmacyPaidCents + patientPayCents <> totalAllowedCents`,
      ),
    ).toEqual(NONE);
  });
});

describe("money conservation", () => {
  it("splits every billed dollar between the plan and the member, with nothing left over", async () => {
    expect(
      await counterexamples(
        Prisma.sql`planPaidCents AS plan, patientPayCents AS member, totalBilledCents AS total`,
        Prisma.sql`planPaidCents + patientPayCents <> totalBilledCents`,
      ),
    ).toEqual(NONE);
  });

  it("builds the total from ingredient cost plus dispensing fee", async () => {
    expect(
      await counterexamples(
        Prisma.sql`billedIngredientCostCents, billedDispensingFeeCents, totalBilledCents`,
        Prisma.sql`billedIngredientCostCents + billedDispensingFeeCents <> totalBilledCents`,
      ),
    ).toEqual(NONE);
  });

  it("never pays a negative amount to anyone", async () => {
    expect(
      await counterexamples(
        Prisma.sql`planPaidCents, patientPayCents, totalBilledCents, billedDispensingFeeCents`,
        Prisma.sql`planPaidCents < 0 OR patientPayCents < 0
                   OR totalBilledCents < 0 OR billedDispensingFeeCents < 0`,
      ),
    ).toEqual(NONE);
  });

  it("never charges the member more than the claim is worth", async () => {
    expect(
      await counterexamples(
        Prisma.sql`patientPayCents AS member, totalBilledCents AS total`,
        Prisma.sql`patientPayCents > totalBilledCents`,
      ),
    ).toEqual(NONE);
  });
});

describe("the lesser-of never loses to the cash price", () => {
  it("never bills more than the pharmacy's own usual and customary price", async () => {
    expect(
      await counterexamples(
        Prisma.sql`billedIngredientCostCents AS billed, usualAndCustomaryCents AS cash`,
        Prisma.sql`usualAndCustomaryCents > 0
                   AND billedIngredientCostCents > usualAndCustomaryCents`,
      ),
    ).toEqual(NONE);
  });
});

describe("cost share ceilings from the Certificate of Coverage", () => {
  /*
   * Read the ceiling from the plan the claim was actually adjudicated under
   * rather than hardcoding the IYC retail figures. The two plans differ, and a
   * 90-day fill carries a multiple of the 30-day copay, so a single hardcoded
   * cap would flag correct claims on three separate counts.
   */
  it("never charges more per fill than the member's own plan allows", async () => {
    /*
     * The ceiling governs cost share, which is the copay or the coinsurance. It
     * does not govern the deductible or the brand selection penalty, and both
     * of those are charges the member really does owe on top.
     *
     * Under the high deductible plan a Level 1 fill can cost the member $17.43
     * against a $15 copay, and that is correct: the fill fell inside an unmet
     * deductible, so the member paid for it and no copay applied at all. Testing
     * the ceiling against total member liability would flag every one of those
     * as a breach, which is how a correct deductible looks to a test written
     * when the plan was paying it.
     */
    const breaches = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT c.claimNumber,
             c.benefitPlanId AS plan,
             c.formularyLevel AS level,
             c.channel,
             c.copayCoinsuranceCents AS costShare,
             CASE WHEN r.costShareType = 'Copay'
                  THEN COALESCE(r.copayCents, 0)
                  ELSE COALESCE(r.coinsuranceMaxCents, 999999999) END AS ceiling
      FROM Claim c
      JOIN CostShareRule r
        ON r.benefitPlanId = c.benefitPlanId
       AND r.level         = c.formularyLevel
       AND r.channel       = c.channel
      WHERE c.responseStatus = 'P'
        AND c.copayCoinsuranceCents >
            CASE WHEN r.costShareType = 'Copay'
                 THEN COALESCE(r.copayCents, 0)
                 ELSE COALESCE(r.coinsuranceMaxCents, 999999999) END
      LIMIT 5
    `;
    expect(breaches).toEqual(NONE);
  });

  it("never charges a deductible the plan has no deductible for", async () => {
    // The IYC plan carries no deductible, so nothing on it may apply to one.
    expect(
      await counterexamples(
        Prisma.sql`benefitPlanId AS plan, appliedToDeductibleCents AS applied`,
        Prisma.sql`benefitPlanId = 'wi-iyc-2026' AND appliedToDeductibleCents > 0`,
      ),
    ).toEqual(NONE);
  });

  it("never credits a deductible with money the member did not pay", async () => {
    /*
     * The invariant that would have caught the original defect. Before the fix
     * this held on 204,966 claims totalling $11.9m: the amount was applied to
     * the deductible, credited to the accumulator, and paid by the plan.
     */
    expect(
      await counterexamples(
        Prisma.sql`claimNumber, appliedToDeductibleCents AS applied, patientPayCents AS member`,
        Prisma.sql`appliedToDeductibleCents > patientPayCents`,
      ),
    ).toEqual(NONE);
  });

  it("never charges anything on a preventive fill", async () => {
    expect(
      await counterexamples(
        Prisma.sql`formularyLevel, patientPayCents`,
        Prisma.sql`formularyLevel = '$0' AND patientPayCents > 0`,
      ),
    ).toEqual(NONE);
  });
});

describe("prescription out-of-pocket limits are never breached", () => {
  /*
   * The book runs two plans with genuinely different rules. The IYC plan caps
   * Level 1 and 2 cost share at $600 and lets Level 3 and 4 sit outside it.
   * The high deductible plan is HSA-qualified, so it must run a single
   * integrated maximum, and every level counts toward its $2,500. Testing
   * every member against $600 would report the HDHP members as breaches when
   * they are correct.
   *
   * Which levels qualify is a per-plan fact, so it is read from the plan and
   * pushed into the query rather than assumed.
   */
  interface PlanLimit {
    id: string;
    limitCents: number;
    qualifyingLevels: string[];
  }

  let planLimits: PlanLimit[] = [];

  beforeAll(async () => {
    const plans = await prisma.benefitPlan.findMany({
      include: { costShareRules: true },
    });
    planLimits = plans.map((p) => ({
      id: p.id,
      limitCents: p.rxOopLimitIndividual,
      qualifyingLevels: [
        ...new Set(
          p.costShareRules.filter((r) => r.accumulatesToRxOop).map((r) => r.level),
        ),
      ],
    }));
    expect(planLimits.length).toBeGreaterThan(0);
  });

  /**
   * Per-member qualifying cost share for one plan, keeping only members whose
   * total sits on the wrong side of `comparison` relative to the limit. The
   * brand selection penalty is what a member chooses to pay to get the brand,
   * not plan cost sharing, so it sits outside the limit.
   */
  async function membersAtOrOver(plan: PlanLimit, comparison: Prisma.Sql) {
    if (plan.qualifyingLevels.length === 0) return [];
    return prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT memberId,
             SUM(patientPayCents - brandSelectionPenaltyCents) AS cents
      FROM Claim
      WHERE responseStatus = 'P'
        AND benefitPlanId = ${plan.id}
        AND formularyLevel IN (${Prisma.join(plan.qualifyingLevels)})
      GROUP BY memberId
      HAVING SUM(patientPayCents - brandSelectionPenaltyCents) ${comparison} ${plan.limitCents}
      LIMIT 5
    `;
  }

  it("caps qualifying cost share at each member's own plan limit", async () => {
    for (const plan of planLimits) {
      const breaches = await membersAtOrOver(plan, Prisma.sql`>`);
      expect(breaches, `members over the limit on ${plan.id}`).toEqual(NONE);
    }
  });

  it("has members who actually reach the limit", async () => {
    // A limit nothing ever touches is a limit that has not been tested.
    let reached = 0;
    for (const plan of planLimits) {
      reached += (await membersAtOrOver(plan, Prisma.sql`=`)).length;
    }
    expect(reached).toBeGreaterThan(0);
  });
});

describe("rejected claims move no money", () => {
  it("pays nothing on any rejected claim", async () => {
    const rejected = await prisma.claim.count({ where: { responseStatus: "R" } });
    expect(rejected).toBeGreaterThan(100);

    const moved = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT claimNumber, planPaidCents, patientPayCents,
             totalBilledCents, pharmacyPaidCents
      FROM Claim
      WHERE responseStatus = 'R'
        AND (planPaidCents <> 0 OR patientPayCents <> 0
             OR totalBilledCents <> 0 OR pharmacyPaidCents <> 0)
      LIMIT 5
    `;
    expect(moved).toEqual(NONE);
  });

  it("gives every rejected claim a reason code", async () => {
    const unexplained = await prisma.claim.count({
      where: { responseStatus: "R", OR: [{ rejectCodes: "" }, { rejectCodes: "[]" }] },
    });
    expect(unexplained).toBe(0);
  });
});

/**
 * Traces are re-derived on demand rather than stored, so the invariant is no
 * longer "a trace exists on the row". It is that every claim retains the
 * inputs a reproduction needs, and that the reproduction cites its authorities
 * when it runs. The determinism suite checks that reproductions land on the
 * stored money; this checks that they can be produced at all and are not
 * silently uncited.
 */
describe("every claim can produce its derivation", () => {
  it("retains every input a reproduction reads", async () => {
    // Scoped to the claims that depend on reproduction. The handful of seeded
    // demonstration claims carry a stored trace and do not.
    const incomplete = await prisma.claim.count({
      where: {
        traceJson: null,
        // Reversals are not priced. A B2 has no derivation of its own: it is
        // the exact negation of a B1 that does, which the reversal suite
        // checks column by column.
        transactionCode: "B1",
        OR: [
          { usualAndCustomaryCents: { lte: 0 } },
          { ingredientCostSubmittedCents: { lte: 0 } },
          { quantityDispensed: { lte: 0 } },
          { daysSupply: { lte: 0 } },
        ],
      },
    });
    expect(incomplete).toBe(0);
  });

  it("cites a source document on the rules that decide money", async () => {
    const sample = await prisma.claim.findMany({
      where: { responseStatus: "P" },
      select: { id: true, claimNumber: true },
      take: 60,
      orderBy: { claimNumber: "asc" },
    });
    expect(sample.length).toBeGreaterThan(0);

    for (const claim of sample) {
      const reproduced = await reproduceClaim(claim.id);
      expect(reproduced, `${claim.claimNumber} could not be reproduced`).not.toBeNull();
      const pricing = reproduced!.outcome.trace.filter(
        (t) => t.stage === "pricing",
      );
      expect(pricing.length).toBeGreaterThan(0);
      expect(pricing.every((t) => Boolean(t.sourceDocumentId))).toBe(true);
    }
  });
});

/**
 * The dashboards read the rollup, not the claims. If the two ever disagreed,
 * every headline figure in the application would be quietly wrong while every
 * individual claim stayed right, which is the hardest kind of error to notice.
 */
describe("the daily rollup agrees with the claims it summarises", () => {
  it("matches on counts and money for the whole book", async () => {
    const [rollup] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT SUM(claimsSubmitted)      AS submitted,
             SUM(claimsPaid)           AS paid,
             SUM(claimsRejected)       AS rejected,
             SUM(totalBilledCents)     AS billed,
             SUM(planPaidCents)        AS planPaid,
             SUM(patientPayCents)      AS memberPaid,
             SUM(estimatedRebateCents) AS rebate
      FROM BookDay
    `;
    const [claims] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT COUNT(*)                                              AS submitted,
             SUM(CASE WHEN responseStatus = 'P' THEN 1 ELSE 0 END) AS paid,
             SUM(CASE WHEN responseStatus = 'R' THEN 1 ELSE 0 END) AS rejected,
             SUM(CASE WHEN responseStatus = 'P' THEN totalBilledCents     ELSE 0 END) AS billed,
             SUM(CASE WHEN responseStatus = 'P' THEN planPaidCents        ELSE 0 END) AS planPaid,
             SUM(CASE WHEN responseStatus = 'P' THEN patientPayCents      ELSE 0 END) AS memberPaid,
             SUM(CASE WHEN responseStatus = 'P' THEN estimatedRebateCents ELSE 0 END) AS rebate
      FROM Claim
      WHERE scenarioTag IS NULL AND transactionCode = 'B1'
    `;

    for (const field of [
      "submitted",
      "paid",
      "rejected",
      "billed",
      "planPaid",
      "memberPaid",
      "rebate",
    ]) {
      expect(
        Number(rollup[field] ?? 0),
        `rollup ${field} disagrees with the claims`,
      ).toBe(Number(claims[field] ?? 0));
    }
  });

  /*
   * Reversals are carried in their own rollup columns rather than netted
   * against the day. Netting them would make a day with heavy reversal
   * activity indistinguishable from a quiet one, and would quietly change
   * what "claims paid" means halfway through the year.
   */
  it("carries reversals separately and agrees with them too", async () => {
    const [rollup] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT SUM(reversalsProcessed)      AS n,
             SUM(reversalBilledCents)     AS billed,
             SUM(reversalPlanPaidCents)   AS planPaid,
             SUM(reversalPatientPayCents) AS memberPaid,
             SUM(reversalRebateCents)     AS rebate
      FROM BookDay
    `;
    const [claims] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT COUNT(*)                     AS n,
             SUM(totalBilledCents)        AS billed,
             SUM(planPaidCents)           AS planPaid,
             SUM(patientPayCents)         AS memberPaid,
             SUM(estimatedRebateCents)    AS rebate
      FROM Claim
      WHERE scenarioTag IS NULL AND transactionCode = 'B2'
    `;

    for (const field of ["n", "billed", "planPaid", "memberPaid", "rebate"]) {
      expect(
        Number(rollup[field] ?? 0),
        `reversal rollup ${field} disagrees with the claims`,
      ).toBe(Number(claims[field] ?? 0));
    }
    expect(Number(rollup.n ?? 0)).toBeGreaterThan(1000);
  });

  it("matches the claims when cut by channel", async () => {
    const rolled = await prisma.bookDayDimension.groupBy({
      by: ["key"],
      where: { dimension: "channel" },
      _sum: { claims: true, billedCents: true },
    });
    const direct = await prisma.claim.groupBy({
      by: ["channel"],
      where: { responseStatus: "P", scenarioTag: null },
      _count: { _all: true },
      _sum: { totalBilledCents: true },
    });

    const byChannel = new Map(direct.map((d) => [d.channel, d]));
    for (const r of rolled) {
      const d = byChannel.get(r.key);
      expect(d, `channel ${r.key} is in the rollup but not the claims`).toBeDefined();
      expect(r._sum.claims).toBe(d!._count._all);
      expect(r._sum.billedCents).toBe(d!._sum.totalBilledCents);
    }
    expect(rolled.length).toBe(direct.length);
  });

  /*
   * The guarantee cells carry ingredient cost and AWP rather than the billed
   * total, because that is what Exhibit C measures. They are also filtered to
   * claims carrying an AWP. Both of those are easy to get subtly wrong, and
   * the whole contract reporting page divides one by the other.
   */
  it("matches the claims on the ingredient cost and AWP behind every guarantee", async () => {
    const [rolled] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT SUM(claims)              AS claims,
             SUM(ingredientCostCents) AS ingredient,
             SUM(awpCents)            AS awp,
             SUM(dispensingFeeCents)  AS fees
      FROM BookDayDimension WHERE dimension = 'guarantee'
    `;
    const [direct] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT COUNT(*)                        AS claims,
             SUM(billedIngredientCostCents)  AS ingredient,
             SUM(awpTotalCents)              AS awp,
             SUM(billedDispensingFeeCents)   AS fees
      FROM Claim
      WHERE responseStatus = 'P' AND awpTotalCents > 0 AND scenarioTag IS NULL
    `;

    for (const field of ["claims", "ingredient", "awp", "fees"]) {
      expect(
        Number(rolled[field] ?? 0),
        `guarantee rollup ${field} disagrees with the claims`,
      ).toBe(Number(direct[field] ?? 0));
    }
    expect(Number(rolled.claims ?? 0)).toBeGreaterThan(1000);
  });
});

/*
 * A reversal that does not exactly undo its original is worse than no reversal
 * at all: it leaves a residue on the plan's invoice, the pharmacy's remittance
 * or the member's deductible that nobody will ever find. Every column that
 * carries money has to come back to zero when the pair is summed.
 */
describe("every reversal exactly undoes the fill it reverses", () => {
  const MONEY_COLUMNS = [
    "totalBilledCents",
    "totalAllowedCents",
    "planPaidCents",
    "patientPayCents",
    "pharmacyPaidCents",
    "billedIngredientCostCents",
    "billedDispensingFeeCents",
    "allowedIngredientCostCents",
    "allowedDispensingFeeCents",
    "appliedToDeductibleCents",
    "copayCoinsuranceCents",
    "brandSelectionPenaltyCents",
    "estimatedRebateCents",
  ];

  it("nets every money column to zero against the original", async () => {
    const sums = MONEY_COLUMNS.map(
      (c) => Prisma.sql`SUM(r.${Prisma.raw(c)} + o.${Prisma.raw(c)}) AS ${Prisma.raw(c)}`,
    );
    const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${Prisma.join(sums, ", ")}
      FROM Claim r JOIN Claim o ON o.id = r.reversalOfClaimId
      WHERE r.transactionCode = 'B2'
    `;
    for (const c of MONEY_COLUMNS) {
      expect(Number(row[c] ?? 0), `${c} does not net to zero`).toBe(0);
    }
  });

  it("points every reversal at a claim that was actually paid", async () => {
    const [row] = await prisma.$queryRaw<Array<{ orphans: number }>>`
      SELECT COUNT(*) AS orphans FROM Claim r
      LEFT JOIN Claim o ON o.id = r.reversalOfClaimId
      WHERE r.transactionCode = 'B2'
        AND (o.id IS NULL OR o.responseStatus <> 'P' OR o.transactionCode <> 'B1')
    `;
    expect(Number(row.orphans)).toBe(0);
  });

  it("books the reversal to the original date of service, not the day it arrived", async () => {
    const [row] = await prisma.$queryRaw<Array<{ misdated: number }>>`
      SELECT COUNT(*) AS misdated FROM Claim r
      JOIN Claim o ON o.id = r.reversalOfClaimId
      WHERE r.transactionCode = 'B2' AND r.dateOfService <> o.dateOfService
    `;
    expect(Number(row.misdated)).toBe(0);
  });

  it("never reverses the same fill twice", async () => {
    const [row] = await prisma.$queryRaw<Array<{ doubled: number }>>`
      SELECT COUNT(*) AS doubled FROM (
        SELECT reversalOfClaimId FROM Claim
        WHERE transactionCode = 'B2' AND reversalOfClaimId IS NOT NULL
        GROUP BY reversalOfClaimId HAVING COUNT(*) > 1
      )
    `;
    expect(Number(row.doubled)).toBe(0);
  });
});

/*
 * Settlement is the whole pass-through argument stated in money rather than in
 * pricing rules: whatever the network is paid across a cycle is what the plan
 * is billed for the same claims, to the cent.
 */
describe("settlement ties out", () => {
  it("pays the network exactly what it billed the sponsor for drug cost", async () => {
    const [network] = await prisma.$queryRaw<Array<{ net: number }>>`
      SELECT COALESCE(SUM(netCents), 0) AS net FROM RemittanceRun
    `;
    const [sponsor] = await prisma.$queryRaw<Array<{ drug: number }>>`
      SELECT COALESCE(SUM(drugCostCents), 0) AS drug FROM SponsorInvoice
    `;
    /*
     * The two differ by exactly what members handed over at the counter, which
     * the plan is never billed for and the pharmacy collects directly.
     */
    const [counter] = await prisma.$queryRaw<Array<{ member: number }>>`
      SELECT COALESCE(SUM(patientPayCents), 0) AS member FROM Claim
      WHERE responseStatus IN ('P', 'A')
    `;
    expect(Number(network.net) + Number(counter.member)).toBe(
      Number(sponsor.drug) + Number(counter.member),
    );
    expect(Number(network.net)).toBe(Number(sponsor.drug));
  });

  it("sums every remittance run from its own pharmacy lines", async () => {
    const [row] = await prisma.$queryRaw<Array<{ mismatched: number }>>`
      SELECT COUNT(*) AS mismatched FROM RemittanceRun r
      WHERE r.netCents <> (
        SELECT COALESCE(SUM(l.netCents), 0) FROM RemittanceLine l WHERE l.runId = r.id
      )
    `;
    expect(Number(row.mismatched)).toBe(0);
  });

  it("charges the administrative fee at the contracted rate on covered lives", async () => {
    const rows = await prisma.sponsorInvoice.findMany({
      select: { id: true, memberMonths: true, adminFeeCents: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.adminFeeCents, `${r.id} admin fee is off contract`).toBe(
        r.memberMonths * WISCONSIN_CONTRACT.adminFeePmpmCommercialCents,
      );
    }
  });

  it("bills drug cost plus the fee, less rebates collected", async () => {
    const rows = await prisma.sponsorInvoice.findMany();
    for (const r of rows) {
      expect(r.totalDueCents, `${r.id} does not foot`).toBe(
        r.drugCostCents + r.adminFeeCents - r.rebateCreditCents,
      );
    }
  });

  it("never invoices a manufacturer for more than it collects plus disputes", async () => {
    const [row] = await prisma.$queryRaw<Array<{ bad: number }>>`
      SELECT COUNT(*) AS bad FROM RebateInvoice
      WHERE collectedCents + disputedCents <> invoicedCents
    `;
    expect(Number(row.bad)).toBe(0);
  });
});

describe("channel classification follows the Exhibit C footnote", () => {
  it("puts nothing over 83 days in the Retail bucket", async () => {
    const bad = await prisma.claim.count({
      where: { responseStatus: "P", channel: "Retail", daysSupply: { gt: 83 } },
    });
    expect(bad).toBe(0);
  });

  it("puts nothing under 84 days in the Retail 90 bucket", async () => {
    const bad = await prisma.claim.count({
      where: {
        responseStatus: "P",
        channel: "Retail90",
        daysSupply: { lt: 84 },
      },
    });
    expect(bad).toBe(0);
  });
});

describe("specialty channel restriction", () => {
  it("pays no Level 4 claim outside a designated specialty pharmacy", async () => {
    const bad = await prisma.claim.count({
      where: {
        responseStatus: "P",
        formularyLevel: "4",
        pharmacy: { isDesignatedSpecialty: false },
      },
    });
    expect(bad).toBe(0);
  });
});

describe("prior authorization gating", () => {
  /*
   * Expressed as an anti-join so it covers every paid claim on a PA-governed
   * drug rather than a sample. A gap here is the most expensive kind of
   * adjudication error, and sampling is exactly the wrong way to look for one
   * bad claim in a million.
   */
  it("pays no claim requiring prior authorization without an approval covering the date", async () => {
    const unapproved = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT c.claimNumber, c.memberId, c.drugId, c.dateOfService
      FROM Claim c
      WHERE c.responseStatus = 'P'
        AND EXISTS (
          SELECT 1 FROM FormularyEntry f
          WHERE f.drugId = c.drugId AND f.requiresPA = 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM PriorAuthorization pa
          WHERE pa.memberId    = c.memberId
            AND pa.drugId      = c.drugId
            AND pa.determination = 'Approved'
            AND pa.approvedEffectiveDate   <= c.dateOfService
            AND pa.approvedTerminationDate >= c.dateOfService
        )
      LIMIT 5
    `;
    expect(unapproved).toEqual(NONE);
  });

  it("actually has paid claims on PA-governed drugs to check", async () => {
    // An anti-join over an empty set passes trivially.
    const [row] = await prisma.$queryRaw<Array<{ n: number | bigint }>>`
      SELECT COUNT(*) AS n FROM Claim c
      WHERE c.responseStatus = 'P'
        AND EXISTS (
          SELECT 1 FROM FormularyEntry f
          WHERE f.drugId = c.drugId AND f.requiresPA = 1
        )
    `;
    expect(Number(row.n)).toBeGreaterThan(100);
  });
});

describe("trend decomposition", () => {
  /*
   * The trend page tells a plan sponsor that the drivers it lists are the whole
   * story: the bridge "adds to the whole move with nothing left over", and every
   * therapeutic class on the book "sums to the net change". Both are arithmetic
   * identities rather than approximations, so both are checkable, and a page
   * that attributes a cost movement to named causes is worth nothing if the
   * causes do not add up to the movement.
   *
   * The tolerance is a hundredth of a cent per member per month, which is
   * floating-point noise over a nine-figure book, not slack in the claim.
   */
  const TOLERANCE_CENTS = 0.01;

  let overview: Awaited<ReturnType<typeof getTrendOverview>>;

  beforeAll(async () => {
    overview = await getTrendOverview(resolveClock(PLAN_YEAR_END.toISOString()));
    expect(overview, "the seeded year should support a trend comparison").not.toBeNull();
  });

  it("attributes the whole move in net cost to its five drivers", () => {
    const summed = overview!.drivers.reduce((a, d) => a + d.cents, 0);
    expect(
      Math.abs(summed - overview!.netChangeCents),
      `drivers sum to ${summed} but net PMPM moved ${overview!.netChangeCents}`,
    ).toBeLessThan(TOLERANCE_CENTS);
  });

  it("has a move worth decomposing", () => {
    expect(overview!.prior.scripts).toBeGreaterThan(1000);
    expect(overview!.current.scripts).toBeGreaterThan(1000);
    expect(Math.abs(overview!.netChangeCents)).toBeGreaterThan(0);
  });

  it("accounts for the same move across every therapeutic class", async () => {
    const classes = await getClassDrivers(overview!);
    const summed = classes.reduce((a, c) => a + c.changeCents, 0);
    expect(classes.length).toBeGreaterThan(5);
    expect(
      Math.abs(summed - overview!.netChangeCents),
      `classes sum to ${summed} but net PMPM moved ${overview!.netChangeCents}`,
    ).toBeLessThan(TOLERANCE_CENTS);
  });

  /*
   * Per-group rates are stated per life in that group, so they weight to the
   * plan's rate rather than adding to it. That is the property to check: it is
   * what makes it legitimate to print them beside the headline figure.
   */
  it("weights the employee and dependant rates back to the plan's own", async () => {
    const groups = await getRelationshipTrend(overview!);
    const lives = groups.reduce((a, g) => a + g.lives, 0);
    const weighted =
      groups.reduce((a, g) => a + g.currentPmpmCents * g.lives, 0) / lives;

    expect(lives).toBe(overview!.members);
    expect(
      Math.abs(weighted - overview!.current.netPmpmCents),
      `groups weight to ${weighted} but the plan's net PMPM is ${overview!.current.netPmpmCents}`,
    ).toBeLessThan(TOLERANCE_CENTS);
  });

  it("bands every covered life exactly once by what the plan spent on them", async () => {
    const bands = await getCostConcentration(overview!);
    const counted = bands.reduce((a, b) => a + b.currentMembers, 0);
    expect(counted).toBe(overview!.members);
    expect(bands.reduce((a, b) => a + b.currentShareOfSpend, 0)).toBeCloseTo(1, 6);
  });
});

describe("the counter sees what the report saw", () => {
  /*
   * Two implementations of the same clinical rules exist by necessity: one
   * sweeps the whole book in SQL after the fact, the other has to answer
   * inside a single transaction from one member's history. They are worth
   * having only if they agree, because a plan that advertises screening at the
   * point of sale and then mails a different answer a month later has built
   * two products and can defend neither.
   *
   * Every alert the retrospective pass raised is replayed through the
   * prospective screen as though the triggering fill were arriving now. The
   * prospective side is allowed to find more than the report did — it sees the
   * candidate's own dose, and a fill can conflict on two grounds at once — but
   * it may not miss what the report found.
   */
  const SAMPLE = 300;

  it("reproduces every retrospective finding at the point of sale", async () => {
    const alerts = await prisma.durAlert.findMany({
      take: SAMPLE,
      orderBy: { id: "asc" },
      select: { id: true, reasonCode: true, memberId: true, claimId: true },
    });
    expect(alerts.length).toBe(SAMPLE);

    const claims = await prisma.claim.findMany({
      where: { id: { in: alerts.map((a) => a.claimId) } },
      select: {
        id: true,
        drugId: true,
        pharmacyId: true,
        dateOfService: true,
        quantityDispensed: true,
        daysSupply: true,
        prescriberNpi: true,
      },
    });
    const claimById = new Map(claims.map((c) => [c.id, c]));

    const missed: string[] = [];
    for (const alert of alerts) {
      const claim = claimById.get(alert.claimId);
      if (!claim) {
        missed.push(`${alert.id}: triggering claim is gone`);
        continue;
      }
      const response = await simulateFill({
        memberId: alert.memberId,
        drugId: claim.drugId,
        pharmacyId: claim.pharmacyId,
        dateOfService: claim.dateOfService.toISOString().slice(0, 10),
        quantityDispensed: claim.quantityDispensed,
        daysSupply: claim.daysSupply,
        dawCode: "0",
        prescriberNpi: claim.prescriberNpi,
      });
      if (
        !response.dur.some((c) => c.reasonForServiceCode === alert.reasonCode)
      ) {
        missed.push(
          `${alert.id}: report found ${alert.reasonCode}, the counter returned ` +
            (response.dur.map((c) => c.reasonForServiceCode).join(", ") ||
              "nothing"),
        );
      }
    }

    expect(missed.slice(0, 5), `${missed.length} of ${SAMPLE} not reproduced`).toEqual([]);
  }, 120_000);

  /*
   * The segment is advisory. If a conflict ever changed what a claim paid, the
   * pharmacy would be reading a price that the plan's own accounting does not
   * recognise, which is the failure mode the whole design avoids.
   */
  it("never lets a conflict move the money", async () => {
    const alert = await prisma.durAlert.findFirst({
      where: { severity: "Major" },
      orderBy: { id: "asc" },
    });
    const claim = await prisma.claim.findUnique({
      where: { id: alert!.claimId },
      select: {
        drugId: true,
        pharmacyId: true,
        dateOfService: true,
        quantityDispensed: true,
        daysSupply: true,
        prescriberNpi: true,
        patientPayCents: true,
      },
    });

    const response = await simulateFill({
      memberId: alert!.memberId,
      drugId: claim!.drugId,
      pharmacyId: claim!.pharmacyId,
      dateOfService: claim!.dateOfService.toISOString().slice(0, 10),
      quantityDispensed: claim!.quantityDispensed,
      daysSupply: claim!.daysSupply,
      dawCode: "0",
      prescriberNpi: claim!.prescriberNpi,
    });

    expect(response.dur.length).toBeGreaterThan(0);
    expect(response.outcome.responseStatus).toBe("P");
    expect(response.outcome.rejectCodes).toEqual([]);
  }, 60_000);
});

describe("the membership traces to the files that created it", () => {
  /*
   * Eligibility is the input every other number depends on. A book whose
   * membership cannot be traced back to an instruction from the sponsor is a
   * book where somebody typed the population in, and the difference matters:
   * the whole recovery argument rests on being able to say when the plan
   * learned something and from what.
   */

  it("gives every covered life exactly one applied enrolment", async () => {
    const orphans = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n
      FROM EligibilitySpan e
      WHERE NOT EXISTS (
        SELECT 1 FROM EligibilityTransaction t
        WHERE t.memberId = e.memberId
          AND t.maintenanceType = '021'
          AND t.status = 'Applied'
      )
    `;
    expect(Number(orphans[0].n), "spans with no enrolment instruction").toBe(0);

    const duplicated = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n FROM (
        SELECT memberId FROM EligibilityTransaction
        WHERE maintenanceType = '021' AND status = 'Applied'
        GROUP BY memberId HAVING COUNT(*) > 1
      )
    `;
    expect(Number(duplicated[0].n), "members enrolled twice").toBe(0);
  });

  it("carries the same dates the instruction did", async () => {
    const disagreements = await prisma.$queryRaw<
      Array<{ memberId: string; spanFrom: number; txFrom: number }>
    >`
      SELECT t.memberId AS memberId,
             CAST(e.effectiveDate AS REAL) AS spanFrom,
             CAST(t.effectiveDate AS REAL) AS txFrom
      FROM EligibilityTransaction t
      JOIN EligibilitySpan e ON e.memberId = t.memberId
      WHERE t.maintenanceType = '021' AND t.status = 'Applied'
        AND (t.effectiveDate IS NULL OR t.effectiveDate <> e.effectiveDate
             OR t.benefitPlanId <> e.benefitPlanId)
      LIMIT 5
    `;
    expect(disagreements).toEqual([]);
  });

  /*
   * A rejected instruction is one the plan refused to act on, and the way to
   * prove that is to look for the damage each defect would have done. An
   * impossible span is what a coverage end before its own beginning produces;
   * a span pointing at no plan is what an unrecognised coverage code produces.
   * Neither exists, so neither defect landed.
   */
  it("leaves no trace of the defects it rejected", async () => {
    const impossible = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n FROM EligibilitySpan
      WHERE terminationDate IS NOT NULL AND terminationDate < effectiveDate
    `;
    expect(Number(impossible[0].n), "spans that end before they start").toBe(0);

    const unplanned = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n FROM EligibilitySpan e
      WHERE NOT EXISTS (
        SELECT 1 FROM BenefitPlan p WHERE p.id = e.benefitPlanId
      )
    `;
    expect(Number(unplanned[0].n), "spans on no plan at all").toBe(0);

    // And every rejected instruction really is one the feed refused: there is
    // no member whose only enrolment instruction was rejected.
    const orphaned = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT t.memberId) AS n
      FROM EligibilityTransaction t
      WHERE t.status = 'Rejected' AND t.memberId IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM EligibilityTransaction a
          WHERE a.memberId = t.memberId AND a.status = 'Applied'
        )
    `;
    expect(Number(orphaned[0].n)).toBe(0);
  });

  it("counts each file from the instructions actually inside it", async () => {
    const wrong = await prisma.$queryRaw<
      Array<{ controlNumber: string; stated: number; counted: number }>
    >`
      SELECT f.controlNumber AS controlNumber,
             f.addCount + f.changeCount + f.termCount AS stated,
             (SELECT COUNT(*) FROM EligibilityTransaction t
              WHERE t.fileId = f.id AND t.status = 'Applied') AS counted
      FROM EligibilityFile f
      WHERE stated <> counted
      LIMIT 5
    `;
    expect(wrong).toEqual([]);
  });

  /*
   * The audit is what makes a retroactive termination discoverable, so the
   * date the plan learned has to be the date an audit ran. Otherwise the
   * recovery page is asserting knowledge that arrived from nowhere.
   */
  it("dates every late termination to the audit that found it", async () => {
    const unexplained = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n
      FROM EligibilitySpan e
      WHERE e.retroReportedAt IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM EligibilityFile f
          WHERE f.fileType = 'Full audit'
            AND f.processedAt = e.retroReportedAt
        )
    `;
    expect(Number(unexplained[0].n)).toBe(0);

    /*
     * And in the other direction: the audit that ran on that instant really
     * did carry a termination for that member, at the date the recovery
     * worklist bills against.
     */
    const missing = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n
      FROM EligibilitySpan e
      WHERE e.retroReportedAt IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM EligibilityTransaction t
          JOIN EligibilityFile f ON f.id = t.fileId
          WHERE t.memberId = e.memberId
            AND t.maintenanceType = '024'
            AND t.status = 'Applied'
            AND t.terminationDate = e.reportedTerminationDate
            AND f.fileType = 'Full audit'
            AND f.processedAt = e.retroReportedAt
        )
    `;
    expect(Number(missing[0].n), "late terminations with no audit behind them").toBe(0);
  });

  it("never reports a termination before the coverage ended", async () => {
    const backwards = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n
      FROM EligibilityTransaction t
      JOIN EligibilityFile f ON f.id = t.fileId
      WHERE t.status = 'Applied'
        AND t.maintenanceType = '024'
        AND t.terminationDate IS NOT NULL
        AND f.receivedAt < t.terminationDate
    `;
    expect(Number(backwards[0].n)).toBe(0);
  });
});

describe("the ceiling is one number and the appeal against it is answerable", () => {
  /*
   * Wis. Stat. 632.865(2) is the rare piece of pharmacy regulation that states
   * its requirements as deadlines and disclosures rather than as principles,
   * which means compliance is checkable rather than arguable. Each test below
   * is one clause of it.
   *
   * The first is not from the statute at all. It is the thing the statute
   * cannot reach: that the ceiling used to pay the pharmacy and the ceiling
   * used to bill the plan are the same number. A two-list arrangement passes
   * every disclosure requirement in the section and still takes the spread.
   */

  it("bills the plan the same ceiling it pays the pharmacy", async () => {
    /*
     * The network collects the plan's remittance plus whatever the member
     * handed over at the counter. Under one list that sum is the ceiling, and
     * the ceiling is also what the plan is billed. Under two lists the same
     * fill produces a bill above the collection, and the gap is the business
     * model.
     */
    const spread = await prisma.$queryRaw<
      Array<{ n: number; billed: number | null; collected: number | null }>
    >`
      SELECT COUNT(*) AS n,
             SUM(c.totalBilledCents) AS billed,
             SUM(c.pharmacyPaidCents + c.patientPayCents) AS collected
      FROM Claim c
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND c.basisOfReimbursement = '7'
    `;
    expect(Number(spread[0].n)).toBeGreaterThan(0);
    expect(
      Number(spread[0].billed ?? 0) - Number(spread[0].collected ?? 0),
      "spread retained on MAC-priced fills",
    ).toBe(0);

    // And the ceiling that priced the fill is the one on the list, not a
    // second, higher one kept for billing.
    const twoLists = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n
      FROM Claim c
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND c.basisOfReimbursement = '7'
        AND ABS(c.totalBilledCents
                - ROUND(c.macUnitAtDos * c.quantityDispensed * 100)
                - c.allowedDispensingFeeCents) > 1
    `;
    expect(Number(twoLists[0].n), "fills billed off a different ceiling").toBe(0);
  });

  it("refreshes the list at least every seven business days", async () => {
    const versions = await prisma.macList.findMany({
      orderBy: { version: "asc" },
      select: { version: true, effectiveDate: true, publishedAt: true },
    });
    expect(versions.length).toBeGreaterThan(40);

    for (let i = 1; i < versions.length; i++) {
      const gap =
        (versions[i].effectiveDate.getTime() -
          versions[i - 1].effectiveDate.getTime()) /
        86_400_000;
      expect(gap, `interval before version ${versions[i].version}`).toBeLessThanOrEqual(9);
      expect(
        versions[i].publishedAt.getTime(),
        `version ${versions[i].version} published before it took effect`,
      ).toBeLessThanOrEqual(versions[i].effectiveDate.getTime());
    }
  });

  it("derives every ceiling on the live list from a surveyed cost", async () => {
    const live = await prisma.macList.findFirst({ orderBy: { version: "desc" } });
    const wrong = await prisma.$queryRaw<
      Array<{ drugId: string; unitPrice: number; nadacUnitPrice: number }>
    >`
      SELECT m.drugId AS drugId, m.unitPrice AS unitPrice,
             m.nadacUnitPrice AS nadacUnitPrice
      FROM MacPrice m
      WHERE m.listId = ${live!.id}
        AND (m.nadacUnitPrice <= 0 OR m.unitPrice < m.nadacUnitPrice
             OR m.sourceNdc IS NULL)
      LIMIT 5
    `;
    expect(wrong, "ceilings below the cost they were derived from").toEqual([]);
  });

  it("accepts no appeal filed outside the twenty-one day window", async () => {
    const late = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n FROM MacAppeal
      WHERE (submittedAt - dateOfService) / 86400000 > 21
         OR submittedAt < dateOfService
    `;
    expect(Number(late[0].n)).toBe(0);
  });

  it("resolves every appeal inside the twenty-one days it is given", async () => {
    const late = await prisma.$queryRaw<
      Array<{ id: string; days: number }>
    >`
      SELECT id, (decidedAt - submittedAt) / 86400000 AS days
      FROM MacAppeal
      WHERE days > 21 OR days < 0
      LIMIT 5
    `;
    expect(late).toEqual([]);
  });

  /*
   * The disclosure clause is the one with teeth. A denial has to say why and
   * has to name a national drug code the pharmacy can actually buy at or below
   * the ceiling — which is what turns "we investigated and the price stands"
   * into a claim somebody can go and disprove.
   */
  it("names a product on every denial", async () => {
    const bare = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n FROM MacAppeal
      WHERE outcome = 'Upheld'
        AND (denialReason IS NULL OR citedNdc IS NULL OR citedWholesaler IS NULL)
    `;
    expect(Number(bare[0].n), "denials with nothing to check").toBe(0);

    const cited = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n FROM MacAppeal a
      WHERE a.outcome = 'Upheld'
        AND NOT EXISTS (SELECT 1 FROM Drug d WHERE d.ndc11 = a.citedNdc)
    `;
    expect(Number(cited[0].n), "denials citing a product that does not exist").toBe(0);
  });

  it("adjusts pricing within a day of every overturn, and moves the list with it", async () => {
    const slow = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n FROM MacAppeal
      WHERE outcome = 'Overturned'
        AND (adjustedAt IS NULL
             OR (adjustedAt - decidedAt) / 86400000 > 1
             OR adjustedAt < decidedAt)
    `;
    expect(Number(slow[0].n)).toBe(0);

    /*
     * An overturn raises the ceiling and pays the difference on every fill the
     * pharmacy dispensed under the old one while the appeal was open — not
     * just the fill that was appealed. Paying only the appealed fill is a way
     * of conceding the point and keeping most of the money.
     */
    const wrong = await prisma.$queryRaw<
      Array<{
        id: string;
        adjustmentCents: number;
        expected: number;
        affectedClaims: number;
        counted: number;
      }>
    >`
      SELECT a.id AS id, a.adjustmentCents AS adjustmentCents,
             CAST(ROUND((a.revisedUnitPrice - a.macUnitPrice) * (
               SELECT SUM(c.quantityDispensed) FROM Claim c
               WHERE c.pharmacyId = a.pharmacyId AND c.drugId = a.drugId
                 AND c.responseStatus = 'P' AND c.transactionCode = 'B1'
                 AND c.basisOfReimbursement = '7'
                 AND c.dateOfService >= a.dateOfService
                 AND c.dateOfService <= a.decidedAt
             ) * 100) AS INTEGER) AS expected,
             a.affectedClaims AS affectedClaims,
             (SELECT COUNT(*) FROM Claim c
              WHERE c.pharmacyId = a.pharmacyId AND c.drugId = a.drugId
                AND c.responseStatus = 'P' AND c.transactionCode = 'B1'
                AND c.basisOfReimbursement = '7'
                AND c.dateOfService >= a.dateOfService
                AND c.dateOfService <= a.decidedAt) AS counted
      FROM MacAppeal a
      WHERE a.outcome = 'Overturned'
        AND (a.revisedUnitPrice IS NULL OR a.revisedUnitPrice <= a.macUnitPrice
             OR ABS(a.adjustmentCents - expected) > 2
             OR a.affectedClaims <> counted)
      LIMIT 5
    `;
    expect(wrong, "overturns that did not pay what they promised").toEqual([]);

    // And the movement is published against the version in force, so a
    // pharmacy reviewing an update sees that a ceiling was successfully
    // challenged rather than having to be told.
    const unrecorded = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n
      FROM MacAppeal a
      WHERE a.outcome = 'Overturned'
        AND NOT EXISTS (
          SELECT 1 FROM MacPriceChange c
          JOIN MacList l ON l.id = c.listId
          WHERE c.appealId = a.id AND c.drugId = a.drugId
            AND c.pharmacyId = a.pharmacyId
            AND c.reason = 'Appeal'
            AND ABS(c.newUnitPrice - a.revisedUnitPrice) < 0.000001
            AND l.effectiveDate >= a.adjustedAt
        )
    `;
    expect(Number(unrecorded[0].n), "overturns that never moved the list").toBe(0);
  });

  /*
   * Every version carries the whole list, not a delta. A pharmacy checking a
   * fill from March needs the ceilings that were in force in March, and a
   * processor that keeps only the current file can always say the number it is
   * being challenged on was never on it.
   */
  it("keeps every version of the list, not just the current one", async () => {
    const thin = await prisma.$queryRaw<
      Array<{ version: number; stated: number; held: number }>
    >`
      SELECT l.version AS version, l.drugCount AS stated,
             (SELECT COUNT(*) FROM MacPrice p WHERE p.listId = l.id) AS held
      FROM MacList l
      WHERE stated <> held
      LIMIT 5
    `;
    expect(thin, "versions that cannot be reconstructed").toEqual([]);
  });

  it("appeals only fills that were actually priced at the ceiling", async () => {
    const bogus = await prisma.$queryRaw<
      Array<{ id: string; macUnitPrice: number; macUnitAtDos: number | null }>
    >`
      SELECT a.id AS id, a.macUnitPrice AS macUnitPrice, c.macUnitAtDos AS macUnitAtDos
      FROM MacAppeal a
      JOIN Claim c ON c.id = a.claimId
      WHERE c.basisOfReimbursement <> '7'
         OR c.responseStatus <> 'P'
         OR c.macUnitAtDos IS NULL
         OR ABS(c.macUnitAtDos - a.macUnitPrice) > 0.0001
         OR c.drugId <> a.drugId
         OR c.pharmacyId <> a.pharmacyId
      LIMIT 5
    `;
    expect(bogus).toEqual([]);
  });
});

describe("the guarantee scorecard measures itself", () => {
  /*
   * A performance guarantee is worth the measurement behind it and nothing
   * more. These check the two ways a measurement gets quietly narrowed by the
   * party that owes the money: measuring a sample instead of the population,
   * and measuring a period long enough to bury the failure inside it.
   */

  // Standing after the year has closed, so all twelve months are measurable.
  const clock = {
    now: new Date(Date.UTC(PLAN_YEAR + 1, 0, 15)),
    today: new Date(Date.UTC(PLAN_YEAR + 1, 0, 15)),
    yearElapsed: 1,
  } as SimulationClock;

  const inPlanYear = {
    gte: new Date(Date.UTC(PLAN_YEAR, 0, 1)),
    lt: new Date(Date.UTC(PLAN_YEAR + 1, 0, 1)),
  };

  it("counts every case, not a sample of them", async () => {
    const scorecard = await getScorecard(clock);
    const [pa, files, appeals] = await Promise.all([
      prisma.priorAuthorization.count({
        where: { decidedAt: { not: null }, receivedAt: inPlanYear },
      }),
      prisma.eligibilityFile.count({ where: { receivedAt: inPlanYear } }),
      prisma.macAppeal.count({ where: { submittedAt: inPlanYear } }),
    ]);

    const sampleFor = (id: string) =>
      scorecard.rows.find((r) => r.guarantee.id === id)!.annualSample;

    expect(
      sampleFor("pa-standard") + sampleFor("pa-expedited"),
      "prior authorisations measured",
    ).toBe(pa);
    expect(sampleFor("eligibility-load"), "files measured").toBe(files);
    expect(sampleFor("mac-appeal"), "appeals measured").toBe(appeals);
  });

  it("adds every month's credit up to the total it reports", async () => {
    const scorecard = await getScorecard(clock);
    for (const row of scorecard.rows) {
      const summed = row.periods.reduce((s, p) => s + p.creditCents, 0);
      expect(row.creditCents, `${row.guarantee.id} credit`).toBe(summed);
      // A month that met its target never carries a credit, and a month that
      // missed always does.
      for (const p of row.periods) {
        if (p.met) expect(p.creditCents, `${row.guarantee.id} ${p.label}`).toBe(0);
        else
          expect(
            p.creditCents,
            `${row.guarantee.id} ${p.label}`,
          ).toBeGreaterThan(0);
      }
    }
    expect(scorecard.totalCreditCents).toBe(
      scorecard.rows.reduce((s, r) => s + r.creditCents, 0),
    );
  });

  it("never puts more than the contracted amount at risk in a month", async () => {
    const scorecard = await getScorecard(clock);
    for (const row of scorecard.rows) {
      const ceiling = Math.round(row.guarantee.atRiskCents / 12);
      for (const p of row.periods) {
        expect(
          p.creditCents,
          `${row.guarantee.id} ${p.label} exceeds a twelfth of the exposure`,
        ).toBeLessThanOrEqual(ceiling);
      }
      expect(row.creditCents).toBeLessThanOrEqual(row.guarantee.atRiskCents);
    }
  });

  /*
   * The measurement is reproducible from the case records, which is the whole
   * argument: anybody with a copy of the file arrives at the same number. This
   * recounts every month by hand and expects agreement to six places.
   */
  it("agrees with the case records anybody can count for themselves", async () => {
    const scorecard = await getScorecard(clock);
    const row = scorecard.rows.find((r) => r.guarantee.id === "pa-standard")!;
    expect(row.periods.length).toBeGreaterThan(6);

    for (const period of row.periods) {
      const from = new Date(Date.UTC(PLAN_YEAR, period.month, 1));
      const to = new Date(Date.UTC(PLAN_YEAR, period.month + 1, 1));
      const cases = await prisma.priorAuthorization.findMany({
        where: {
          urgency: "Standard",
          decidedAt: { not: null },
          receivedAt: { gte: from, lt: to },
        },
        select: { receivedAt: true, decidedAt: true },
      });
      const onTime = cases.filter(
        (c) => c.decidedAt!.getTime() - c.receivedAt.getTime() <= 72 * 3_600_000,
      ).length;

      expect(cases.length, `${period.label} sample`).toBe(period.sample);
      expect(
        (onTime / cases.length) * 100,
        `${period.label} measurement`,
      ).toBeCloseTo(period.measured, 6);
    }
  });

  it("attributes every missed month to something that happened", async () => {
    const scorecard = await getScorecard(clock);
    const missed = scorecard.rows.flatMap((r) =>
      r.periods.filter((p) => !p.met).map((p) => ({ id: r.guarantee.id, ...p })),
    );
    expect(missed.length, "a year with nothing to explain").toBeGreaterThan(0);

    const incidents = await prisma.serviceIncident.findMany();
    for (const m of missed) {
      const covered = incidents.some(
        (i) =>
          i.startedAt.getUTCMonth() <= m.month && i.endedAt.getUTCMonth() >= m.month,
      );
      expect(
        covered,
        `${m.id} missed in ${m.label} with no incident behind it`,
      ).toBe(true);
    }
  });
});

/**
 * What the agents are allowed to do, checked against what they did.
 *
 * An autonomy policy that lives in a settings page is a promise. An autonomy
 * policy that a test enforces over every row an agent ever wrote is a control.
 * These are the latter, and they are the reason the operations page can say
 * "nothing that moves money or denies care has ever applied itself" without
 * anybody having to take that on trust.
 */
describe("the agents did only what they were allowed to do", () => {
  it("never let a consequential action apply itself", async () => {
    const offenders = await prisma.agentProposal.findMany({
      where: { consequential: true, autoApplied: true },
      select: { id: true, agentId: true, action: true, headline: true },
      take: 5,
    });
    expect(
      offenders,
      "an action that moves money or denies care went in without a person",
    ).toEqual([]);
  });

  it("has consequential proposals to check, from more than one agent", async () => {
    const rows = await prisma.agentProposal.groupBy({
      by: ["agentId"],
      where: { consequential: true },
      _count: true,
    });
    expect(rows.length, "consequential work from too few agents").toBeGreaterThan(1);
    expect(
      rows.reduce((s, r) => s + r._count, 0),
      "no consequential proposals at all",
    ).toBeGreaterThan(100);
  });

  it("gave every proposal an outcome a person is accountable for", async () => {
    /*
     * An auto-applied action is deliberately exempt from needing a reviewer:
     * that is what the Act tier means, and the member service agent answering
     * a question at two in the morning has nobody to wait for. What is not
     * exempt is everything else — anything a person did decide has to say who
     * decided it, a reversal has to say why, and an applied action has to say
     * when.
     */
    const dangling = await prisma.agentProposal.count({
      where: {
        OR: [
          {
            status: { in: ["Applied", "Rejected"] },
            autoApplied: false,
            reviewedBy: null,
          },
          { status: "Rejected", overrideNote: null },
          { status: "Applied", appliedAt: null },
          // An accepted proposal carrying a note from an earlier decision
          // would be counted as a reversal, which is the one number on the
          // operations page nobody should be able to fudge by accident.
          { status: "Applied", overrideNote: { not: null } },
        ],
      },
    });
    expect(dangling, "proposals resolved by nobody, or with no reason given").toBe(0);

    // A reversal is always a person's doing, whatever the autonomy was.
    const anonymousReversal = await prisma.agentProposal.count({
      where: { status: "Rejected", reviewedBy: null },
    });
    expect(anonymousReversal, "an override with nobody's name on it").toBe(0);
  });

  it("ran every agent under a policy that existed when it ran", async () => {
    const runs = await prisma.agentRun.findMany({
      select: { id: true, agentId: true, startedAt: true, autonomy: true },
    });
    const policies = await prisma.agentPolicy.findMany();
    expect(policies.length, "no policy history").toBeGreaterThan(0);

    const bad: string[] = [];
    for (const run of runs) {
      const inForce = policies.find(
        (p) =>
          p.agentId === run.agentId &&
          p.effectiveFrom <= run.startedAt &&
          (p.effectiveTo === null || p.effectiveTo > run.startedAt),
      );
      if (!inForce) {
        bad.push(`${run.agentId} ran ${run.startedAt.toISOString()} under no policy`);
      } else if (inForce.autonomy !== run.autonomy) {
        bad.push(
          `${run.agentId} recorded ${run.autonomy} but policy said ${inForce.autonomy}`,
        );
      }
      if (bad.length >= 5) break;
    }
    expect(bad, "runs judged against a policy that was not in force").toEqual([]);
  });

  it("never called a tool the agent was not given", async () => {
    const { AGENTS } = await import("@/lib/agents/registry");
    const allowed = new Map(AGENTS.map((a) => [a.id, new Set(a.tools)]));

    const used = await prisma.$queryRaw<{ agentId: string; tool: string }[]>`
      SELECT DISTINCT r.agentId AS agentId, s.tool AS tool
      FROM AgentStep s JOIN AgentRun r ON r.id = s.runId
      WHERE s.kind = 'Tool' AND s.tool IS NOT NULL
    `;
    expect(used.length, "no tool calls recorded at all").toBeGreaterThan(0);

    const offenders = used.filter((u) => !allowed.get(u.agentId)?.has(u.tool));
    expect(offenders, "an agent reached outside its own toolbox").toEqual([]);
  });

  it("wrote a reason before every step, not after", async () => {
    const blank = await prisma.agentStep.count({
      where: { OR: [{ because: "" }, { summary: "" }] },
    });
    expect(blank, "steps with no stated reason or no result").toBe(0);
  });

  it("numbered every run's steps from one, with no gaps", async () => {
    const gaps = await prisma.$queryRaw<{ runId: string; n: number; hi: number }[]>`
      SELECT runId, COUNT(*) AS n, MAX(ordinal) AS hi
      FROM AgentStep GROUP BY runId
      HAVING MIN(ordinal) <> 1 OR MAX(ordinal) <> COUNT(*)
      LIMIT 5
    `;
    expect(gaps, "a run with a step missing from its trace").toEqual([]);
  });

  it("says which brain produced every step, and agrees with the run", async () => {
    const unlabelled = await prisma.agentStep.count({
      where: { brain: { notIn: ["model", "deterministic"] } },
    });
    expect(unlabelled, "steps that will not say what reasoned them").toBe(0);

    const disagreements = await prisma.$queryRaw<
      { id: string; runBrain: string; kinds: string }[]
    >`
      SELECT r.id AS id, r.brain AS runBrain, GROUP_CONCAT(DISTINCT s.brain) AS kinds
      FROM AgentRun r JOIN AgentStep s ON s.runId = r.id
      GROUP BY r.id
      HAVING (kinds LIKE '%,%' AND runBrain <> 'mixed')
          OR (kinds NOT LIKE '%,%' AND runBrain <> kinds)
      LIMIT 5
    `;
    expect(disagreements, "a run whose brain label contradicts its steps").toEqual([]);
  });

  it("refused the clinical questions rather than answering them well", async () => {
    const refusals = await prisma.agentRun.count({
      where: { agentId: "member-service", outcome: "Refused" },
    });
    expect(refusals, "the member agent never declined anything").toBeGreaterThan(0);

    /*
     * A refusal may still write one thing: the handoff, which is the record
     * that a person was given the question along with everything they need to
     * answer it. What it must never write is an action on the member's benefit.
     * Declining to advise and then quietly doing something anyway is the
     * failure mode this is here to catch.
     */
    const acted = await prisma.agentProposal.count({
      where: {
        run: { outcome: "Refused" },
        OR: [{ action: { not: "handoff" } }, { consequential: true }],
      },
    });
    expect(acted, "an agent refused and then acted regardless").toBe(0);

    const handoffs = await prisma.agentProposal.count({
      where: { run: { outcome: "Refused" }, action: "handoff" },
    });
    expect(
      handoffs,
      "questions declined with nobody handed the problem",
    ).toBe(refusals);
  });

  it("escalated rather than guessed when the note did not say", async () => {
    const escalated = await prisma.agentRun.count({
      where: { agentId: "pa-intake", outcome: "Escalated" },
    });
    const total = await prisma.agentRun.count({ where: { agentId: "pa-intake" } });
    expect(total, "no intake runs").toBeGreaterThan(0);

    // Neither number is a target. Zero would mean it is inventing facts that
    // are not in the note; a majority would mean it is not doing the work.
    const rate = escalated / total;
    expect(rate, "the intake agent never escalates").toBeGreaterThan(0.02);
    expect(rate, "the intake agent escalates nearly everything").toBeLessThan(0.5);

    // Every escalation must name the field it could not find.
    const silent = await prisma.agentRun.count({
      where: { agentId: "pa-intake", outcome: "Escalated", summary: "" },
    });
    expect(silent, "an escalation with nothing for the human to go on").toBe(0);
  });

  it("worked up a case that agrees with the signal that raised it", async () => {
    /*
     * An agent that reads a column nobody populated does not fail. It writes a
     * confident narrative built on zero, and the case reads as "no controlled
     * fills" next to a detector that counted five. Nothing above catches that,
     * because every row is present and every field is filled in. This does:
     * the agent's own count of opioid fills has to match the count the
     * detector reached independently, and if the two ever disagree one of them
     * is looking in the wrong place.
     */
    const signals = await prisma.integritySignal.findMany({
      where: { detectorId: "member.opioid-overutilisation" },
      select: { id: true, claimCount: true, subjectLabel: true },
    });
    expect(signals.length, "no opioid signals to check").toBeGreaterThan(0);

    const mismatches: string[] = [];
    for (const s of signals) {
      const step = await prisma.agentStep.findFirst({
        where: { kind: "Evidence", run: { subjectId: s.id, agentId: "integrity-triage" } },
        select: { detail: true },
      });
      if (!step) continue;
      const detail = JSON.parse(step.detail) as { controlled?: number };
      if (detail.controlled === undefined) continue;
      if (detail.controlled !== s.claimCount) {
        mismatches.push(
          `${s.subjectLabel}: detector counted ${s.claimCount} opioid fills, the agent found ${detail.controlled}`,
        );
      }
      if (mismatches.length >= 5) break;
    }
    expect(mismatches, "the case contradicts the signal behind it").toEqual([]);
  });

  it("wrote no sentence with a hole in it", async () => {
    /*
     * Everything these agents produce is prose assembled from template
     * literals, and the failure mode of a template literal is not an error, it
     * is a sentence that reads "from version undefined of our maximum
     * allowable cost list" and goes out to a pharmacy over somebody's
     * signature. Nothing else in this suite would notice, because the row is
     * present and the field is a string.
     */
    const holes = /\b(undefined|NaN|\[object Object\])\b|\$\{/;

    const offenders: string[] = [];

    for (const p of await prisma.agentProposal.findMany({
      select: { id: true, agentId: true, headline: true, rationale: true, payload: true },
    })) {
      for (const [field, text] of [
        ["headline", p.headline],
        ["rationale", p.rationale],
        ["payload", p.payload],
      ] as const) {
        if (holes.test(text)) {
          offenders.push(`${p.agentId} proposal ${field}: ${text.slice(0, 160)}`);
          break;
        }
      }
      if (offenders.length >= 5) break;
    }

    /*
     * Matched in JavaScript rather than with a SQL `contains`, because SQLite
     * folds case in LIKE and "NaN" is inside "maintenance", which every one of
     * these agents says several times a day.
     */
    for (const s of await prisma.agentStep.findMany({
      select: { runId: true, summary: true, because: true },
    })) {
      if (holes.test(s.summary) || holes.test(s.because)) {
        offenders.push(`step in run ${s.runId}: ${s.summary.slice(0, 160)}`);
        if (offenders.length >= 10) break;
      }
    }

    expect(offenders, "an agent wrote a sentence with a hole in it").toEqual([]);
  });

  it("costed every run, including the free ones", async () => {
    const rows = await prisma.$queryRaw<{ brain: string; n: number; bad: number }[]>`
      SELECT brain, COUNT(*) AS n,
             SUM(CASE WHEN brain = 'deterministic'
                        AND (costMillicents <> 0 OR inputTokens <> 0) THEN 1
                      WHEN brain <> 'deterministic'
                        AND modelName IS NULL THEN 1
                      ELSE 0 END) AS bad
      FROM AgentRun GROUP BY brain
    `;
    for (const r of rows) {
      expect(Number(r.bad), `${r.brain} runs costed wrong`).toBe(0);
    }
  });
});

/**
 * The modelled member score.
 *
 * A published NPS invites two specific kinds of doubt: that the arithmetic does
 * not add up, and that the population was chosen to flatter the result. These
 * check both, since neither is answerable by looking at the headline figure.
 */
describe("member experience", () => {
  let reading: Awaited<ReturnType<typeof readingFrom>>;
  let clock: SimulationClock;

  beforeAll(async () => {
    clock = resolveClock(null);
    reading = readingFrom(await buildExperiences(clock));
  });

  it("accounts for every scored member exactly once", () => {
    const c = reading.census;
    expect(c.promoters + c.passives + c.detractors).toBe(c.scored);
    expect(reading.histogram.reduce((a, b) => a + b, 0)).toBe(c.scored);
  });

  it("puts each member in the segment their answer implies", () => {
    const h = reading.histogram;
    expect(h[9] + h[10]).toBe(reading.census.promoters);
    expect(h[7] + h[8]).toBe(reading.census.passives);
    expect(h.slice(0, 7).reduce((a, b) => a + b, 0)).toBe(
      reading.census.detractors,
    );
  });

  it("computes the score the way the definition says", () => {
    const c = reading.census;
    const expected =
      Math.round(((c.promoters - c.detractors) / c.scored) * 1000) / 10;
    expect(c.nps).toBe(expected);
  });

  it("surveys a subset of the people it scored, never more", () => {
    expect(reading.surveyed.scored).toBeLessThan(reading.census.scored);
    expect(reading.surveyed.scored).toBeGreaterThan(0);
    expect(reading.surveyed.promoters).toBeLessThanOrEqual(
      reading.census.promoters,
    );
    expect(reading.surveyed.detractors).toBeLessThanOrEqual(
      reading.census.detractors,
    );
  });

  it("over-represents the people with something to say", () => {
    /*
     * The whole argument for showing the surveyed figure is that response is
     * not random. If the modelled respondents ever came back looking like the
     * population, the second number would be decoration.
     */
    const censusExtreme =
      (reading.census.promoters + reading.census.detractors) /
      reading.census.scored;
    const surveyExtreme =
      (reading.surveyed.promoters + reading.surveyed.detractors) /
      reading.surveyed.scored;
    expect(surveyExtreme).toBeGreaterThan(censusExtreme);
  });

  it("scores exactly the members who presented a prescription", async () => {
    const withClaims = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT memberId) AS n
      FROM Claim WHERE dateOfService <= ${clock.now}
    `;
    expect(reading.census.scored).toBe(Number(withClaims[0].n));

    // And nobody outside that population sneaked in.
    const enrolled = await prisma.member.count();
    expect(reading.census.scored).toBeLessThan(enrolled);
  });

  it("keeps every answer on the scale it claims to use", () => {
    expect(reading.histogram).toHaveLength(11);
    for (const n of reading.histogram) expect(n).toBeGreaterThanOrEqual(0);
  });

  it("does not let one term run away with the total", () => {
    /*
     * Not a correctness property but a modelling one, and the reason it is
     * asserted rather than eyeballed: a score dominated by a single term has
     * silently stopped being about the benefit and become a restatement of
     * that term. If a future change to the book pushes one past half of all
     * damage done, that is worth being told about.
     */
    const negatives = reading.drivers.filter((d) => d.totalPoints < 0);
    const total = negatives.reduce((s, d) => s + Math.abs(d.totalPoints), 0);
    const worst = Math.abs(negatives[0].totalPoints);
    expect(worst / total).toBeLessThan(0.5);
  });

  it("does not pile members against either end of the scale", () => {
    // Clamping is inevitable on a bounded scale; a clamp doing the work of the
    // schedule is not. Past roughly a tenth at either end, the model has lost
    // the ability to tell a bad year from a ruinous one.
    const c = reading.census;
    expect(reading.histogram[0] / c.scored).toBeLessThan(0.1);
    expect(reading.histogram[10] / c.scored).toBeLessThan(0.1);
  });

  it("marks a member who was only ever turned away as a detractor", () => {
    const turnedAway = scoreMember({
      ...emptyExperience("m-rejected-only"),
      totalClaims: 3,
      paidClaims: 0,
      rejectsPaRequired: 3,
    });
    expect(turnedAway.segment).toBe("detractor");
  });

  it("gives a clean year a passive at worst", () => {
    const clean = scoreMember({
      ...emptyExperience("m-clean"),
      totalClaims: 11,
      paidClaims: 11,
      oopCents: 4_200,
      worstFillCents: 1_000,
    });
    expect(clean.score).toBeGreaterThanOrEqual(7);
  });

  it("never lets a single term exceed its published cap", () => {
    const hammered = scoreMember({
      ...emptyExperience("m-hammered"),
      totalClaims: 90,
      paidClaims: 40,
      rejectsPaRequired: 50,
      reversals: 40,
    });
    for (const term of hammered.applied) {
      const cap = RUBRIC_BY_ID[term.id]?.cap;
      if (cap === undefined) continue;
      if (cap < 0) expect(term.points).toBeGreaterThanOrEqual(cap);
      else expect(term.points).toBeLessThanOrEqual(cap);
    }
  });
});
