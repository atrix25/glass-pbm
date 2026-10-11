/**
 * Discount-list / exclusion products (formulary level 100%/EX).
 *
 * The Certificate of Coverage puts weight-loss and similar products on the
 * discount drug list at 100% member cost, and says they do not count toward
 * any out-of-pocket limit. Formulary ingest leaves `notCovered` false for
 * `100%/EX` (only NC / NC/3P flip that flag), so these fills reach pricing
 * and cost share rather than rejecting 70.
 *
 * costShareType "NotCovered" used to fall through the copay/coinsurance
 * branches with a zero share. On the IYC plan that meant the member owed
 * nothing and the plan paid the whole fill. On the HDHP it folded the fill
 * into the deductible and credited OOP progress the CoC forbids.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { drug, entry, makeContext, HDHP_PLAN, PLAN } from "./fixtures";

const exclusionEntry = () =>
  entry({
    level: "100%/EX",
    // Mirrors formulary ingest: 100%/EX is not the NC flag.
    notCovered: false,
    planExclusion: false,
  });

describe("a 100%/EX discount-list product", () => {
  it("charges the member the full allowed amount on the IYC plan", () => {
    const result = adjudicate(
      makeContext({
        drug: drug({ name: "WEIGHT LOSS INJ", isBrandLabel: true, nadacPerUnit: 40 }),
        formularyEntry: exclusionEntry(),
        plan: PLAN,
        quantityDispensed: 1,
        daysSupply: 30,
      }),
    );

    expect(result.responseStatus).toBe("P");
    expect(result.formularyLevel).toBe("100%/EX");
    expect(result.patientPayCents).toBe(result.totalBilledCents);
    expect(result.planPaidCents).toBe(0);
    expect(result.pharmacyPaidCents).toBe(0);
    expect(result.appliedToDeductibleCents).toBe(0);
    expect(result.costShare?.accumulatorDeltas ?? []).toEqual([]);
  });

  it("does not credit the HDHP deductible or either OOP accumulator", () => {
    const result = adjudicate(
      makeContext({
        drug: drug({ name: "WEIGHT LOSS CAP", isBrandLabel: true, nadacPerUnit: 25 }),
        formularyEntry: exclusionEntry(),
        plan: HDHP_PLAN,
        quantityDispensed: 30,
        daysSupply: 30,
        accumulators: {
          rxOopAccumulatedCents: 0,
          federalOopAccumulatedCents: 0,
          deductibleAccumulatedCents: 0,
        },
      }),
    );

    expect(result.responseStatus).toBe("P");
    expect(result.patientPayCents).toBe(result.totalBilledCents);
    expect(result.planPaidCents).toBe(0);
    expect(result.appliedToDeductibleCents).toBe(0);
    expect(result.costShare?.accumulatorDeltas ?? []).toEqual([]);
  });

  it("still leaves the pharmacy whole between remittance and the counter", () => {
    const result = adjudicate(
      makeContext({
        drug: drug({ name: "WEIGHT LOSS TAB", isBrandLabel: true, nadacPerUnit: 12 }),
        formularyEntry: exclusionEntry(),
        plan: PLAN,
      }),
    );
    expect(result.pharmacyPaidCents + result.patientPayCents).toBe(
      result.totalAllowedCents,
    );
  });
});
