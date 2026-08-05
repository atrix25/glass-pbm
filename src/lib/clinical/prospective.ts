/**
 * Prospective drug utilization review, at the counter.
 *
 * Retrospective DUR finds conflicts after the fact and mails somebody a
 * letter. Prospective DUR happens in the second between the pharmacy pressing
 * enter and the response coming back, which is the only moment when the
 * outcome can still change. It is the same rule table either way; what differs
 * is that this one has to answer inside the transaction and has to say
 * something the pharmacist can act on without picking up the phone.
 *
 * The response is an NCPDP DUR/PPS segment, which is a real and specific
 * thing. Every field below is a numbered element of Telecommunication D.0, and
 * the reason a pharmacy system can display this without being told how is that
 * the codes mean the same thing everywhere:
 *
 *   439-E4  Reason for Service Code      what kind of conflict
 *   528-FS  Clinical Significance Code   how bad
 *   529-FT  Other Pharmacy Indicator     whether another pharmacy is involved
 *   530-FU  Previous Date of Fill        when the conflicting fill happened
 *   531-FV  Quantity of Previous Fill
 *   532-FW  Database Indicator           whose clinical data said so
 *   533-FX  Other Prescriber Indicator   whether another prescriber wrote it
 *   544-FY  DUR Free Text Message        the sentence the pharmacist reads
 *
 * A conflict does not by itself reject the claim. Under D.0 the processor
 * returns the conflict and the pharmacy either dispenses or intervenes, and
 * for a major interaction most systems require the pharmacist to transmit a
 * professional service code back before the claim will pay. That distinction
 * between advising and refusing is the whole design of the segment, and it is
 * preserved here: nothing on this path changes the money.
 */

import {
  INTERACTION_RULES,
  matchesDrug,
  type InteractionRule,
} from "./interactions";
import { dailyMme, MME_THRESHOLDS, mmeBand } from "./opioids";

/** A fill the member is already on, still inside its days supply. */
export interface ConcurrentFill {
  claimNumber: string;
  drugId: string;
  /** Named `name` so the shared drug matcher can read it directly. */
  name: string;
  molecule: string | null;
  therapeuticClass: string | null;
  dateOfService: Date;
  daysSupply: number;
  quantityDispensed: number;
  prescriberNpi: string | null;
  pharmacyId: string;
  /** Daily morphine equivalents, where the product converts. */
  dailyMme: number | null;
}

/** The fill being submitted. */
export interface CandidateFill {
  drugId: string;
  name: string;
  molecule: string | null;
  therapeuticClass: string | null;
  dateOfService: Date;
  daysSupply: number;
  quantityDispensed: number;
  prescriberNpi: string | null;
  pharmacyId: string;
  dailyMme: number | null;
}

export interface DurConflict {
  /** 439-E4 */
  reasonForServiceCode: "DD" | "TD" | "HD" | "ER";
  reasonLabel: string;
  /** 528-FS: 1 major, 2 moderate, 3 minor. */
  clinicalSignificanceCode: "1" | "2" | "3";
  severity: "Major" | "Moderate" | "Minor";
  /** 529-FT */
  otherPharmacyIndicator: "0" | "1" | "2" | "3";
  otherPharmacyLabel: string;
  /** 530-FU */
  previousDateOfFill: string | null;
  /** 531-FV */
  quantityOfPreviousFill: number | null;
  /** 532-FW */
  databaseIndicator: "1" | "2" | "3";
  databaseLabel: string;
  /** 533-FX */
  otherPrescriberIndicator: "0" | "1" | "2";
  otherPrescriberLabel: string;
  /** 544-FY */
  freeText: string;
  /** The conflicting therapy, for display. */
  conflictingDrug: string | null;
  conflictingClaimNumber: string | null;
  /** The published basis, so the pharmacist can check it. */
  citation: string;
  /**
   * True when D.0 practice is for the pharmacy to intervene and transmit a
   * professional service code before the claim will pay.
   */
  requiresIntervention: boolean;
}

/**
 * 529-FT. "Your pharmacy" and "other pharmacy" are different situations: a
 * conflict inside one pharmacy's own records is one the dispensing system
 * would already have caught, and the ones worth transmitting are the ones only
 * the processor can see because it holds every pharmacy's claims.
 */
function otherPharmacy(candidate: CandidateFill, prior: ConcurrentFill) {
  const other = prior.pharmacyId !== candidate.pharmacyId;
  return {
    otherPharmacyIndicator: (other ? "3" : "1") as "1" | "3",
    otherPharmacyLabel: other
      ? "Other pharmacy dispensed the conflicting therapy"
      : "Same pharmacy",
  };
}

/**
 * 533-FX. The zero value is "not specified", which is the honest answer when
 * the request did not carry a prescriber: claiming "same prescriber" because
 * a field was blank is how a segment stops being worth reading.
 */
function otherPrescriber(candidate: CandidateFill, prior: ConcurrentFill) {
  if (!candidate.prescriberNpi || !prior.prescriberNpi) {
    return {
      otherPrescriberIndicator: "0" as const,
      otherPrescriberLabel: "Prescriber not specified on the request",
    };
  }
  const other = prior.prescriberNpi !== candidate.prescriberNpi;
  return {
    otherPrescriberIndicator: (other ? "2" : "1") as "1" | "2",
    otherPrescriberLabel: other
      ? "Written by a different prescriber"
      : "Same prescriber",
  };
}

const DATABASE = {
  databaseIndicator: "3" as const,
  databaseLabel: "Processor-maintained rule set",
};

function significance(rule: InteractionRule) {
  return {
    clinicalSignificanceCode: rule.severityIndex,
    severity: rule.severity,
  };
}

/**
 * Screen one fill against the therapy the member is already on.
 *
 * Concurrent means still inside its days supply on the date of service, which
 * is the same window the retrospective pass uses. A prescription finished three
 * months ago is history, not a conflict.
 */
export function screenFill(
  candidate: CandidateFill,
  active: ConcurrentFill[],
): DurConflict[] {
  const conflicts: DurConflict[] = [];

  const concurrent = active.filter((f) => {
    const ends = f.dateOfService.getTime() + f.daysSupply * 86_400_000;
    return (
      ends > candidate.dateOfService.getTime() &&
      f.dateOfService.getTime() <= candidate.dateOfService.getTime()
    );
  });

  // --- DD: drug-drug interaction -------------------------------------------
  for (const rule of INTERACTION_RULES) {
    const candidateIsA = matchesDrug(rule.a, candidate);
    const candidateIsB = matchesDrug(rule.b, candidate);
    if (!candidateIsA && !candidateIsB) continue;

    for (const prior of concurrent) {
      const priorMatches = candidateIsA
        ? matchesDrug(rule.b, prior)
        : matchesDrug(rule.a, prior);
      if (!priorMatches) continue;
      // A product that satisfies both arms of a rule on its own is not
      // interacting with itself.
      if (prior.drugId === candidate.drugId) continue;

      conflicts.push({
        reasonForServiceCode: "DD",
        reasonLabel: "Drug-drug interaction",
        ...significance(rule),
        ...otherPharmacy(candidate, prior),
        previousDateOfFill: prior.dateOfService.toISOString().slice(0, 10),
        quantityOfPreviousFill: prior.quantityDispensed,
        ...DATABASE,
        ...otherPrescriber(candidate, prior),
        freeText: `${rule.effect} ${rule.mechanism}`,
        conflictingDrug: prior.name,
        conflictingClaimNumber: prior.claimNumber,
        citation: rule.citation,
        requiresIntervention: rule.severity === "Major",
      });
      break;
    }
  }

  // --- TD: therapeutic duplication -----------------------------------------
  for (const prior of concurrent) {
    if (!candidate.therapeuticClass) break;
    if (prior.therapeuticClass !== candidate.therapeuticClass) continue;
    // Same molecule is a refill, not a duplication. Two different molecules
    // doing the same job at once is the thing worth saying out loud.
    if (
      candidate.molecule &&
      prior.molecule &&
      candidate.molecule === prior.molecule
    ) {
      continue;
    }
    const overlapDays = Math.round(
      (prior.dateOfService.getTime() +
        prior.daysSupply * 86_400_000 -
        candidate.dateOfService.getTime()) /
        86_400_000,
    );

    conflicts.push({
      reasonForServiceCode: "TD",
      reasonLabel: "Therapeutic duplication",
      clinicalSignificanceCode: "2",
      severity: "Moderate",
      ...otherPharmacy(candidate, prior),
      previousDateOfFill: prior.dateOfService.toISOString().slice(0, 10),
      quantityOfPreviousFill: prior.quantityDispensed,
      ...DATABASE,
      ...otherPrescriber(candidate, prior),
      freeText:
        `Member has ${overlapDays} days remaining on ${prior.name}, ` +
        `a different agent in the same therapeutic class. Confirm both are intended.`,
      conflictingDrug: prior.name,
      conflictingClaimNumber: prior.claimNumber,
      citation:
        "NCPDP Telecommunication D.0, Reason for Service Code TD. Class assignment from the Medi-Span therapeutic classification carried on the formulary.",
      requiresIntervention: false,
    });
    break;
  }

  // --- HD: cumulative opioid dose ------------------------------------------
  if (candidate.dailyMme && candidate.dailyMme > 0) {
    const concurrentMme = concurrent.reduce(
      (s, f) => s + (f.dailyMme ?? 0),
      0,
    );
    const total = concurrentMme + candidate.dailyMme;
    const band = mmeBand(total);
    if (band !== "none") {
      const contributors = concurrent.filter((f) => (f.dailyMme ?? 0) > 0);
      const otherPharmacies = contributors.some(
        (f) => f.pharmacyId !== candidate.pharmacyId,
      );
      const otherPrescribers = contributors.some(
        (f) =>
          f.prescriberNpi &&
          candidate.prescriberNpi &&
          f.prescriberNpi !== candidate.prescriberNpi,
      );
      const threshold =
        band === "high" ? MME_THRESHOLDS.avoidOrJustify : MME_THRESHOLDS.reassess;
      conflicts.push({
        reasonForServiceCode: "HD",
        reasonLabel: "High dose",
        clinicalSignificanceCode: band === "high" ? "1" : "2",
        severity: band === "high" ? "Major" : "Moderate",
        otherPharmacyIndicator: otherPharmacies ? "3" : "1",
        otherPharmacyLabel: otherPharmacies
          ? "Concurrent opioids dispensed elsewhere"
          : "Same pharmacy",
        previousDateOfFill:
          contributors[0]?.dateOfService.toISOString().slice(0, 10) ?? null,
        quantityOfPreviousFill: contributors[0]?.quantityDispensed ?? null,
        ...DATABASE,
        otherPrescriberIndicator: !candidate.prescriberNpi
          ? "0"
          : otherPrescribers
            ? "2"
            : "1",
        otherPrescriberLabel: !candidate.prescriberNpi
          ? "Prescriber not specified on the request"
          : otherPrescribers
            ? "Concurrent opioids from a different prescriber"
            : "Same prescriber",
        freeText:
          `This fill takes the member to ${Math.round(total)} MME per day, past the ` +
          `${threshold} MME point in the CDC guideline. ` +
          (contributors.length
            ? `${Math.round(concurrentMme)} MME is already active across ${contributors.length} ` +
              `concurrent ${contributors.length === 1 ? "fill" : "fills"}.`
            : "This product alone reaches the threshold."),
        conflictingDrug: contributors[0]?.name ?? null,
        conflictingClaimNumber: contributors[0]?.claimNumber ?? null,
        citation:
          "CDC Clinical Practice Guideline for Prescribing Opioids for Pain, 2022. Conversion factors from the published table.",
        requiresIntervention: band === "high",
      });
    }
  }

  // Major first, then by code, so the pharmacist reads the one that matters.
  const order = { "1": 0, "2": 1, "3": 2 } as const;
  return conflicts.sort(
    (a, b) =>
      order[a.clinicalSignificanceCode] - order[b.clinicalSignificanceCode],
  );
}

/** Convenience for callers that only need the daily dose of one fill. */
export function fillMme(
  product: { strengthMg: number; mmeFactor: number; isTransdermal: boolean },
  quantityDispensed: number,
  daysSupply: number,
): number {
  return dailyMme({
    strengthMg: product.strengthMg,
    mmeFactor: product.mmeFactor,
    isTransdermal: product.isTransdermal,
    quantityDispensed,
    daysSupply,
  });
}
