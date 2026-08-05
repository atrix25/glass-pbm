/**
 * The performance guarantee schedule, as data.
 *
 * Two kinds of promise live in a pharmacy benefit contract. The financial ones
 * — discount off AWP by channel, dispensing fee, a rebate floor per brand
 * claim — are the ones that get negotiated. The operational ones are the ones
 * that get missed: how fast a prior authorisation is decided, how quickly an
 * eligibility file loads, how long a pharmacy waits for an appeal.
 *
 * Both are written here as measurable statements with a dollar amount attached
 * and a method that reads off records the plan already keeps. That is the whole
 * trick. A guarantee measured by the party that owes it, from data the other
 * party cannot see, is not a guarantee; it is a sentence in a contract. A
 * guarantee measured from the sponsor's own claim and case records, on a
 * schedule, with the credit computed automatically, is an obligation.
 *
 * Dollars at risk are modelled at 12% of annual administrative fees spread
 * across the operational measures, which is a normal order of magnitude for a
 * mid-size commercial contract. Financial guarantees are not capped: a
 * shortfall is owed in full, because the sponsor overpaid by exactly that much.
 */

export type GuaranteeCategory = "Financial" | "Operational";

export interface PerformanceGuarantee {
  id: string;
  category: GuaranteeCategory;
  name: string;
  /** The promise, in the words a contract would use. */
  clause: string;
  /** How it is measured here, naming the records that produce the number. */
  method: string;
  /** Target as a number, with the unit it is expressed in. */
  target: number;
  unit: "percent" | "hours" | "days" | "bps" | "cents";
  /** Higher is better for a percentage; lower is better for a duration. */
  direction: "atLeast" | "atMost";
  /** Annual credit at risk, in cents. Zero means the shortfall itself is owed. */
  atRiskCents: number;
}

const K = 100_000; // one thousand dollars in cents

export const PERFORMANCE_GUARANTEES: PerformanceGuarantee[] = [
  {
    id: "pa-standard",
    category: "Operational",
    name: "Standard prior authorisation turnaround",
    clause:
      "Ninety-eight percent of standard prior authorisation requests will be decided within 72 hours of receipt of a clean request.",
    method:
      "Measured on every prior authorisation with urgency Standard and a recorded decision, from receivedAt to decidedAt. No sampling.",
    target: 98,
    unit: "percent",
    direction: "atLeast",
    atRiskCents: 60 * K,
  },
  {
    id: "pa-expedited",
    category: "Operational",
    name: "Expedited prior authorisation turnaround",
    clause:
      "Ninety-nine percent of expedited prior authorisation requests will be decided within 24 hours of receipt.",
    method:
      "Measured on every prior authorisation with urgency Expedited and a recorded decision, from receivedAt to decidedAt. No sampling.",
    target: 99,
    unit: "percent",
    direction: "atLeast",
    atRiskCents: 75 * K,
  },
  {
    id: "eligibility-load",
    category: "Operational",
    name: "Eligibility file loading",
    clause:
      "Ninety-nine percent of eligibility files received in the agreed format will be loaded within two business days of receipt.",
    method:
      "Measured on every 834 file in the inbox, from receivedAt to processedAt. Files rejected for format are excluded and reported separately.",
    target: 99,
    unit: "percent",
    direction: "atLeast",
    atRiskCents: 40 * K,
  },
  {
    id: "mac-appeal",
    category: "Operational",
    name: "MAC appeal resolution",
    clause:
      "One hundred percent of maximum allowable cost appeals will be investigated and resolved within 21 days, per Wis. Stat. 632.865(2)(b)2.",
    method:
      "Measured on every decided appeal, from submittedAt to decidedAt. The statutory deadline, not a negotiated one.",
    target: 100,
    unit: "percent",
    direction: "atLeast",
    atRiskCents: 25 * K,
  },
  {
    id: "claim-accuracy",
    category: "Operational",
    name: "Financial accuracy of adjudication",
    clause:
      "Ninety-nine and ninety-five hundredths percent of claims will be adjudicated in accordance with the benefit design and the contracted rates.",
    method:
      "Measured by re-adjudicating the entire book against the configuration in force and comparing every money column to the stored claim. Not a sample of two hundred claims chosen by the party being measured.",
    target: 99.95,
    unit: "percent",
    direction: "atLeast",
    atRiskCents: 100 * K,
  },
];

/**
 * What a miss costs.
 *
 * A single tier — miss the target, forfeit the whole amount — invites a fight
 * over whether the target was missed at all. Banding the shortfall makes the
 * credit proportionate and removes the incentive to argue about the last
 * tenth of a point.
 */
export const PENALTY_BANDS = [
  { withinPoints: 0.5, share: 0.25, label: "within half a point" },
  { withinPoints: 2, share: 0.5, label: "within two points" },
  { withinPoints: 5, share: 0.75, label: "within five points" },
  { withinPoints: Infinity, share: 1, label: "beyond five points" },
];

export function penaltyFor(
  guarantee: PerformanceGuarantee,
  measured: number,
): { shortfall: number; share: number; band: string; creditCents: number } {
  const shortfall =
    guarantee.direction === "atLeast"
      ? guarantee.target - measured
      : measured - guarantee.target;

  if (shortfall <= 0) {
    return { shortfall: 0, share: 0, band: "met", creditCents: 0 };
  }

  const band = PENALTY_BANDS.find((b) => shortfall <= b.withinPoints)!;
  return {
    shortfall,
    share: band.share,
    band: band.label,
    creditCents: Math.round(guarantee.atRiskCents * band.share),
  };
}

/**
 * The reconciliation calendar.
 *
 * Claims keep arriving after the year ends, so a reconciliation run on the
 * first of January is measuring an incomplete book. These are the dates the
 * settlement actually turns on, and the page reads its status off them rather
 * than off a field somebody sets by hand.
 */
export const RECONCILIATION_CALENDAR = {
  /** Days after year end that pharmacies may still submit and reverse. */
  runoutDays: 90,
  /** Days after runout closes to publish the reconciliation. */
  publishDays: 30,
  /** Days after publication that any credit is paid or applied. */
  settleDays: 30,
  /** Years the sponsor may reopen and audit a settled year. */
  auditWindowYears: 3,
};

/**
 * Guarantees settle one by one.
 *
 * The single most valuable sentence a traditional PBM gets into a contract is
 * the one that lets it net a category it beat against a category it missed.
 * Beating the generic discount by two hundred basis points on a million claims
 * will cover any brand shortfall that ever occurs, which means the brand
 * guarantee is decorative. This contract settles each measure on its own.
 */
export const NETTING_PERMITTED = false;
