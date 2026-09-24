/**
 * Medical deductible spend on the HDHP must credit the integrated MOOP.
 *
 * The High Deductible Health Plan runs one $1,700 deductible and one $2,500
 * out-of-pocket maximum across medical and pharmacy. Pharmacy fills already
 * push deductible dollars into Rx/federal OOP through cost-share deltas. The
 * medical carrier feed must do the same: otherwise a member who met the
 * deductible at a hospital can still be charged a full $2,500 at the pharmacy
 * counter — double-collecting the deductible against a single maximum.
 */

import { describe, expect, it } from "vitest";
import {
  applyMedicalDeductibleCredit,
  medicalDeductibleAsOf,
  medicalEncountersFor,
} from "@/lib/accumulators/medical-feed";
import { adjudicate } from "@/lib/engine/adjudicate";
import type { EngineBenefitPlan } from "@/lib/engine/adjudicate";
import { drug, entry, makeContext, HDHP_PLAN, SPECIALTY_PHARMACY } from "./fixtures";

/** HDHP rules with open coinsurance so a single fill can hit the MOOP cap. */
function hdhpOpenCoinsurance(): EngineBenefitPlan {
  return {
    ...HDHP_PLAN,
    costShareRules: HDHP_PLAN.costShareRules.map((r) =>
      r.level === "1"
        ? {
            ...r,
            costShareType: "Coinsurance" as const,
            copayCents: null,
            coinsuranceRateBps: 10_000,
            coinsuranceMaxCents: null,
            accumulatesToRxOop: true,
            accumulatesToFederalOop: true,
          }
        : { ...r, accumulatesToRxOop: true },
    ),
  };
}

describe("applyMedicalDeductibleCredit", () => {
  it("credits medical dollars to deductible and both OOP accumulators", () => {
    const acc = {
      deductibleAccumulatedCents: 0,
      rxOopAccumulatedCents: 0,
      federalOopAccumulatedCents: 0,
    };
    applyMedicalDeductibleCredit(acc, 170_000);
    expect(acc.deductibleAccumulatedCents).toBe(170_000);
    expect(acc.rxOopAccumulatedCents).toBe(170_000);
    expect(acc.federalOopAccumulatedCents).toBe(170_000);
  });

  it("ignores non-positive amounts", () => {
    const acc = {
      deductibleAccumulatedCents: 10,
      rxOopAccumulatedCents: 10,
      federalOopAccumulatedCents: 10,
    };
    applyMedicalDeductibleCredit(acc, 0);
    expect(acc.deductibleAccumulatedCents).toBe(10);
  });
});

describe("integrated MOOP after medical meets the deductible", () => {
  it("caps pharmacy cost share at the remaining $800, not another $2,500", () => {
    const plan = hdhpOpenCoinsurance();
    const medical = plan.deductibleIndividual;
    const expensive = drug({
      name: "SPECIALTY BRAND INJ",
      isBrandLabel: true,
      isSpecialty: true,
      nadacPerUnit: 400,
    });

    const wrong = adjudicate(
      makeContext({
        drug: expensive,
        formularyEntry: entry({ level: "1" }),
        pharmacy: SPECIALTY_PHARMACY,
        plan,
        // Medical met the deductible but OOP was left at zero — the bug.
        accumulators: {
          deductibleAccumulatedCents: medical,
          rxOopAccumulatedCents: 0,
          federalOopAccumulatedCents: 0,
        },
      }),
    );

    const right = adjudicate(
      makeContext({
        drug: expensive,
        formularyEntry: entry({ level: "1" }),
        pharmacy: SPECIALTY_PHARMACY,
        plan,
        accumulators: {
          deductibleAccumulatedCents: medical,
          rxOopAccumulatedCents: medical,
          federalOopAccumulatedCents: medical,
        },
      }),
    );

    const remainingAfterMedical =
      plan.rxOopLimitIndividual - medical; /* $800 */
    expect(right.patientPayCents).toBe(remainingAfterMedical);
    expect(wrong.patientPayCents).toBeGreaterThan(right.patientPayCents);
    expect(wrong.patientPayCents - right.patientPayCents).toBe(medical);
  });
});

describe("medicalDeductibleAsOf stays a pure sum for callers that credit OOP", () => {
  it("returns only encounters strictly before the fill day", () => {
    const encounters = medicalEncountersFor("member-oop-credit", 170_000);
    if (encounters.length === 0) return;
    const mid = encounters[Math.floor(encounters.length / 2)]!.day;
    const asOf = medicalDeductibleAsOf(encounters, mid);
    const expected = encounters
      .filter((e) => e.day < mid)
      .reduce((s, e) => s + e.amountCents, 0);
    expect(asOf).toBe(expected);
  });
});
