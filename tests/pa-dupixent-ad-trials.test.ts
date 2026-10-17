/**
 * Dupixent AD initial therapy must require two distinct trial classes and
 * refuse combination immunomodulator use, matching the published Navitus form.
 */

import { describe, expect, it } from "vitest";
import { CRITERIA_TREES } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

const DUPIXENT = CRITERIA_TREES.find((t) => t.id === "pa-dupixent")!;

function baseFacts(over: Partial<PAFacts> = {}): PAFacts {
  const { answers: answerOver, ...rest } = over;
  return {
    condition: "atopic-dermatitis-initial",
    memberDiagnosisCodes: ["L20.9"],
    memberAgeYears: 34,
    filledDrugNames: [],
    ...rest,
    answers: {
      quantityLimitBasis: ["maintenance-ad-asthma"],
      diagnosisProvided: true,
      combinationImmunomodulator: false,
      ...answerOver,
    },
  };
}

describe("Dupixent AD initial two-trial requirement", () => {
  it("refuses a single topical steroid trial that used to unlock a year of coverage", () => {
    const determination = determinePA(
      DUPIXENT,
      baseFacts({ filledDrugNames: ["triamcinolone cream"] }),
    );
    expect(determination.outcome).toBe("Denied");
    expect(determination.decidingStep).toBe(8);
  });

  it("refuses two fills that are the same therapy class", () => {
    const determination = determinePA(
      DUPIXENT,
      baseFacts({
        filledDrugNames: ["triamcinolone cream", "clobetasol ointment"],
      }),
    );
    expect(determination.outcome).toBe("Denied");
    expect(determination.decidingStep).toBe(8);
  });

  it("approves for four months when two distinct classes are on file", () => {
    const determination = determinePA(
      DUPIXENT,
      baseFacts({
        filledDrugNames: ["triamcinolone cream", "tacrolimus ointment"],
      }),
    );
    expect(determination.outcome).toBe("Approved");
    expect(determination.decidingStep).toBe(7);
    expect(determination.approvedDays).toBe(122);
  });

  it("approves when the prescriber documents two trial classes without claims", () => {
    const determination = determinePA(
      DUPIXENT,
      baseFacts({
        answers: { twoAdTrialsDocumented: true },
        filledDrugNames: [],
      }),
    );
    expect(determination.outcome).toBe("Approved");
    expect(determination.approvedDays).toBe(122);
  });

  it("denies combination use with another targeted immunomodulator", () => {
    const determination = determinePA(
      DUPIXENT,
      baseFacts({
        filledDrugNames: ["methotrexate tab", "tacrolimus ointment"],
        answers: { combinationImmunomodulator: true },
      }),
    );
    expect(determination.outcome).toBe("Denied");
    expect(determination.decidingStep).toBe(7);
  });

  it("approves via contraindication of all listed trials", () => {
    const determination = determinePA(
      DUPIXENT,
      baseFacts({
        filledDrugNames: [],
        answers: {
          twoAdTrialsDocumented: false,
          allAdTrialsContraindicated: true,
          combinationImmunomodulator: false,
        },
      }),
    );
    expect(determination.outcome).toBe("Approved");
    expect(determination.approvedDays).toBe(122);
  });
});
