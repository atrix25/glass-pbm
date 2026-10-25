/**
 * Adalimumab hidradenitis (L73) INITIAL requires an oral antibiotic failure
 * on the Navitus form (steps 52–53, Approve 3 months). The collapsed tree
 * Approved on methotrexate / conventionalTherapyTrial instead and unlocked
 * specialty POS.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function hsFacts(over: Partial<PAFacts> & { answers?: Record<string, unknown> } = {}): PAFacts {
  return {
    answers: {
      quantityLimitBasis: ["hs-weekly"],
      preferredBiosimilarOrFailure: true,
      conventionalTherapyTrial: false,
      ...(over.answers ?? {}),
    },
    prescriberSpecialty: over.prescriberSpecialty ?? "Dermatology",
    memberDiagnosisCodes: over.memberDiagnosisCodes ?? ["L73.2"],
    memberAgeYears: over.memberAgeYears ?? 34,
    filledDrugNames: over.filledDrugNames ?? [],
  };
}

describe("Adalimumab hidradenitis oral antibiotic gate", () => {
  it("denies HS with methotrexate and no oral antibiotic", () => {
    const result = determinePA(
      ADALIMUMAB,
      hsFacts({ filledDrugNames: ["methotrexate 2.5 mg tablet"] }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(6);
  });

  it("denies HS when conventionalTherapyTrial is attested without an antibiotic", () => {
    const result = determinePA(
      ADALIMUMAB,
      hsFacts({
        filledDrugNames: [],
        answers: { conventionalTherapyTrial: true },
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(6);
  });

  it("approves HS for 90 days after a documented doxycycline trial", () => {
    const result = determinePA(
      ADALIMUMAB,
      hsFacts({ filledDrugNames: ["doxycycline hyclate 100 mg"] }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
    expect(result.approvedDays).toBe(90);
  });

  it("approves HS for 90 days when oralAntibioticTrial is attested", () => {
    const result = determinePA(
      ADALIMUMAB,
      hsFacts({
        filledDrugNames: [],
        answers: { oralAntibioticTrial: true },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
    expect(result.approvedDays).toBe(90);
  });

  it("still approves non-HS indications on conventional therapy at 365 days", () => {
    const result = determinePA(
      ADALIMUMAB,
      hsFacts({
        memberDiagnosisCodes: ["M05.9"],
        filledDrugNames: ["methotrexate tab"],
        answers: { quantityLimitBasis: ["standard-2-inj-28-days"] },
        prescriberSpecialty: "Rheumatology",
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(7);
    expect(result.approvedDays).toBe(365);
  });
});
