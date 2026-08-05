/**
 * How a member would answer the recommendation question, as data.
 *
 * Nobody was surveyed. There are no members to survey: the book is synthetic.
 * What the book does have is a complete record of what happened to each of the
 * hundred thousand people in it — every fill that was rejected and why, every
 * authorisation that was denied, every dollar they paid at a counter, every
 * time money was taken back after the fact. This turns that record into a
 * zero-to-ten answer using the schedule below, and the usual promoter minus
 * detractor arithmetic turns those answers into a score.
 *
 * The reason to do it this way rather than draw random answers is that a random
 * answer moves for no reason, and a number that moves for no reason cannot be
 * used to tell whether a change helped. Every point here is attached to
 * something that happened, so when the score moves you can open the member and
 * see what moved it.
 *
 * Two rules keep it honest.
 *
 * The first is that the schedule is published. It is printed on the page in the
 * same words it is written in here, so a reader can disagree with a weight
 * rather than having to take the total on faith. A model whose coefficients are
 * hidden is an opinion wearing a number's clothes.
 *
 * The second is that the schedule is not adjustable from the interface. A dial
 * that changes the score is a dial that lets whoever holds it produce whichever
 * score they wanted, and the moment such a dial exists no reading taken before
 * it can be trusted. Changing a weight means editing this file, bumping
 * RUBRIC_VERSION, and accepting that readings taken under the old schedule are
 * marked as belonging to a different schedule rather than quietly compared.
 */

import { hashString } from "@/lib/hash";

/**
 * Bumped whenever any weight, cap or base below changes.
 *
 * Stored on every reading. Two readings under different versions are two
 * different questions and the interface refuses to subtract them.
 */
export const RUBRIC_VERSION = "1.0.0";

export type RubricGroup =
  | "Counter"
  | "Authorisation"
  | "Money"
  | "Coverage"
  | "Clinical"
  | "Convenience";

export interface RubricTerm {
  id: string;
  group: RubricGroup;
  /** What this is, from the member's side of the counter. */
  says: string;
  /** The records it is read off, named so the claim can be checked. */
  method: string;
  /** Points for the first occurrence. Negative deducts. */
  points: number;
  /** Points for each occurrence after the first, where repetition matters. */
  repeatPoints?: number;
  /** The most this single term may ever move one member's answer. */
  cap?: number;
}

/**
 * The starting point: eight out of ten.
 *
 * Eight is a passive, and a passive is the right answer for a benefit that did
 * exactly what it promised and nothing more. The question is whether you would
 * recommend it, and "it worked" is not a reason to recommend anything; it is
 * the absence of a reason to complain. Somebody becomes a promoter here the way
 * they do in life, by having something to point at: an approval that came back
 * the same afternoon, ninety days in the post instead of twelve trips, a year
 * where the whole thing cost them almost nothing.
 *
 * The first version of this started at nine, and the result was instructive
 * enough to record. A quarter of the book came out at a flat ten, and the two
 * largest terms in the entire schedule were the two credits, which meant the
 * score was mostly measuring whether somebody used mail order rather than
 * whether the benefit had failed them. That is a fine thing to measure and a
 * dishonest thing to call a net promoter score. Starting a point lower puts the
 * credits back where they belong, as the things that lift a satisfied member
 * into an enthusiastic one.
 */
export const BASE_SCORE = 8;

/**
 * The most a member's temperament may move their answer, in either direction.
 *
 * Real people who had the same year do not give the same answer. Without this
 * the distribution collapses onto a handful of spikes and the histogram becomes
 * an artefact of the schedule rather than a picture of a population. It is
 * drawn from a hash of the member id, so it is fixed per member forever: the
 * same person is always the same amount of generous.
 */
export const TEMPERAMENT_RANGE = 1.2;

export const RUBRIC: RubricTerm[] = [
  // -------------------------------------------------------------------------
  // What happened at the counter
  //
  // The dominant experience in a pharmacy benefit, and the one members describe
  // when asked about it. Rejects are weighted by whose fault the member will
  // think it was, which is not the same as how the industry classifies them.
  // -------------------------------------------------------------------------
  {
    id: "reject-pa-required",
    group: "Counter",
    says: "The pharmacy said my plan would not cover it until it was approved.",
    method:
      "Claims with responseStatus R carrying NCPDP reject 75, counted per member.",
    points: -1.5,
    repeatPoints: -0.5,
    cap: -3,
  },
  {
    id: "reject-step-therapy",
    group: "Counter",
    says: "I was told to fail on a different drug first.",
    method: "Claims with responseStatus R carrying NCPDP reject 608.",
    points: -1.5,
    repeatPoints: -0.5,
    cap: -3,
  },
  {
    id: "reject-quantity",
    group: "Counter",
    says: "They would only give me part of what my doctor wrote.",
    method: "Claims with responseStatus R carrying NCPDP reject 76.",
    points: -1,
    repeatPoints: -0.4,
    cap: -2.5,
  },
  {
    id: "reject-refill-too-soon",
    group: "Counter",
    says: "I came a few days early and was turned away.",
    method: "Claims with responseStatus R carrying NCPDP reject 79.",
    // Deliberately light. The plan is usually right about this one and the
    // member usually knows it, so it irritates rather than wounds.
    points: -0.4,
    repeatPoints: -0.2,
    cap: -1.2,
  },
  {
    id: "reject-terminated",
    group: "Counter",
    says: "I was told at the counter that I did not have insurance.",
    method: "Claims with responseStatus R carrying NCPDP reject 69.",
    // Among the worst things that can happen to somebody holding a
    // prescription, and it is the plan's paperwork that caused it.
    points: -3,
    cap: -3,
  },
  {
    id: "reject-out-of-network",
    group: "Counter",
    says: "My pharmacy was not covered.",
    method: "Claims with responseStatus R carrying NCPDP reject 40.",
    points: -1,
    cap: -1,
  },

  // -------------------------------------------------------------------------
  // Prior authorisation
  // -------------------------------------------------------------------------
  {
    id: "pa-denied",
    group: "Authorisation",
    says: "My doctor asked for it and the plan said no.",
    method:
      "PriorAuthorization rows for the member with determination Denied and a decision on or before the clock.",
    points: -3,
    repeatPoints: -1,
    cap: -4,
  },
  {
    id: "pa-slow",
    group: "Authorisation",
    says: "I waited longer than the plan promised for an answer.",
    method:
      "Decided requests where decidedAt minus receivedAt exceeds the contractual promise in guarantees.ts: 72 hours standard, 24 hours expedited.",
    points: -1,
    repeatPoints: -0.5,
    cap: -2,
  },
  {
    id: "pa-on-time",
    group: "Authorisation",
    says: "It needed approval, and the approval came back quickly.",
    method:
      "Decided requests approved inside the contractual promise. Credited once however many there were.",
    // The only substantial credit in the schedule. A benefit that clears an
    // obstacle it created is not neutral; the member noticed both halves.
    points: 0.5,
    cap: 0.5,
  },

  // -------------------------------------------------------------------------
  // What it cost
  // -------------------------------------------------------------------------
  {
    id: "oop-band",
    group: "Money",
    says: "What I paid out of my own pocket over the year.",
    method:
      "Sum of patientPayCents on paid claims, banded. Credit below $100, nothing to $500, then increasing deductions to $4,000 and above.",
    // Applied through OOP_BANDS rather than as a flat figure.
    points: 0,
    cap: -2.5,
  },
  {
    id: "oop-shock",
    group: "Money",
    says: "One fill cost me more than four hundred dollars.",
    method: "Highest single patientPayCents across the member's paid claims.",
    points: -1,
    cap: -1,
  },
  {
    id: "brand-penalty",
    group: "Money",
    says: "I paid extra for choosing the brand my doctor wrote.",
    method: "Paid claims with brandSelectionPenaltyCents above zero.",
    points: -0.6,
    cap: -0.6,
  },
  {
    id: "deductible",
    group: "Money",
    says: "I was paying full price until I met a deductible.",
    method: "Paid claims with appliedToDeductibleCents above zero.",
    points: -0.4,
    cap: -0.4,
  },

  // -------------------------------------------------------------------------
  // Coverage undone after the fact
  // -------------------------------------------------------------------------
  {
    id: "retro-clawback",
    group: "Coverage",
    says: "The plan paid, then took the money back months later.",
    method:
      "Eligibility spans with a retroactively reported termination where the member had paid claims after the reported date.",
    // The heaviest single deduction in the schedule. Everything else here is
    // the benefit failing to help; this is the benefit reaching back into a
    // transaction the member reasonably considered finished.
    points: -3.5,
    cap: -3.5,
  },
  {
    id: "reversal",
    group: "Coverage",
    says: "A fill of mine was reversed.",
    method: "Claims with transactionCode B2 attributed to the member.",
    // Nearly a third of the book has one and almost none of them noticed: most
    // reversals are a pharmacy correcting itself the same day. Weighted to say
    // so rather than left out, because a few of them are not that.
    points: -0.3,
    cap: -0.6,
  },

  // -------------------------------------------------------------------------
  // Clinical
  // -------------------------------------------------------------------------
  {
    id: "dur-major",
    group: "Clinical",
    says: "The pharmacist stopped and questioned my prescription.",
    method: "DurAlert rows for the member with severity Major.",
    // Genuinely ambiguous, and left small for that reason. Catching a serious
    // interaction is the system working, and a member who understands that may
    // be grateful. What they experience at the time is a delay and a doubt.
    points: -0.3,
    cap: -0.6,
  },

  // -------------------------------------------------------------------------
  // Convenience
  // -------------------------------------------------------------------------
  {
    id: "extended-supply",
    group: "Convenience",
    says: "I get ninety days at a time, or it comes in the post.",
    method:
      "Paid claims in the Mail or Retail90 channel. Credited once however many there were.",
    points: 0.4,
    cap: 0.4,
  },
];

export const RUBRIC_BY_ID: Record<string, RubricTerm> = Object.fromEntries(
  RUBRIC.map((t) => [t.id, t]),
);

/**
 * Annual out-of-pocket, banded.
 *
 * A flat rate per dollar would make the score a restatement of spend, and spend
 * is mostly a function of how sick somebody is rather than how well the benefit
 * treated them. Bands say what members say: a little is fine, a lot is not, and
 * the step between those is not linear.
 */
export const OOP_BANDS: { upToCents: number; points: number; label: string }[] =
  [
    { upToCents: 10_000, points: 0.3, label: "under $100" },
    { upToCents: 50_000, points: 0, label: "$100 to $500" },
    { upToCents: 150_000, points: -0.8, label: "$500 to $1,500" },
    { upToCents: 400_000, points: -1.8, label: "$1,500 to $4,000" },
    { upToCents: Infinity, points: -2.5, label: "$4,000 and above" },
  ];

/** The threshold behind the oop-shock term, in cents. */
export const OOP_SHOCK_CENTS = 40_000;

/**
 * Everything about one member that the schedule reads.
 *
 * Deliberately a flat bag of counts rather than the records themselves, so that
 * scoring is a pure function of a small object and can be run against the
 * stored book or against a hypothetical one produced by replay without either
 * knowing about the other.
 */
export interface MemberExperience {
  memberId: string;
  /**
   * Every claim submitted for this member, paid or rejected.
   *
   * This, and not the paid count, is the test for whether somebody has an
   * opinion. An earlier version scored only members with a paid fill, which
   * quietly discarded around seven thousand people whose entire experience of
   * the benefit was being turned away — the angriest cohort in the book,
   * removed from a satisfaction score for having been failed completely rather
   * than partially. Zero here means the member never presented a prescription
   * at all, and that is the only population with genuinely nothing to say.
   */
  totalClaims: number;
  paidClaims: number;
  rejectsPaRequired: number;
  rejectsStepTherapy: number;
  rejectsQuantity: number;
  rejectsRefillTooSoon: number;
  rejectsTerminated: number;
  rejectsOutOfNetwork: number;
  paDenied: number;
  paSlow: number;
  paOnTime: number;
  oopCents: number;
  worstFillCents: number;
  brandPenaltyClaims: number;
  deductibleClaims: number;
  retroClawback: boolean;
  reversals: number;
  majorDurAlerts: number;
  extendedSupplyClaims: number;
}

/** One line of the arithmetic behind a member's answer. */
export interface AppliedTerm {
  id: string;
  points: number;
  /** How many times the underlying thing happened. */
  occurrences: number;
}

export interface ScoredMember {
  memberId: string;
  /** The whole-number answer, zero to ten. */
  score: number;
  /** Before rounding and before the clamp, for inspection. */
  raw: number;
  temperament: number;
  applied: AppliedTerm[];
  segment: "promoter" | "passive" | "detractor";
}

function apply(
  out: AppliedTerm[],
  term: RubricTerm,
  occurrences: number,
): number {
  if (occurrences <= 0) return 0;

  const first = term.points;
  const rest = (term.repeatPoints ?? 0) * (occurrences - 1);
  let total = first + rest;

  // Caps are expressed in the direction the term runs, so clamping has to
  // respect the sign rather than assume a deduction.
  if (term.cap !== undefined) {
    total = term.cap < 0 ? Math.max(total, term.cap) : Math.min(total, term.cap);
  }

  out.push({ id: term.id, points: total, occurrences });
  return total;
}

/**
 * A member's temperament, on the interval from minus one to plus one.
 *
 * Derived from the member id alone, so it is unaffected by anything the benefit
 * does. That is what makes it a temperament rather than another opinion about
 * the plan: when a copay changes, this does not.
 */
export function temperamentFor(memberId: string): number {
  // Three draws averaged, which pulls the distribution towards the middle. A
  // flat draw would put as many extremists as moderates in the population and
  // make the histogram's tails the schedule's fault rather than the book's.
  const a = hashString(`${memberId}:t1`) / 4294967296;
  const b = hashString(`${memberId}:t2`) / 4294967296;
  const c = hashString(`${memberId}:t3`) / 4294967296;
  return ((a + b + c) / 3 - 0.5) * 2;
}

/**
 * Turn one member's year into one answer.
 *
 * Pure: same input, same output, no clock, no database, no randomness that is
 * not derived from the member id. The determinism suite depends on that.
 */
export function scoreMember(exp: MemberExperience): ScoredMember {
  const applied: AppliedTerm[] = [];
  let raw = BASE_SCORE;

  raw += apply(applied, RUBRIC_BY_ID["reject-pa-required"], exp.rejectsPaRequired);
  raw += apply(applied, RUBRIC_BY_ID["reject-step-therapy"], exp.rejectsStepTherapy);
  raw += apply(applied, RUBRIC_BY_ID["reject-quantity"], exp.rejectsQuantity);
  raw += apply(
    applied,
    RUBRIC_BY_ID["reject-refill-too-soon"],
    exp.rejectsRefillTooSoon,
  );
  raw += apply(applied, RUBRIC_BY_ID["reject-terminated"], exp.rejectsTerminated);
  raw += apply(
    applied,
    RUBRIC_BY_ID["reject-out-of-network"],
    exp.rejectsOutOfNetwork,
  );

  raw += apply(applied, RUBRIC_BY_ID["pa-denied"], exp.paDenied);
  raw += apply(applied, RUBRIC_BY_ID["pa-slow"], exp.paSlow);
  // Credited once, not per request, so a member with eleven quick approvals is
  // not scored as delighted eleven times over.
  raw += apply(applied, RUBRIC_BY_ID["pa-on-time"], exp.paOnTime > 0 ? 1 : 0);

  // Only meaningful for somebody who actually bought something. A member who
  // filled nothing has spent nothing, and crediting them for a cheap year they
  // never had would pay them for the benefit's failure to serve them.
  if (exp.paidClaims > 0) {
    const band = OOP_BANDS.find((b) => exp.oopCents < b.upToCents)!;
    if (band.points !== 0) {
      applied.push({ id: "oop-band", points: band.points, occurrences: 1 });
      raw += band.points;
    }
  }

  raw += apply(
    applied,
    RUBRIC_BY_ID["oop-shock"],
    exp.worstFillCents >= OOP_SHOCK_CENTS ? 1 : 0,
  );
  raw += apply(
    applied,
    RUBRIC_BY_ID["brand-penalty"],
    exp.brandPenaltyClaims > 0 ? 1 : 0,
  );
  raw += apply(
    applied,
    RUBRIC_BY_ID["deductible"],
    exp.deductibleClaims > 0 ? 1 : 0,
  );

  raw += apply(applied, RUBRIC_BY_ID["retro-clawback"], exp.retroClawback ? 1 : 0);
  raw += apply(applied, RUBRIC_BY_ID["reversal"], exp.reversals);
  raw += apply(applied, RUBRIC_BY_ID["dur-major"], exp.majorDurAlerts);
  raw += apply(
    applied,
    RUBRIC_BY_ID["extended-supply"],
    exp.extendedSupplyClaims > 0 ? 1 : 0,
  );

  const temperament = temperamentFor(exp.memberId) * TEMPERAMENT_RANGE;
  const withTemperament = raw + temperament;
  const score = Math.max(0, Math.min(10, Math.round(withTemperament)));

  return {
    memberId: exp.memberId,
    score,
    raw,
    temperament,
    applied,
    segment: segmentFor(score),
  };
}

export function segmentFor(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

/**
 * Whether this member would have bothered to reply to a survey.
 *
 * The single largest reason a published net promoter score is softer than the
 * truth. Response rates in this industry run in the single digits, and the
 * people who spend four minutes on a questionnaire about their pharmacy benefit
 * are disproportionately the ones with something to say: the furious and the
 * delighted. Everybody in the middle throws the email away.
 *
 * Modelled rather than hidden, so the page can show the surveyed figure beside
 * the whole-population one and let the gap make the argument.
 */
export const SURVEY_BASE_RATE = 0.08;
export const SURVEY_EXTREME_RATE = 0.26;

export function wouldRespond(memberId: string, score: number): boolean {
  const rate = score <= 3 || score >= 9 ? SURVEY_EXTREME_RATE : SURVEY_BASE_RATE;
  // A separate hash namespace from temperament, so who replies is independent
  // of who is generous.
  return hashString(`${memberId}:survey`) / 4294967296 < rate;
}
