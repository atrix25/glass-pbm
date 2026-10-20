/**
 * Skyrizi continuing / reauthorization must not re-walk initial trial criteria.
 *
 * The published Navitus SKYRIZI SC form sends continuing plaque psoriasis to
 * steps 10–13 (dermatologist, diagnosis, significant improvement, documentation
 * → Approve 1 year). Re-using the initial path with historical methotrexate
 * false-Approves non-responders and unlocks specialty fills at POS.
 */

import { describe, expect, it } from "vitest";
import { SKYRIZI_SC } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

function facts(partial: Partial<PAFacts>): PAFacts {
  return {
    answers: {},
    memberDiagnosisCodes: ["L40.0"],
    filledDrugNames: [],
    ...partial,
  };
}

const renewalMislabeledAsInitial: PAFacts = facts({
  condition: "plaque-psoriasis-initial",
  prescriberSpecialty: "Dermatology",
  answers: { diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"] },
  filledDrugNames: ["methotrexate tab"],
});

describe("Skyrizi continuing therapy criteria", () => {
  it("still Approves a true initial request with a documented trial", () => {
    const d = determinePA(SKYRIZI_SC, renewalMislabeledAsInitial);
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(7);
    expect(d.approvedDays).toBe(122);
  });

  it("Denies continuing therapy when significant improvement is absent", () => {
    const d = determinePA(
      SKYRIZI_SC,
      facts({
        condition: "plaque-psoriasis-continuing",
        prescriberSpecialty: "Dermatology",
        answers: {
          continuingDiagnosis: ["plaque-psoriasis"],
          significantImprovement: false,
        },
        // Historical MTX must not satisfy continuing criteria.
        filledDrugNames: ["methotrexate tab", "SKYRIZI"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(12);
    expect(d.reason).toMatch(/significant improvement/i);
  });

  it("Denies continuing therapy when improvement is not documented", () => {
    const d = determinePA(
      SKYRIZI_SC,
      facts({
        condition: "plaque-psoriasis-continuing",
        prescriberSpecialty: "Dermatology",
        answers: {
          continuingDiagnosis: ["plaque-psoriasis"],
          significantImprovement: true,
          improvementDocumented: false,
        },
        filledDrugNames: ["SKYRIZI"],
      }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(13);
  });

  it("Approves continuing therapy for one year when improvement is documented", () => {
    const d = determinePA(
      SKYRIZI_SC,
      facts({
        condition: "plaque-psoriasis-continuing",
        prescriberSpecialty: "Dermatology",
        answers: {
          continuingDiagnosis: ["plaque-psoriasis"],
          significantImprovement: true,
          improvementDocumented: true,
        },
        filledDrugNames: ["SKYRIZI"],
      }),
    );
    expect(d.outcome).toBe("Approved");
    expect(d.decidingStep).toBe(13);
    expect(d.approvedDays).toBe(365);
    expect(d.path.map((p) => p.step)).toEqual([4, 10, 11, 12, 13]);
  });

  it("routes continuing selection to step 10 rather than denying at step 4", () => {
    const d = determinePA(
      SKYRIZI_SC,
      facts({
        condition: "plaque-psoriasis-continuing",
        prescriberSpecialty: "Internal Medicine",
        answers: {},
      }),
    );
    expect(d.path[0]?.step).toBe(4);
    expect(d.path[0]?.nextStep).toBe(10);
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(10);
  });

  it("still Denies untranscribed indications at step 4", () => {
    const d = determinePA(
      SKYRIZI_SC,
      facts({ condition: "psoriatic-arthritis" }),
    );
    expect(d.outcome).toBe("Denied");
    expect(d.decidingStep).toBe(4);
  });
});
