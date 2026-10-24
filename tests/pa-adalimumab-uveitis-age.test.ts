/**
 * Adalimumab uveitis (H20) is age-gated on the Navitus form: adult ≥18
 * (step 60) or pediatric 2–17 (step 66). Encoding diagnosis + conventional
 * therapy alone let members under two (and unknown age) Approve and unlock
 * specialty POS.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function uveitisFacts(ageYears: number | undefined): PAFacts {
  return {
    answers: {
      quantityLimitBasis: ["standard-2-inj-28-days"],
      preferredBiosimilarOrFailure: true,
    },
    prescriberSpecialty: "Ophthalmology",
    memberDiagnosisCodes: ["H20.9"],
    memberAgeYears: ageYears,
    filledDrugNames: ["methotrexate tab"],
  };
}

describe("Adalimumab uveitis age gate", () => {
  it("denies a one-year-old with H20 even with ophthalmology and methotrexate", () => {
    const result = determinePA(ADALIMUMAB, uveitisFacts(1));
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(7);
  });

  it("denies age zero", () => {
    const result = determinePA(ADALIMUMAB, uveitisFacts(0));
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(7);
  });

  it("denies when age is unknown", () => {
    const result = determinePA(ADALIMUMAB, uveitisFacts(undefined));
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(7);
  });

  it("approves pediatric uveitis at age 2 with conventional therapy", () => {
    const result = determinePA(ADALIMUMAB, uveitisFacts(2));
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(7);
    expect(result.approvedDays).toBe(365);
  });

  it("approves adult uveitis at age 18 with conventional therapy", () => {
    const result = determinePA(ADALIMUMAB, uveitisFacts(18));
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(7);
    expect(result.approvedDays).toBe(365);
  });

  it("still approves non-uveitis indications without the age step", () => {
    const result = determinePA(ADALIMUMAB, {
      answers: {
        quantityLimitBasis: ["standard-2-inj-28-days"],
        preferredBiosimilarOrFailure: true,
      },
      prescriberSpecialty: "Rheumatology",
      memberDiagnosisCodes: ["M05.9"],
      memberAgeYears: 1,
      filledDrugNames: ["methotrexate tab"],
    });
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
    expect(result.approvedDays).toBe(365);
  });
});
