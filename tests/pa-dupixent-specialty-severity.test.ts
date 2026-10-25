/**
 * Dupixent AD initial must clear specialty (form step 6) and BSA / sensitive-area
 * severity (form step 8) before the topical-trial Approve. Without those gates,
 * Internal Medicine + a topical fill persisted Approve and unlocked specialty POS.
 */

import { describe, expect, it } from "vitest";
import { DUPIXENT } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function adFacts(overrides: Partial<PAFacts> = {}): PAFacts {
  const { answers: answerOverrides, ...rest } = overrides;
  return {
    condition: "atopic-dermatitis-initial",
    prescriberSpecialty: "Dermatology",
    memberDiagnosisCodes: ["L20.9"],
    memberAgeYears: 34,
    memberWeightKg: 70,
    filledDrugNames: [],
    ...rest,
    answers: {
      quantityLimitBasis: ["maintenance-ad-asthma"],
      diagnosisProvided: true,
      adSeverityCriteria: ["bsa-10pct-or-more"],
      topicalTrialDocumented: true,
      ...answerOverrides,
    },
  };
}

describe("Dupixent AD initial specialty and severity gates", () => {
  it("Approves when Dermatology, BSA ≥10%, and topical trial are present", () => {
    const d = determinePA(DUPIXENT, adFacts());
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(10);
    expect(d.path.map((p) => p.step)).toEqual([1, 3, 4, 5, 6, 8, 10]);
  });

  it("Denies Internal Medicine at specialty step 6 (form requires allergist/immuno/derm)", () => {
    const d = determinePA(
      DUPIXENT,
      adFacts({ prescriberSpecialty: "Internal Medicine" }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(6);
  });

  it("Denies Pulmonology at specialty step 6", () => {
    const d = determinePA(
      DUPIXENT,
      adFacts({ prescriberSpecialty: "Pulmonology" }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(6);
  });

  it("Denies when specialty is missing", () => {
    const d = determinePA(
      DUPIXENT,
      adFacts({ prescriberSpecialty: undefined }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(6);
  });

  it("Denies when BSA / sensitive-area severity is not selected", () => {
    const d = determinePA(
      DUPIXENT,
      adFacts({
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
          adSeverityCriteria: [],
          topicalTrialDocumented: true,
        },
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(8);
  });

  it("Approves Allergy and Immunology with sensitive-area severity", () => {
    const d = determinePA(
      DUPIXENT,
      adFacts({
        prescriberSpecialty: "Allergy and Immunology",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
          adSeverityCriteria: ["severity-sensitive-areas"],
          topicalTrialDocumented: true,
        },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(10);
  });
});
