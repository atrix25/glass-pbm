/**
 * Dupixent atopic-dermatitis step 5 binds age and diagnosis in one question.
 * Encoding only the diagnosis let infants clear the step and unlock specialty.
 */

import { describe, expect, it } from "vitest";
import { DUPIXENT } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function atopicFacts(ageYears: number | undefined): PAFacts {
  return {
    condition: "atopic-dermatitis-initial",
    answers: {
      quantityLimitBasis: ["maintenance-ad-asthma"],
      diagnosisProvided: true,
      topicalTrialDocumented: true,
    },
    prescriberSpecialty: "Dermatology",
    memberDiagnosisCodes: ["L20"],
    memberAgeYears: ageYears,
    filledDrugNames: [],
  };
}

describe("Dupixent atopic dermatitis initial therapy age gate", () => {
  it("denies a member under six months even with L20 on file", () => {
    // Seed member mbr-W100004949-04 class: DOB mid-2025-08 → ~0.39y at 2026-01-01.
    const result = determinePA(DUPIXENT, atopicFacts(0.3915));
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(5);
  });

  it("denies when age is floored away to zero", () => {
    const result = determinePA(DUPIXENT, atopicFacts(0));
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(5);
  });

  it("denies when age is unknown", () => {
    const result = determinePA(DUPIXENT, atopicFacts(undefined));
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(5);
  });

  it("approves at exactly six months with L20 and a documented topical trial", () => {
    const result = determinePA(DUPIXENT, atopicFacts(0.5));
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
    expect(result.approvedDays).toBe(365);
  });

  it("still denies without L20 once age clears", () => {
    const result = determinePA(DUPIXENT, {
      ...atopicFacts(2),
      memberDiagnosisCodes: ["J45"],
    });
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(5);
  });
});
