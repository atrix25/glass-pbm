/**
 * Trial-of predicates must respect product form / route.
 *
 * Dupixent atopic dermatitis step 6 asks for a medium-to-high potency *topical*
 * corticosteroid or topical calcineurin inhibitor. Matching the ingredient
 * token alone treats nasal sprays and oral capsules as trials and Approves
 * specialty coverage the published form does not allow. Adalimumab conventional
 * therapy likewise must not count inhaled or nasal budesonide.
 */

import { describe, expect, it } from "vitest";
import { CRITERIA_TREES } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

const DUPIXENT = CRITERIA_TREES.find((t) => t.id === "pa-dupixent")!;
const ADALIMUMAB = CRITERIA_TREES.find((t) => t.id === "pa-adalimumab")!;

const dupixentFacts = (filledDrugNames: string[]): PAFacts => ({
  condition: "atopic-dermatitis-initial",
  answers: {
    quantityLimitBasis: ["maintenance-ad-asthma"],
    diagnosisProvided: true,
  },
  memberDiagnosisCodes: ["L20.9"],
  filledDrugNames,
});

const adalimumabFacts = (filledDrugNames: string[]): PAFacts => ({
  answers: {
    quantityLimitBasis: ["standard-2-inj-28-days"],
    preferredBiosimilarOrFailure: true,
  },
  memberDiagnosisCodes: ["L40.0"],
  filledDrugNames,
});

describe("Dupixent topical trial requires a topical form", () => {
  it("approves when claims show a topical corticosteroid", () => {
    const out = determinePA(
      DUPIXENT,
      dupixentFacts(["triamcinolone acetonide cream"]),
    );
    expect(out.outcome).toBe("Approved");
    expect(out.decidingStep).toBe(6);
  });

  it("denies when the only match is a nasal spray of the same ingredient", () => {
    const out = determinePA(
      DUPIXENT,
      dupixentFacts(["triamcinolone acetonide nasal spray"]),
    );
    expect(out.outcome).toBe("Denied");
    expect(out.decidingStep).toBe(6);
  });

  it("denies when the only match is oral tacrolimus", () => {
    const out = determinePA(DUPIXENT, dupixentFacts(["tacrolimus cap"]));
    expect(out.outcome).toBe("Denied");
    expect(out.decidingStep).toBe(6);
  });

  it("denies when the only match is mometasone nasal spray", () => {
    const out = determinePA(
      DUPIXENT,
      dupixentFacts(["mometasone furoate nasal spray"]),
    );
    expect(out.outcome).toBe("Denied");
    expect(out.decidingStep).toBe(6);
  });

  it("still accepts a topical calcineurin inhibitor ointment", () => {
    const out = determinePA(DUPIXENT, dupixentFacts(["tacrolimus ointment"]));
    expect(out.outcome).toBe("Approved");
    expect(out.decidingStep).toBe(6);
  });
});

describe("Adalimumab conventional therapy excludes inhaled budesonide", () => {
  it("approves on oral methotrexate", () => {
    const out = determinePA(ADALIMUMAB, adalimumabFacts(["methotrexate tab"]));
    expect(out.outcome).toBe("Approved");
    expect(out.decidingStep).toBe(5);
  });

  it("denies when the only budesonide fill is an inhaler", () => {
    const out = determinePA(
      ADALIMUMAB,
      adalimumabFacts(["budesonide inhalation aerosol"]),
    );
    expect(out.outcome).toBe("Denied");
    expect(out.decidingStep).toBe(5);
  });

  it("approves oral enteric budesonide used as conventional GI therapy", () => {
    const out = determinePA(
      ADALIMUMAB,
      adalimumabFacts(["budesonide delayed release capsule"]),
    );
    expect(out.outcome).toBe("Approved");
    expect(out.decidingStep).toBe(5);
  });
});
