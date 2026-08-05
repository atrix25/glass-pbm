/**
 * The deductible, and who pays it.
 *
 * A deductible is the amount the member pays before the plan starts paying. It
 * is the least ambiguous term in a benefit design, and this engine got it
 * backwards: the amount applied to the deductible was recorded on the claim,
 * credited to the member's accumulator, and left out of what the member owed.
 * The plan paid it. The member's ledger then showed them steadily meeting a
 * deductible out of money nobody had spent, and because the arithmetic balanced
 * — plan paid plus member paid equalled the allowed amount every time — nothing
 * downstream complained.
 *
 * Measured across the seeded book before the fix: 204,966 fills applied
 * $11,914,559 to deductibles, and 200,030 of them charged the member nothing.
 *
 * These tests pin the shape of the rule so it cannot quietly invert again.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { drug, entry, makeContext, HDHP_PLAN, PLAN } from "./fixtures";

const generic = () => drug({ name: "atorvastatin tab", nadacPerUnit: 4 });

/** A Level 1 generic on the high deductible plan, at a stated point in the year. */
function fillUnderHdhp(deductibleAccumulatedCents: number, level = "1") {
  return adjudicate(
    makeContext({
      drug: generic(),
      formularyEntry: entry({ level }),
      plan: HDHP_PLAN,
      quantityDispensed: 30,
      daysSupply: 30,
      accumulators: {
        rxOopAccumulatedCents: deductibleAccumulatedCents,
        federalOopAccumulatedCents: deductibleAccumulatedCents,
        deductibleAccumulatedCents,
      },
    }),
  );
}

describe("a member under an unmet deductible", () => {
  it("pays for the fill themselves", () => {
    const result = fillUnderHdhp(0);
    expect(result.responseStatus).toBe("P");
    expect(result.appliedToDeductibleCents).toBeGreaterThan(0);
    // The whole fill sits inside the remaining deductible, so the member owes
    // all of it and the plan owes none of it.
    expect(result.patientPayCents).toBe(result.totalBilledCents);
    expect(result.planPaidCents).toBe(0);
  });

  it("owes exactly what was applied to the deductible", () => {
    const result = fillUnderHdhp(0);
    expect(result.patientPayCents).toBe(
      result.appliedToDeductibleCents + result.copayCoinsuranceCents,
    );
  });

  it("does not pay a copay on top of the deductible for the same dollars", () => {
    // Cost share applies to what is left after the deductible, and when the
    // deductible swallows the fill there is nothing left for it to apply to.
    const result = fillUnderHdhp(0);
    expect(result.copayCoinsuranceCents).toBe(0);
  });

  it("gets deductible credit only for money it actually paid", () => {
    const result = fillUnderHdhp(0);
    expect(result.appliedToDeductibleCents).toBeLessThanOrEqual(
      result.patientPayCents,
    );
  });

  it("still has the pharmacy made whole", () => {
    // Who owes the money changes; the pharmacy's cheque does not.
    const result = fillUnderHdhp(0);
    expect(result.pharmacyPaidCents + result.patientPayCents).toBe(
      result.totalAllowedCents,
    );
  });
});

describe("a member who has partly met the deductible", () => {
  it("splits the fill at the boundary", () => {
    const full = fillUnderHdhp(0);
    // Leave less remaining deductible than the fill costs.
    const remaining = Math.floor(full.totalBilledCents / 3);
    const result = fillUnderHdhp(HDHP_PLAN.deductibleIndividual - remaining);

    expect(result.appliedToDeductibleCents).toBe(remaining);
    // The rest is subject to ordinary cost share, and a Level 1 copay is less
    // than the remainder, so the plan picks up the difference.
    expect(result.copayCoinsuranceCents).toBeGreaterThan(0);
    expect(result.patientPayCents).toBe(
      result.appliedToDeductibleCents + result.copayCoinsuranceCents,
    );
    expect(result.planPaidCents).toBe(
      result.totalBilledCents - result.patientPayCents,
    );
  });
});

describe("a member who has met the deductible", () => {
  it("pays ordinary cost share and nothing more", () => {
    const result = fillUnderHdhp(HDHP_PLAN.deductibleIndividual);
    expect(result.appliedToDeductibleCents).toBe(0);
    expect(result.patientPayCents).toBe(result.copayCoinsuranceCents);
    expect(result.patientPayCents).toBeGreaterThan(0);
  });
});

describe("a plan with no deductible", () => {
  it("is left exactly as it was", () => {
    // The other Wisconsin plan carries no deductible, and the fix must not
    // reach it: its members were charged correctly all along.
    const result = adjudicate(
      makeContext({
        drug: generic(),
        formularyEntry: entry({ level: "1" }),
        plan: PLAN,
      }),
    );
    expect(result.appliedToDeductibleCents).toBe(0);
    expect(result.patientPayCents).toBe(result.copayCoinsuranceCents);
  });
});

describe("the deductible and the out-of-pocket limit together", () => {
  it("never charges the member past the out-of-pocket limit", () => {
    const nearLimit = HDHP_PLAN.rxOopLimitIndividual - 500;
    const result = adjudicate(
      makeContext({
        drug: drug({ name: "SPECIALTY BRAND INJ", isBrandLabel: true, nadacPerUnit: 400 }),
        formularyEntry: entry({ level: "1" }),
        plan: HDHP_PLAN,
        accumulators: {
          rxOopAccumulatedCents: nearLimit,
          federalOopAccumulatedCents: nearLimit,
          deductibleAccumulatedCents: 0,
        },
      }),
    );
    expect(result.patientPayCents).toBe(500);
  });

  it("credits the deductible only up to what the capped member paid", () => {
    /*
     * When the out-of-pocket limit cuts the member's liability below the amount
     * that fell inside the deductible, the credit has to be cut with it.
     * Otherwise the ledger records progress toward a deductible out of money
     * nobody spent — the same error as charging the deductible to the plan, one
     * step further along.
     */
    const nearLimit = HDHP_PLAN.rxOopLimitIndividual - 500;
    const result = adjudicate(
      makeContext({
        drug: drug({ name: "SPECIALTY BRAND INJ", isBrandLabel: true, nadacPerUnit: 400 }),
        formularyEntry: entry({ level: "1" }),
        plan: HDHP_PLAN,
        accumulators: {
          rxOopAccumulatedCents: nearLimit,
          federalOopAccumulatedCents: nearLimit,
          deductibleAccumulatedCents: 0,
        },
      }),
    );
    expect(result.appliedToDeductibleCents).toBe(result.patientPayCents);
    expect(result.appliedToDeductibleCents).toBe(500);
  });
});

describe("a preventive drug under a high deductible plan", () => {
  it("is free before the deductible is met", () => {
    /*
     * The HSA safe harbour, and the one case where the plan really does pay
     * before the deductible. A Level $0 preventive drug returns before the
     * deductible is considered at all, so the fix must leave it alone.
     */
    const result = adjudicate(
      makeContext({
        drug: generic(),
        formularyEntry: entry({ level: "$0" }),
        plan: HDHP_PLAN,
        accumulators: {
          rxOopAccumulatedCents: 0,
          federalOopAccumulatedCents: 0,
          deductibleAccumulatedCents: 0,
        },
      }),
    );
    expect(result.patientPayCents).toBe(0);
    expect(result.appliedToDeductibleCents).toBe(0);
    expect(result.planPaidCents).toBe(result.totalBilledCents);
  });
});

describe("the trace explains the charge", () => {
  it("says the member owes the deductible, in the step that applies it", () => {
    const result = fillUnderHdhp(0);
    const step = result.trace.find((s) => s.ruleId === "costshare.deductible");
    expect(step).toBeDefined();
    expect(step!.fired).toBe(true);
    expect(step!.detail).toContain("member pays");
    expect(step!.citation).toContain("High Deductible Health Plan");
  });
});
