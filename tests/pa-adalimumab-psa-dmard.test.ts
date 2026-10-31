/**
 * Adalimumab psoriatic arthritis (L40.5x) INITIAL requires Navitus steps 18–22:
 * rheumatology → PsA-group diagnosis → methotrexate or sulfasalazine (or dual
 * contraindication) → Approve lifetime.
 *
 * Tip prefix-matched L40.5x as bare L40 and collapsed into the conventional
 * OR-list Approve (365d), so acitretin / LEF / HCQ / flat attest unlocked
 * specialty POS without a PsA DMARD trial.
 */

import { describe, expect, it } from "vitest";
import { ADALIMUMAB } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";

const facts = (over: Partial<PAFacts> = {}): PAFacts => ({
  answers: {
    quantityLimitBasis: ["standard-2-inj-28-days"],
    preferredBiosimilarOrFailure: true,
    ...over.answers,
  },
  prescriberSpecialty: over.prescriberSpecialty ?? "Rheumatology",
  memberDiagnosisCodes: over.memberDiagnosisCodes ?? ["L40.51"],
  filledDrugNames: over.filledDrugNames ?? [],
  memberAgeYears: over.memberAgeYears ?? 44,
});

describe("adalimumab PsA (L40.5) requires methotrexate or sulfasalazine", () => {
  it("denies L40.51 with Rheumatology + acitretin when PsA DMARD trial is absent", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: {
          psaGroupDiagnosis: ["psoriatic-arthritis"],
          conventionalTherapyTrial: true,
        },
        filledDrugNames: ["acitretin capsule"],
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(21);
  });

  it("denies L40.51 with leflunomide / hydroxychloroquine alone", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: { psaGroupDiagnosis: ["psoriatic-arthritis"] },
        filledDrugNames: ["leflunomide tablet", "hydroxychloroquine tablet"],
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(21);
  });

  it("denies L40.51 when psaGroupDiagnosis is omitted", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        filledDrugNames: ["methotrexate tablet"],
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(19);
  });

  it("denies L40.51 when prescribed by Dermatology even with MTX", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: { psaGroupDiagnosis: ["psoriatic-arthritis"] },
        filledDrugNames: ["methotrexate tablet"],
        prescriberSpecialty: "Dermatology",
      }),
    );
    expect(result.outcome).toBe("Denied");
    expect(result.decidingStep).toBe(18);
  });

  it("approves L40.51 for 365 days after Rheumatology + PsA + methotrexate", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: { psaGroupDiagnosis: ["psoriatic-arthritis"] },
        filledDrugNames: ["methotrexate tablet"],
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(20);
    expect(result.approvedDays).toBe(365);
    expect(result.path.map((p) => p.step)).toEqual([1, 3, 4, 5, 18, 19, 20]);
  });

  it("approves L40.51 for 365 days on sulfasalazine trial attestation", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: {
          psaGroupDiagnosis: ["psoriatic-arthritis"],
          psaDmardTrial: true,
        },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(20);
    expect(result.approvedDays).toBe(365);
  });

  it("approves L40.51 via dual MTX/SSZ contraindication listing", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        answers: {
          psaGroupDiagnosis: ["psoriatic-arthritis"],
          psaBothDmardsContraindicated: true,
          psaContraindicationsListed: true,
        },
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(22);
    expect(result.approvedDays).toBe(365);
  });

  it("still approves non-PsA L40 through the conventional-therapy gate", () => {
    const result = determinePA(
      ADALIMUMAB,
      facts({
        memberDiagnosisCodes: ["L40.0"],
        answers: { conventionalTherapyTrial: true },
        filledDrugNames: ["acitretin capsule"],
      }),
    );
    expect(result.outcome).toBe("Approved");
    expect(result.decidingStep).toBe(6);
    expect(result.approvedDays).toBe(365);
  });
});
