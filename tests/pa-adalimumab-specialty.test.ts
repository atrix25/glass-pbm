/**
 * Adalimumab specialty gate.
 *
 * The published form requires rheumatology / dermatology / gastroenterology /
 * ophthalmology by indication before any conventional-therapy question. The
 * collapsed tree used to skip that gate entirely, so Internal Medicine plus a
 * methotrexate fill produced a 365-day Approve and unlocked specialty POS.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

const base = (over: Partial<PAFacts> = {}): PAFacts => ({
  answers: {
    quantityLimitBasis: ["standard-2-inj-28-days"],
    preferredBiosimilarOrFailure: true,
  },
  memberDiagnosisCodes: ["M05.9"],
  filledDrugNames: ["methotrexate 20 mg tablet"],
  ...over,
});

describe("adalimumab specialtyForDiagnosis", () => {
  it("Denies rheumatoid arthritis when the prescriber is Internal Medicine", () => {
    const result = determinePA(
      ADALIMUMAB,
      base({ prescriberSpecialty: "Internal Medicine" }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(4);
  });

  it("Denies when specialty is missing even with an appropriate trial", () => {
    const result = determinePA(ADALIMUMAB, base());
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(4);
  });

  it("Approves RA when Rheumatology and methotrexate are on file", () => {
    const result = determinePA(
      ADALIMUMAB,
      base({ prescriberSpecialty: "Rheumatology" }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
    expect(result.approvedDays).toBe(365);
  });

  it("Denies plaque psoriasis prescribed by Rheumatology", () => {
    const result = determinePA(
      ADALIMUMAB,
      base({
        prescriberSpecialty: "Rheumatology",
        memberDiagnosisCodes: ["L40.0"],
        filledDrugNames: ["acitretin"],
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(4);
  });

  it("Approves plaque psoriasis when Dermatology and acitretin are on file", () => {
    const result = determinePA(
      ADALIMUMAB,
      base({
        prescriberSpecialty: "Dermatology",
        memberDiagnosisCodes: ["L40.0"],
        filledDrugNames: ["acitretin"],
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
  });

  it("Approves Crohn's disease when Gastroenterology attests conventional therapy", () => {
    const result = determinePA(
      ADALIMUMAB,
      base({
        answers: {
          quantityLimitBasis: ["loading-dose"],
          preferredBiosimilarOrFailure: true,
          conventionalTherapyTrial: true,
        },
        prescriberSpecialty: "Gastroenterology",
        memberDiagnosisCodes: ["K50.90"],
        filledDrugNames: [],
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
  });

  it("Approves uveitis when Ophthalmology is on the request", () => {
    const result = determinePA(
      ADALIMUMAB,
      base({
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
          conventionalTherapyTrial: true,
        },
        prescriberSpecialty: "Ophthalmology",
        memberDiagnosisCodes: ["H20.9"],
        filledDrugNames: [],
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
  });
});
