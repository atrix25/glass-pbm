/**
 * Adalimumab form step 3 only continues for preferred biosimilars
 * (AATY/ADAZ/FKJP/RYVK). "None of the above" Denies. Tip used to Approve
 * Humira/Abrilada on a free-text preferredBiosimilarOrFailure attestation
 * that the published form does not offer.
 */

import { describe, expect, it } from "vitest";
import {
  ADALIMUMAB,
  findTreeForDrug,
  preferredAdalimumabProduct,
} from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

const facts = (over: Partial<PAFacts> = {}): PAFacts => ({
  answers: {
    quantityLimitBasis: ["standard-2-inj-28-days"],
    ...over.answers,
  },
  prescriberSpecialty: over.prescriberSpecialty ?? "Dermatology",
  memberDiagnosisCodes: over.memberDiagnosisCodes ?? ["L40.0"],
  filledDrugNames: over.filledDrugNames ?? ["methotrexate 2.5 mg tablet"],
  memberAgeYears: over.memberAgeYears ?? 44,
});

describe("adalimumab preferred-product gate (form step 3)", () => {
  it("maps preferred brands and suffixes to form product codes", () => {
    expect(preferredAdalimumabProduct("YUFLYMA")).toBe("adalimumab-aaty");
    expect(preferredAdalimumabProduct("ADALIMUMAB-ADAZ")).toBe(
      "adalimumab-adaz",
    );
    expect(preferredAdalimumabProduct("Hulio pen")).toBe("adalimumab-fkjp");
    expect(preferredAdalimumabProduct("SIMLANDI")).toBe("adalimumab-ryvk");
    expect(preferredAdalimumabProduct("HUMIRA")).toBeUndefined();
    expect(preferredAdalimumabProduct("ABRILADA")).toBeUndefined();
    expect(preferredAdalimumabProduct("ADALIMUMAB")).toBeUndefined();
  });

  it("routes SIMLANDI onto the adalimumab tree", () => {
    expect(findTreeForDrug("SIMLANDI")?.id).toBe("pa-adalimumab");
  });

  it("denies Humira-shaped requests even when preferredBiosimilarOrFailure is attested", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: {
          // Legacy attest field must not unlock specialty POS.
          preferredBiosimilarOrFailure: true,
          requestedAdalimumabProduct: [],
          conventionalTherapyTrial: true,
        },
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(4);
    expect(result.reason).toMatch(/preferred adalimumab biosimilar/i);
  });

  it("denies Abrilada when no preferred product code is selected", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: {
          preferredBiosimilarOrFailure: true,
          conventionalTherapyTrial: true,
        },
        memberDiagnosisCodes: ["M05.9"],
        prescriberSpecialty: "Rheumatology",
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(4);
  });

  it("approves a preferred biosimilar after diagnosis and conventional therapy", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: {
          requestedAdalimumabProduct: ["adalimumab-adaz"],
          conventionalTherapyTrial: true,
        },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(5);
    expect(result.approvedDays).toBe(365);
    expect(result.path.map((p) => p.step)).toEqual([1, 3, 4, 5]);
  });

  it("approves each preferred product code through the product gate", () => {
    for (const code of [
      "adalimumab-aaty",
      "adalimumab-adaz",
      "adalimumab-fkjp",
      "adalimumab-ryvk",
    ]) {
      const result = determinePA(
        ADALIMUMAB,
        facts({
          answers: {
            requestedAdalimumabProduct: [code],
          },
          filledDrugNames: ["methotrexate tablet"],
        }),
      );
      expect(result.outcome, code).toBe("Approved");
      expect(result.decidingStep, code).toBe(5);
    }
  });
});
