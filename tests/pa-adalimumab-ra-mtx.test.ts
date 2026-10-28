/**
 * Adalimumab RA (M05/M06) requires a conventional DMARD trial that included
 * methotrexate ≥20 mg/week for ≥8 weeks, then documented inadequate response
 * (Navitus form steps 8–13). Collapsing RA into the flat conventional-therapy
 * Approve let sulfasalazine / HCQ / LEF-only (or a generic attestation)
 * unlock specialty POS without the mandatory methotrexate half.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function raFacts(over: Partial<PAFacts> = {}): PAFacts {
  const { answers: answerOver, ...rest } = over;
  return {
    prescriberSpecialty: "Rheumatology",
    memberDiagnosisCodes: ["M05.9"],
    filledDrugNames: [],
    ...rest,
    answers: {
      quantityLimitBasis: ["standard-2-inj-28-days"],
      preferredBiosimilarOrFailure: true,
      ...answerOver,
    },
  };
}

describe("Adalimumab RA methotrexate + response gate", () => {
  it("denies RA when only sulfasalazine is on file", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({ filledDrugNames: ["sulfasalazine 500 mg"] }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(8);
  });

  it("denies RA when only hydroxychloroquine is on file", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({ filledDrugNames: ["hydroxychloroquine 200 mg"] }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(8);
  });

  it("denies RA when only leflunomide is on file", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({ filledDrugNames: ["leflunomide 20 mg"] }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(8);
  });

  it("denies when conventionalTherapyTrial is attested without methotrexate", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({
        answers: { conventionalTherapyTrial: true },
        filledDrugNames: [],
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(8);
  });

  it("denies methotrexate without a documented response criterion", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({ filledDrugNames: ["methotrexate 20 mg tablet"] }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(9);
  });

  it("denies when the prescriber is not Rheumatology", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({
        prescriberSpecialty: "Internal Medicine",
        filledDrugNames: ["methotrexate 20 mg tablet"],
        answers: { raResponseCriteria: ["no-response-3-months"] },
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(6);
  });

  it("approves RA with methotrexate fill and no-response criterion", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({
        filledDrugNames: ["methotrexate 20 mg tablet"],
        answers: { raResponseCriteria: ["no-response-3-months"] },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(9);
    expect(result.approvedDays).toBe(365);
  });

  it("approves RA with MTX attestation and not-at-goal criterion", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({
        answers: {
          raMethotrexateTrial: true,
          raResponseCriteria: ["not-at-goal-6-months"],
        },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(9);
    expect(result.approvedDays).toBe(365);
  });

  it("still Approves non-RA indications through the conventional-therapy gate", () => {
    const result = determinePA(
      ADALIMUMAB,
      raFacts({
        memberDiagnosisCodes: ["K50.90"],
        prescriberSpecialty: "Gastroenterology",
        filledDrugNames: ["mesalamine"],
        answers: {
          quantityLimitBasis: ["loading-dose"],
          preferredBiosimilarOrFailure: true,
        },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(70);
  });
});
