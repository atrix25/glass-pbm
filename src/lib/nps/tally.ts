/**
 * Building one member's experience a claim at a time.
 *
 * The database path in experience.ts can do the whole book in one grouped
 * statement. Replay cannot: it is producing a book that does not exist yet, one
 * re-priced fill at a time, and the only place those fills exist is the loop.
 * So the same shape gets assembled incrementally here.
 *
 * Both paths have to agree, or the change console would report a delta that is
 * partly an artefact of two different definitions. The determinism suite checks
 * that a replay against no change reproduces the stored reading exactly, which
 * is what keeps them honest.
 */

import type { MemberExperience } from "./rubric";
import { emptyExperience } from "./experience";

/** What a single fill contributes, whether stored or freshly re-priced. */
export interface FillOutcome {
  responseStatus: string;
  transactionCode: string;
  patientPayCents: number;
  appliedToDeductibleCents: number;
  brandSelectionPenaltyCents: number;
  channel: string;
  /** First reject code, which is the one shown at the counter. */
  rejectCode: string | null;
}

/**
 * Signals a benefit change cannot touch.
 *
 * Re-pricing the book does not re-run the authorisation queue, revisit a
 * clinical alert or unwind an eligibility file. A copay change does not reach
 * back and un-deny a request from March. These are therefore carried across
 * from the stored record into both sides of a comparison, held constant, so
 * that the delta a change console reports is the part of the experience the
 * change actually moved.
 */
export interface FixedSignals {
  paDenied: number;
  paSlow: number;
  paOnTime: number;
  majorDurAlerts: number;
  retroClawback: boolean;
}

export const NO_FIXED_SIGNALS: FixedSignals = {
  paDenied: 0,
  paSlow: 0,
  paOnTime: 0,
  majorDurAlerts: 0,
  retroClawback: false,
};

export class ExperienceTally {
  readonly exp: MemberExperience;

  constructor(memberId: string, fixed: FixedSignals = NO_FIXED_SIGNALS) {
    this.exp = emptyExperience(memberId);
    this.exp.paDenied = fixed.paDenied;
    this.exp.paSlow = fixed.paSlow;
    this.exp.paOnTime = fixed.paOnTime;
    this.exp.majorDurAlerts = fixed.majorDurAlerts;
    this.exp.retroClawback = fixed.retroClawback;
  }

  add(fill: FillOutcome): void {
    const e = this.exp;
    e.totalClaims++;

    if (fill.transactionCode === "B2") {
      e.reversals++;
      return;
    }

    if (fill.responseStatus === "P") {
      e.paidClaims++;
      e.oopCents += fill.patientPayCents;
      if (fill.patientPayCents > e.worstFillCents) {
        e.worstFillCents = fill.patientPayCents;
      }
      if (fill.appliedToDeductibleCents > 0) e.deductibleClaims++;
      if (fill.brandSelectionPenaltyCents > 0) e.brandPenaltyClaims++;
      if (fill.channel === "Mail" || fill.channel === "Retail90") {
        e.extendedSupplyClaims++;
      }
      return;
    }

    switch (fill.rejectCode) {
      case "75":
        e.rejectsPaRequired++;
        break;
      case "608":
        e.rejectsStepTherapy++;
        break;
      case "76":
        e.rejectsQuantity++;
        break;
      case "79":
        e.rejectsRefillTooSoon++;
        break;
      case "69":
        e.rejectsTerminated++;
        break;
      case "40":
        e.rejectsOutOfNetwork++;
        break;
    }
  }
}

export function firstRejectCode(rejectCodesJson: string): string | null {
  try {
    return (JSON.parse(rejectCodesJson) as string[])[0] ?? null;
  } catch {
    return null;
  }
}
