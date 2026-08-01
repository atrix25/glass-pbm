/**
 * Invariants over the whole book.
 *
 * A golden test proves one claim is right. These prove that nothing anywhere
 * in 40,000 claims violates a property the contract guarantees. They are the
 * tests that would catch a rounding bug that only shows up on one drug, or a
 * pass-through leak that only opens on one channel.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "@/lib/db";

interface ClaimRow {
  id: string;
  claimNumber: string;
  responseStatus: string;
  totalBilledCents: number;
  pharmacyPaidCents: number;
  planPaidCents: number;
  patientPayCents: number;
  billedIngredientCostCents: number;
  billedDispensingFeeCents: number;
  allowedIngredientCostCents: number;
  allowedDispensingFeeCents: number;
  totalAllowedCents: number;
  formularyLevel: string | null;
  brandSelectionPenaltyCents: number;
  channel: string;
  memberId: string;
  dateOfService: Date;
  usualAndCustomaryCents: number;
  basisOfReimbursement: string | null;
}

let paid: ClaimRow[] = [];

beforeAll(async () => {
  paid = (await prisma.claim.findMany({
    where: { responseStatus: "P" },
    select: {
      id: true,
      claimNumber: true,
      responseStatus: true,
      totalBilledCents: true,
      pharmacyPaidCents: true,
      planPaidCents: true,
      patientPayCents: true,
      billedIngredientCostCents: true,
      billedDispensingFeeCents: true,
      allowedIngredientCostCents: true,
      allowedDispensingFeeCents: true,
      totalAllowedCents: true,
      formularyLevel: true,
      brandSelectionPenaltyCents: true,
      channel: true,
      memberId: true,
      dateOfService: true,
      usualAndCustomaryCents: true,
      basisOfReimbursement: true,
    },
  })) as ClaimRow[];

  expect(paid.length).toBeGreaterThan(1000);
});

describe("pass-through", () => {
  /*
   * The amount remitted to the pharmacy is the total less what the member
   * hands over at the counter, so the pass-through property is not
   * "remittance equals billed". It is that the plan is billed exactly what the
   * pharmacy is entitled to: one rate row prices both sides.
   */
  it("bills the plan exactly what the pharmacy is owed, on every claim", () => {
    const leaks = paid.filter(
      (c) => c.totalBilledCents !== c.totalAllowedCents,
    );
    expect(
      leaks.slice(0, 5).map((c) => ({
        claim: c.claimNumber,
        billedToPlan: c.totalBilledCents,
        allowedToPharmacy: c.totalAllowedCents,
      })),
    ).toEqual([]);
  });

  it("retains zero spread in aggregate", () => {
    const spread = paid.reduce(
      (s, c) => s + (c.totalBilledCents - c.totalAllowedCents),
      0,
    );
    expect(spread).toBe(0);
  });

  it("leaves the pharmacy whole between the remittance and the counter", () => {
    const bad = paid.filter(
      (c) => c.pharmacyPaidCents + c.patientPayCents !== c.totalAllowedCents,
    );
    expect(bad.length).toBe(0);
  });
});

describe("money conservation", () => {
  it("splits every billed dollar between the plan and the member, with nothing left over", () => {
    const bad = paid.filter(
      (c) => c.planPaidCents + c.patientPayCents !== c.totalBilledCents,
    );
    expect(
      bad.slice(0, 5).map((c) => ({
        claim: c.claimNumber,
        plan: c.planPaidCents,
        member: c.patientPayCents,
        total: c.totalBilledCents,
      })),
    ).toEqual([]);
  });

  it("builds the total from ingredient cost plus dispensing fee", () => {
    const bad = paid.filter(
      (c) =>
        c.billedIngredientCostCents + c.billedDispensingFeeCents !==
        c.totalBilledCents,
    );
    expect(bad.length).toBe(0);
  });

  it("never pays a negative amount to anyone", () => {
    const negative = paid.filter(
      (c) =>
        c.planPaidCents < 0 ||
        c.patientPayCents < 0 ||
        c.totalBilledCents < 0 ||
        c.billedDispensingFeeCents < 0,
    );
    expect(negative.length).toBe(0);
  });

  it("never charges the member more than the claim is worth", () => {
    const over = paid.filter((c) => c.patientPayCents > c.totalBilledCents);
    expect(
      over.slice(0, 5).map((c) => ({
        claim: c.claimNumber,
        member: c.patientPayCents,
        total: c.totalBilledCents,
      })),
    ).toEqual([]);
  });
});

describe("the lesser-of never loses to the cash price", () => {
  it("never bills more than the pharmacy's own usual and customary price", () => {
    const over = paid.filter(
      (c) =>
        c.usualAndCustomaryCents > 0 &&
        c.billedIngredientCostCents > c.usualAndCustomaryCents,
    );
    expect(
      over.slice(0, 5).map((c) => ({
        claim: c.claimNumber,
        billed: c.billedIngredientCostCents,
        cash: c.usualAndCustomaryCents,
      })),
    ).toEqual([]);
  });
});

describe("cost share ceilings from the Certificate of Coverage", () => {
  /*
   * Read the ceiling from the plan the member is actually on rather than
   * hardcoding the IYC retail figures. The two plans differ, and a 90-day
   * fill carries a multiple of the 30-day copay, so a single hardcoded cap
   * would flag correct claims on three separate counts.
   */
  it("never charges more per fill than the member's own plan allows", async () => {
    const rules = await prisma.costShareRule.findMany();
    const byPlan = new Map<string, (typeof rules)[number]>();
    for (const r of rules) {
      byPlan.set(`${r.benefitPlanId}|${r.level}|${r.channel}`, r);
    }

    const eligibilities = await prisma.eligibilitySpan.findMany({
      select: { memberId: true, benefitPlanId: true },
    });
    const memberPlan = new Map(
      eligibilities.map((e) => [e.memberId, e.benefitPlanId]),
    );

    const breaches: unknown[] = [];
    for (const c of paid) {
      const planId = memberPlan.get(c.memberId);
      if (!planId) continue;
      const rule = byPlan.get(`${planId}|${c.formularyLevel}|${c.channel}`);
      if (!rule) continue;

      const ceiling =
        rule.costShareType === "Copay"
          ? (rule.copayCents ?? 0)
          : (rule.coinsuranceMaxCents ?? Number.MAX_SAFE_INTEGER);

      // The brand selection penalty is a separate charge that the per-fill
      // maximum does not govern.
      const governed = c.patientPayCents - c.brandSelectionPenaltyCents;
      if (governed > ceiling) {
        breaches.push({
          claim: c.claimNumber,
          plan: planId,
          level: c.formularyLevel,
          channel: c.channel,
          paid: governed,
          ceiling,
        });
      }
    }
    expect(breaches.slice(0, 5)).toEqual([]);
  });

  it("never charges anything on a preventive fill", () => {
    const over = paid.filter(
      (c) => c.formularyLevel === "$0" && c.patientPayCents > 0,
    );
    expect(over.length).toBe(0);
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
   */
  interface Limit {
    limitCents: number;
    qualifyingLevels: Set<string>;
  }

  let limits: Map<string, Limit>;
  let memberPlan: Map<string, string>;

  beforeAll(async () => {
    const plans = await prisma.benefitPlan.findMany({
      include: { costShareRules: true },
    });
    limits = new Map(
      plans.map((p) => [
        p.id,
        {
          limitCents: p.rxOopLimitIndividual,
          qualifyingLevels: new Set(
            p.costShareRules
              .filter((r) => r.accumulatesToRxOop)
              .map((r) => r.level),
          ),
        },
      ]),
    );

    const eligibilities = await prisma.eligibilitySpan.findMany({
      select: { memberId: true, benefitPlanId: true },
    });
    memberPlan = new Map(
      eligibilities.map((e) => [e.memberId, e.benefitPlanId]),
    );
  });

  const qualifyingByMember = () => {
    const totals = new Map<string, { planId: string; cents: number }>();
    for (const c of paid) {
      const planId = memberPlan.get(c.memberId);
      if (!planId) continue;
      const limit = limits.get(planId);
      if (!limit || !limit.qualifyingLevels.has(c.formularyLevel ?? "")) continue;
      const cur = totals.get(c.memberId) ?? { planId, cents: 0 };
      // A brand selection penalty is what the member chooses to pay to get
      // the brand, not plan cost sharing, so it sits outside the limit.
      cur.cents += c.patientPayCents - c.brandSelectionPenaltyCents;
      totals.set(c.memberId, cur);
    }
    return totals;
  };

  it("caps qualifying cost share at each member's own plan limit", () => {
    const breaches = [...qualifyingByMember().entries()]
      .filter(([, v]) => v.cents > (limits.get(v.planId)?.limitCents ?? 0))
      .slice(0, 5)
      .map(([id, v]) => ({
        member: id,
        plan: v.planId,
        paid: v.cents,
        limit: limits.get(v.planId)?.limitCents,
      }));
    expect(breaches).toEqual([]);
  });

  it("has members who actually reach the limit", () => {
    // A limit nothing ever touches is a limit that has not been tested.
    const atLimit = [...qualifyingByMember().values()].filter(
      (v) => v.cents === limits.get(v.planId)?.limitCents,
    );
    expect(atLimit.length).toBeGreaterThan(0);
  });
});

describe("rejected claims move no money", () => {
  it("pays nothing on any rejected claim", async () => {
    const rejected = await prisma.claim.findMany({
      where: { responseStatus: "R" },
      select: {
        claimNumber: true,
        planPaidCents: true,
        patientPayCents: true,
        totalBilledCents: true,
        pharmacyPaidCents: true,
      },
    });
    expect(rejected.length).toBeGreaterThan(100);
    const moved = rejected.filter(
      (c) =>
        c.planPaidCents !== 0 ||
        c.patientPayCents !== 0 ||
        c.totalBilledCents !== 0 ||
        c.pharmacyPaidCents !== 0,
    );
    expect(moved.length).toBe(0);
  });

  it("gives every rejected claim a reason code", async () => {
    const unexplained = await prisma.claim.count({
      where: { responseStatus: "R", OR: [{ rejectCodes: "" }, { rejectCodes: "[]" }] },
    });
    expect(unexplained).toBe(0);
  });
});

describe("every claim carries its derivation", () => {
  it("stores a trace on every claim", async () => {
    const untraced = await prisma.claim.count({
      where: { OR: [{ traceJson: null }, { traceJson: "" }] },
    });
    expect(untraced).toBe(0);
  });

  it("cites a source document on the rules that decide money", async () => {
    const sample = await prisma.claim.findMany({
      where: { responseStatus: "P" },
      select: { claimNumber: true, traceJson: true },
      take: 250,
    });

    for (const claim of sample) {
      const trace = JSON.parse(claim.traceJson ?? "[]") as {
        stage: string;
        sourceDocumentId?: string;
      }[];
      const pricing = trace.filter((t) => t.stage === "pricing");
      expect(pricing.length).toBeGreaterThan(0);
      expect(
        pricing.every((t) => Boolean(t.sourceDocumentId)),
      ).toBe(true);
    }
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
  it("pays no claim requiring prior authorization without an approval covering the date", async () => {
    const paidPaDrugs = await prisma.claim.findMany({
      where: {
        responseStatus: "P",
        drug: {
          formularyEntries: { some: { requiresPA: true } },
        },
      },
      select: {
        claimNumber: true,
        memberId: true,
        drugId: true,
        dateOfService: true,
      },
      take: 500,
    });

    for (const c of paidPaDrugs) {
      const approval = await prisma.priorAuthorization.findFirst({
        where: {
          memberId: c.memberId,
          drugId: c.drugId,
          determination: "Approved",
          approvedEffectiveDate: { lte: c.dateOfService },
          approvedTerminationDate: { gte: c.dateOfService },
        },
        select: { id: true },
      });
      expect(
        approval ? null : `${c.claimNumber} paid with no covering approval`,
      ).toBeNull();
    }
  });
});
