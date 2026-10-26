/**
 * Adalimumab plaque psoriasis (L40) INITIAL requires Navitus steps 41–45:
 * dermatologist → BSA ≥10% + disability or palmoplantar → photo/MTX/acitretin
 * (or all contraindicated) → Approve 3 months.
 *
 * Tip collapsed L40 into the DMARD conventional-therapy Approve (365d) with no
 * severity gate, so Dermatology + methotrexate unlocked specialty POS for mild
 * disease.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "../src/lib/pa/criteria";
import { determinePA, type PAFacts } from "../src/lib/pa/engine";

function facts(
  over: Partial<PAFacts> & { answers?: Record<string, unknown> } = {},
): PAFacts {
  return {
    answers: {
      quantityLimitBasis: ["standard-2-inj-28-days"],
      preferredBiosimilarOrFailure: true,
      ...(over.answers ?? {}),
    },
    memberDiagnosisCodes: over.memberDiagnosisCodes ?? ["L40.0"],
    prescriberSpecialty: over.prescriberSpecialty ?? "Dermatology",
    filledDrugNames: over.filledDrugNames ?? ["methotrexate 15 mg tablet"],
    memberAgeYears: over.memberAgeYears ?? 42,
    condition: over.condition,
  };
}

describe("Adalimumab plaque psoriasis severity gate", () => {
  it("denies L40 with Dermatology + MTX when severity is not documented", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({ answers: { diagnosisCriteria: [] } }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(42);
  });

  it("denies L40 when diagnosisCriteria is omitted entirely", () => {
    const d = determinePA(ADALIMUMAB, facts());
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(42);
  });

  it("denies L40 when prescribed by Rheumatology even with severity + MTX", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        prescriberSpecialty: "Rheumatology",
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
        },
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(41);
  });

  it("approves L40 for 90 days after severity + methotrexate trial", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
        },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(43);
    expect(d.approvedDays).toBe(90);
  });

  it("approves L40 for 90 days on palmoplantar severity + phototherapy attestation", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        filledDrugNames: [],
        answers: {
          diagnosisCriteria: ["debilitating-palmoplantar-psoriasis"],
          phototherapyTrial: true,
        },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(43);
    expect(d.approvedDays).toBe(90);
  });

  it("approves L40 for 90 days via the all-contraindicated path", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        filledDrugNames: [],
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
          phototherapyTrial: false,
          allAlternativesContraindicated: true,
          contraindicationsListed: true,
        },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(45);
    expect(d.approvedDays).toBe(90);
  });

  it("still approves non-PsO indications on conventional therapy at 365 days", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["M05.9"],
        prescriberSpecialty: "Rheumatology",
        filledDrugNames: [],
        answers: { conventionalTherapyTrial: true },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(7);
    expect(d.approvedDays).toBe(365);
  });
});
