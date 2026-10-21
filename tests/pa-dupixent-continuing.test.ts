/**
 * Dupixent continuing / reauthorization must not re-walk initial trial criteria.
 *
 * The published Navitus DUPIXENT form sends continuing atopic dermatitis to
 * steps 13–15 (baseline AD diagnosis, positive clinical response, no combo
 * immunomodulator → Approve 1 year). Re-using the initial path with historical
 * topical fills false-Approves non-responders and unlocks specialty fills at POS.
 */

import { describe, expect, it } from "vitest";
import { DUPIXENT } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function facts(partial: Partial<PAFacts>): PAFacts {
  return {
    answers: {},
    memberDiagnosisCodes: ["L20.9"],
    memberAgeYears: 34,
    filledDrugNames: [],
    ...partial,
  };
}

const renewalMislabeledAsInitial: PAFacts = facts({
  condition: "atopic-dermatitis-initial",
  answers: {
    quantityLimitBasis: ["maintenance-ad-asthma"],
    diagnosisProvided: true,
    topicalTrialDocumented: true,
  },
  filledDrugNames: ["triamcinolone cream", "tacrolimus ointment"],
});

describe("Dupixent continuing therapy criteria", () => {
  it("still Approves a true initial request with a documented topical trial", () => {
    const d = determinePA(DUPIXENT, renewalMislabeledAsInitial);
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(6);
    expect(d.approvedDays).toBe(365);
  });

  it("Denies continuing therapy when a positive clinical response is absent", () => {
    const d = determinePA(
      DUPIXENT,
      facts({
        condition: "atopic-dermatitis-continuing",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
          positiveClinicalResponse: false,
        },
        // Historical topical fills must not satisfy continuing criteria.
        filledDrugNames: ["triamcinolone cream", "DUPIXENT"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(14);
    expect(d.reason).toMatch(/positive clinical response/i);
  });

  it("Denies continuing therapy when combination immunomodulator is planned", () => {
    const d = determinePA(
      DUPIXENT,
      facts({
        condition: "atopic-dermatitis-continuing",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
          positiveClinicalResponse: true,
          combinationImmunomodulator: true,
        },
        filledDrugNames: ["DUPIXENT"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(15);
  });

  it("Approves continuing therapy for one year when response is documented", () => {
    const d = determinePA(
      DUPIXENT,
      facts({
        condition: "atopic-dermatitis-continuing",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
          positiveClinicalResponse: true,
          combinationImmunomodulator: false,
        },
        filledDrugNames: ["DUPIXENT"],
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(15);
    expect(d.approvedDays).toBe(365);
    expect(d.path.map((p) => p.step)).toEqual([1, 3, 4, 13, 14, 15]);
  });

  it("routes continuing selection to step 13 rather than denying at step 4", () => {
    const d = determinePA(
      DUPIXENT,
      facts({
        condition: "atopic-dermatitis-continuing",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
        },
        memberDiagnosisCodes: [],
      }),
    );
    const conditionStep = d.path.find((p) => p.step === 4);
    expect(conditionStep?.nextStep).toBe(13);
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(13);
  });

  it("still Denies untranscribed indications at step 4", () => {
    const d = determinePA(
      DUPIXENT,
      facts({
        condition: "asthma-initial",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
        },
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(4);
  });
});
