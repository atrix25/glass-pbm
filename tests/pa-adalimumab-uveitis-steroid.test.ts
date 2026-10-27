/**
 * Adalimumab uveitis (H20) requires corticosteroids in combination with an
 * immunosuppressant on the Navitus form (adult steps 61–63; pediatric step 67,
 * with a severe sight-threatening alternative). Collapsing H20 into the
 * conventional-therapy Approve let an MTX-only (or attestation-only) request
 * unlock specialty POS without that combination.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function uveitisFacts(over: Partial<PAFacts> = {}): PAFacts {
  const { answers: answerOver, ...rest } = over;
  return {
    prescriberSpecialty: "Ophthalmology",
    memberDiagnosisCodes: ["H20.9"],
    memberAgeYears: 40,
    filledDrugNames: ["methotrexate tab 20 mg"],
    ...rest,
    answers: {
      quantityLimitBasis: ["standard-2-inj-28-days"],
      preferredBiosimilarOrFailure: true,
      conventionalTherapyTrial: true,
      ...answerOver,
    },
  };
}

describe("Adalimumab uveitis corticosteroid + immunosuppressant gate", () => {
  it("denies adult uveitis with methotrexate alone", () => {
    const result = determinePA(ADALIMUMAB, uveitisFacts());
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(9);
  });

  it("denies when conventional therapy is only attested, with no steroid fill", () => {
    const result = determinePA(
      ADALIMUMAB,
      uveitisFacts({ filledDrugNames: [] }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(9);
  });

  it("denies prednisone alone without an immunosuppressant", () => {
    const result = determinePA(
      ADALIMUMAB,
      uveitisFacts({
        // Step 5 still needs a conventional / immunosuppressant proxy.
        filledDrugNames: ["prednisone 10 mg tablet", "mesalamine"],
        answers: {
          conventionalTherapyTrial: false,
        },
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(8);
  });

  it("approves when claims show prednisone plus methotrexate", () => {
    const result = determinePA(
      ADALIMUMAB,
      uveitisFacts({
        filledDrugNames: ["methotrexate tab 20 mg", "prednisone 10 mg tablet"],
        answers: { conventionalTherapyTrial: false },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(8);
    expect(result.approvedDays).toBe(365);
  });

  it("approves when the prescriber attests to the steroid + immunosuppressant combination", () => {
    const result = determinePA(
      ADALIMUMAB,
      uveitisFacts({
        filledDrugNames: [],
        answers: { uveitisSteroidImmunosuppressantCombo: true },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(8);
  });

  it("approves pediatric severe sight-threatening uveitis without the combo fills", () => {
    const result = determinePA(
      ADALIMUMAB,
      uveitisFacts({
        memberAgeYears: 10,
        filledDrugNames: ["methotrexate tab"],
        answers: {
          conventionalTherapyTrial: true,
          uveitisSevereSightThreatening: true,
        },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(9);
  });

  it("still approves non-uveitis indications without the steroid steps", () => {
    const result = determinePA(
      ADALIMUMAB,
      uveitisFacts({
        memberDiagnosisCodes: ["M05.9"],
        prescriberSpecialty: "Rheumatology",
        filledDrugNames: ["methotrexate tab"],
        answers: { conventionalTherapyTrial: true },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
    expect(result.path.map((p) => p.step)).toEqual([1, 3, 4, 5, 6]);
  });
});
