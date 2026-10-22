/**
 * Adalimumab continuing / reauthorization must not re-walk conventional therapy.
 *
 * The published Navitus ADALIMUMAB PRODUCTS form sends continuing CD/UC/PsO/HS
 * to dedicated improvement gates (steps 27–30 / 35–38 / 46–49 / 54–57). Re-using
 * the collapsed conventional-therapy Approve with historical DMARD fills
 * false-Approves non-responders and unlocks specialty fills at POS.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function facts(partial: Partial<PAFacts>): PAFacts {
  return {
    answers: {},
    memberDiagnosisCodes: ["K50.90"],
    memberAgeYears: 42,
    filledDrugNames: [],
    ...partial,
  };
}

const initialWithConventionalTherapy: PAFacts = facts({
  condition: "crohn-initial",
  prescriberSpecialty: "Gastroenterology",
  answers: {
    quantityLimitBasis: ["standard-2-inj-28-days"],
    preferredBiosimilarOrFailure: true,
    conventionalTherapyTrial: true,
  },
  filledDrugNames: ["methotrexate tab", "HUMIRA PEN"],
});

describe("Adalimumab continuing therapy criteria", () => {
  it("still Approves a true initial request with conventional therapy", () => {
    const d = determinePA(ADALIMUMAB, initialWithConventionalTherapy);
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(6);
    expect(d.approvedDays).toBe(365);
  });

  it("Denies continuing Crohn's therapy when significant improvement is absent", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        condition: "crohn-continuing",
        prescriberSpecialty: "Gastroenterology",
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
          significantImprovement: false,
          // Historical conventional therapy must not satisfy continuing criteria.
          conventionalTherapyTrial: true,
        },
        filledDrugNames: ["methotrexate tab", "HUMIRA PEN"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(29);
    expect(d.reason).toMatch(/significant improvement/i);
  });

  it("Denies continuing Crohn's therapy when improvement is not documented", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        condition: "crohn-continuing",
        prescriberSpecialty: "Gastroenterology",
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
          significantImprovement: true,
          improvementDocumented: false,
        },
        filledDrugNames: ["HUMIRA PEN"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(30);
  });

  it("Approves continuing Crohn's therapy for one year when improvement is documented", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        condition: "crohn-continuing",
        prescriberSpecialty: "Gastroenterology",
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
          significantImprovement: true,
          improvementDocumented: true,
        },
        filledDrugNames: ["HUMIRA PEN"],
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(30);
    expect(d.approvedDays).toBe(365);
    expect(d.path.map((p) => p.step)).toEqual([1, 3, 4, 5, 27, 28, 29, 30]);
  });

  it("Denies continuing plaque psoriasis without significant improvement", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        condition: "plaque-psoriasis-continuing",
        prescriberSpecialty: "Dermatology",
        memberDiagnosisCodes: ["L40.0"],
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
          significantImprovement: false,
          conventionalTherapyTrial: true,
        },
        filledDrugNames: ["methotrexate tab", "HUMIRA"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(48);
    expect(d.reason).toMatch(/significant improvement/i);
  });

  it("routes continuing Crohn's selection to step 27 rather than conventional therapy", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        condition: "crohn-continuing",
        // Wrong specialty so the traversal stops on the continuing path,
        // proving we did not fall through to conventional therapy at step 6.
        prescriberSpecialty: "Internal Medicine",
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
          conventionalTherapyTrial: true,
        },
        memberDiagnosisCodes: ["K50.90"],
        filledDrugNames: ["methotrexate tab"],
      }),
    );
    const conditionStep = d.path.find((p) => p.step === 5);
    expect(conditionStep?.nextStep).toBe(27);
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(27);
    expect(d.path.map((p) => p.step)).not.toContain(6);
  });

  it("still Denies untranscribed indications at step 5", () => {
    const d = determinePA(
      ADALIMUMAB,
      facts({
        condition: "ankylosing-spondylitis",
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
        },
        memberDiagnosisCodes: ["M45.9"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(5);
  });
});
