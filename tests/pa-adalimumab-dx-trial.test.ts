/**
 * Adalimumab step 5 requires conventional therapy *appropriate to the diagnosis*.
 * A flat OR-list across RA / IBD / psoriasis agents minted specialty Approves
 * when the only fill was the wrong class for the indication on file.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function facts(partial: Partial<PAFacts> & { memberDiagnosisCodes: string[] }): PAFacts {
  return {
    answers: {
      quantityLimitBasis: ["standard-2-inj-28-days"],
      preferredBiosimilarOrFailure: true,
      conventionalTherapyTrial: false,
      ...(partial.answers ?? {}),
    },
    memberDiagnosisCodes: partial.memberDiagnosisCodes,
    filledDrugNames: partial.filledDrugNames ?? [],
    condition: partial.condition,
    prescriberSpecialty: partial.prescriberSpecialty,
    memberAgeYears: partial.memberAgeYears,
    memberWeightKg: partial.memberWeightKg,
  };
}

describe("adalimumab conventional therapy is diagnosis-bound", () => {
  it("denies ulcerative colitis when the only trial fill is acitretin", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["K51.90"],
        filledDrugNames: ["acitretin capsule"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(5);
  });

  it("denies rheumatoid arthritis when the only trial fill is mesalamine", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["M05.9"],
        filledDrugNames: ["mesalamine DR"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(5);
  });

  it("denies the seed comorbidity path (K51+L20 with acitretin, attest false)", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["K51.90", "L20.9"],
        filledDrugNames: ["acitretin capsule"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(5);
  });

  it("approves RA when methotrexate is on file", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["M05.9"],
        filledDrugNames: ["methotrexate tab"],
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(5);
  });

  it("approves UC when mesalamine is on file", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["K51.90"],
        filledDrugNames: ["mesalamine DR"],
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(5);
  });

  it("approves psoriasis when acitretin is on file", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["L40.0"],
        filledDrugNames: ["acitretin capsule"],
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(5);
  });

  it("still accepts prescriber attestation with no matching fills", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["M05.9"],
        filledDrugNames: [],
        answers: { conventionalTherapyTrial: true },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(5);
  });
});
