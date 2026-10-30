/**
 * Adalimumab ankylosing spondylitis (M45) INITIAL requires Navitus steps 23–24:
 * rheumatology specialist, then predominant axial involvement → Approve lifetime.
 *
 * Tip collapsed M45 into the DMARD conventional-therapy Approve (365d) with no
 * axial gate, so MTX/attest alone unlocked specialty POS.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

const facts = (over: Partial<PAFacts> = {}): PAFacts => ({
  answers: {
    quantityLimitBasis: ["standard-2-inj-28-days"],
    preferredBiosimilarOrFailure: true,
    ...over.answers,
  },
  prescriberSpecialty: over.prescriberSpecialty ?? "Rheumatology",
  memberDiagnosisCodes: over.memberDiagnosisCodes ?? ["M45.9"],
  filledDrugNames: over.filledDrugNames ?? [],
  memberAgeYears: over.memberAgeYears ?? 41,
});

describe("adalimumab AS (M45) requires predominant axial involvement", () => {
  it("denies M45 with Rheumatology + MTX when axial involvement is not documented", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: { conventionalTherapyTrial: true },
        filledDrugNames: ["methotrexate tablet"],
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(24);
  });

  it("denies M45 when predominantAxialAs is omitted entirely", () => {
    const result = determinePA(ADALIMUMAB, facts());
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(24);
  });

  it("denies M45 when prescribed by Internal Medicine even with axial documentation", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: { predominantAxialAs: true },
        prescriberSpecialty: "Internal Medicine",
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(23);
  });

  it("denies M45 when predominantAxialAs is explicitly false", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: {
          predominantAxialAs: false,
          conventionalTherapyTrial: true,
        },
        filledDrugNames: ["sulfasalazine tablet"],
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(24);
  });

  it("approves M45 for 365 days after Rheumatology + predominant axial involvement", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: { predominantAxialAs: true },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(24);
    expect(result.approvedDays).toBe(365);
    // No conventional-therapy step on the axial path.
    expect(result.path.map((p) => p.step)).toEqual([1, 3, 4, 5, 23, 24]);
  });

  it("still approves non-AS indications through the conventional-therapy gate", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["M05.9"],
        answers: { conventionalTherapyTrial: true },
        filledDrugNames: [],
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
    expect(result.approvedDays).toBe(365);
  });
});
