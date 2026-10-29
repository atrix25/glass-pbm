/**
 * Adalimumab Crohn's (K50) / UC (K51) INITIAL requires Navitus steps 25–26 /
 * 31–34: gastroenterology → moderately to severely active disease (UC then
 * ages into weight). Tip collapsed IBD into the DMARD conventional-therapy
 * Approve (365d) with no activity gate, so Gastroenterology + mesalamine /
 * budesonide / attestation unlocked specialty POS for mild or undocumented
 * disease.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";
import { buildQuestionnaire, enabledItems } from "@/lib/pa/questionnaire";

const facts = (over: Partial<PAFacts> = {}): PAFacts => ({
  answers: {
    quantityLimitBasis: ["loading-dose"],
    preferredBiosimilarOrFailure: true,
    ...over.answers,
  },
  memberDiagnosisCodes: over.memberDiagnosisCodes ?? ["K50.90"],
  filledDrugNames: over.filledDrugNames ?? ["mesalamine"],
  prescriberSpecialty: over.prescriberSpecialty ?? "Gastroenterology",
  memberAgeYears: over.memberAgeYears,
  memberWeightKg: over.memberWeightKg,
  condition: over.condition,
});

describe("Adalimumab Crohn's / UC moderately–severely active gate", () => {
  it("denies K50 with Gastroenterology + mesalamine when activity is not documented", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        answers: { conventionalTherapyTrial: true },
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(26);
  });

  it("denies K50 when moderatelySeverelyActiveCd is omitted entirely", () => {
    const d = determinePA(ADALIMUMAB, facts());
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(26);
  });

  it("denies K50 when prescribed by Internal Medicine even with activity documented", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        prescriberSpecialty: "Internal Medicine",
        answers: { moderatelySeverelyActiveCd: true },
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(25);
  });

  it("approves K50 for one year after Gastroenterology + moderately–severely active CD", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        answers: { moderatelySeverelyActiveCd: true },
        filledDrugNames: [],
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(26);
    expect(d.approvedDays).toBe(365);
  });

  it("denies K51 with Gastroenterology + budesonide when activity is not documented", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["K51.90"],
        filledDrugNames: ["budesonide"],
        answers: { conventionalTherapyTrial: true },
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(32);
  });

  it("approves adult K51 for one year after Gastroenterology + moderately–severely active UC", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["K51.90"],
        memberAgeYears: 42,
        filledDrugNames: [],
        answers: { moderatelySeverelyActiveUc: true },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(33);
    expect(d.approvedDays).toBe(365);
  });

  it("approves pediatric K51 for one year when weight is provided", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["K51.90"],
        memberAgeYears: 14,
        answers: {
          moderatelySeverelyActiveUc: true,
          ucWeightProvided: true,
        },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(34);
    expect(d.approvedDays).toBe(365);
  });

  it("denies pediatric K51 when weight is not provided", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["K51.90"],
        memberAgeYears: 12,
        answers: { moderatelySeverelyActiveUc: true },
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(34);
  });

  it("still approves non-IBD diagnoses through the conventional-therapy gate", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["M05.9"],
        prescriberSpecialty: "Rheumatology",
        filledDrugNames: ["methotrexate tab"],
        answers: { conventionalTherapyTrial: true },
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(7);
    expect(d.approvedDays).toBe(365);
  });

  it("routes Crohn's selection to step 25 rather than conventional therapy", () => {
    const questionnaire = buildQuestionnaire(ADALIMUMAB);
    const determination = determinePA(
      ADALIMUMAB,
      facts({
        answers: { moderatelySeverelyActiveCd: true },
      }),
    );
    expect(determination.path.map((p) => p.step)).toEqual([1, 3, 4, 5, 25, 26]);

    const enabled = enabledItems(questionnaire, {
      "step-1": ["loading-dose"],
      "step-3": true,
      "step-4": true,
      "step-5": true,
      "step-25": "Gastroenterology",
      "step-26": true,
    });
    expect(enabled).toContain("step-25");
    expect(enabled).toContain("step-26");
    expect(enabled).not.toContain("step-7");
  });
});
