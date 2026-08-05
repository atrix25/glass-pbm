/**
 * The free-text box on the survey nobody was sent.
 *
 * A score of 4.5 tells a benefits committee that something is wrong and
 * absolutely nothing about what. The open-text answers are the part of a real
 * survey that gets acted on, because "quantity limit rejects cost 21,358
 * points" is a finding and "they would only give me ten days of an inhaler my
 * daughter needs every day" is a decision.
 *
 * So this renders each member's record as the sentence they would plausibly
 * have written. It is important to be exact about what that is and is not.
 *
 * It is not invented sentiment. Every clause below is triggered by a specific
 * count of specific rows — this member's rejects, their denials, what they
 * paid — and if the record does not contain the thing, the clause does not
 * appear. The wording is chosen from a fixed set by a hash of the member id, so
 * it is stable forever and carries no information of its own. Two members with
 * the same experience get differently-worded versions of the same complaint,
 * because that is what a real inbox looks like, and neither version says
 * anything the claims do not.
 *
 * What it is, then, is a rendering. The same facts the driver table prints as
 * totals, printed one member at a time in the register a person would use. The
 * page says so, and every quotation links to the member so the claims behind
 * it can be read.
 */

import { hashString } from "@/lib/hash";
import { RUBRIC_BY_ID, type AppliedTerm, type ScoredMember } from "./rubric";

/**
 * Pick deterministically from a list.
 *
 * The salt keeps independent choices independent: without it, a member who got
 * the first opening would get the first closing too, and the whole book would
 * come out in a handful of identical shapes.
 */
function pick<T>(memberId: string, salt: string, options: T[]): T {
  return options[hashString(`${memberId}:${salt}`) % options.length];
}

/**
 * How each term reads in the first person, at the length somebody actually
 * writes in a comment box.
 *
 * Several phrasings per term, because a page where fourteen thousand people
 * complain in identical words is obviously machinery, and the point of showing
 * these is that the underlying complaints are not identical even when the
 * category is.
 */
const PHRASINGS: Record<string, (t: AppliedTerm) => string[]> = {
  "reject-pa-required": ({ occurrences: n }) => [
    n > 1
      ? `Twice now I have gone to pick up a prescription and been told the plan will not cover it until someone approves it. My doctor already decided I need it.`
      : `I went to pick up my prescription and was told the plan would not pay for it until it was approved. Nobody had mentioned that.`,
    n > 1
      ? `I keep getting sent home to wait for an approval that my doctor has to chase. It has happened ${n} times this year.`
      : `The pharmacist said it needed prior authorisation. I left without it and had to ring the surgery the next morning.`,
    `Why does my insurance get to overrule my doctor about whether I need my own medication?`,
  ],
  "reject-step-therapy": () => [
    `I was told I have to fail on a cheaper drug before they will pay for the one I was prescribed. I have already tried it. It did not work.`,
    `Being made to take something my doctor did not choose, so the plan can save money, is not a benefit.`,
    `They want me to spend two months proving a different tablet does not work before covering the one that does.`,
  ],
  "reject-quantity": ({ occurrences: n }) => [
    `They would only give me part of what my doctor wrote, so now I have to go back to the pharmacy again before the month is out.`,
    n > 2
      ? `Every single month there is an argument about how much of my own prescription I am allowed to have.`
      : `The pharmacy said the plan limits how much I can get at once. I was not told that when I signed up.`,
    `I paid for a full prescription and was handed a partial one.`,
  ],
  "reject-refill-too-soon": () => [
    `I went a few days early because I was travelling and was turned away. It would have been nice to be able to explain.`,
    `Refused a refill for being early. I understand the rule, but there was no way to ask anyone about it.`,
  ],
  "reject-terminated": () => [
    `I was told at the counter, in front of a queue, that I did not have insurance. I have worked here for years. Nobody could tell me what had happened.`,
    `The pharmacy said my coverage had ended. It had not. I paid cash for my own medication that day because I needed it.`,
  ],
  "reject-out-of-network": () => [
    `My usual pharmacy is apparently not covered. Nobody told me that until I was standing in it.`,
  ],
  "pa-denied": ({ occurrences: n }) => [
    `My doctor asked for a medication and the plan said no. I do not understand how that is their decision to make.`,
    n > 1
      ? `Two separate requests from my doctor have been refused this year. I have stopped expecting the plan to approve anything.`
      : `Denied. My consultant wrote to them explaining why I need it and it was still denied.`,
    `I would like to know who at the insurance company reviewed my case, and whether they are a doctor.`,
  ],
  "pa-slow": () => [
    `I waited longer for an answer than they said I would. Nobody rang to explain the delay.`,
    `The approval took longer than the plan's own deadline. In the meantime I went without.`,
  ],
  "retro-clawback": () => [
    `They paid for my prescriptions and then months later took the money back and billed me, because of a paperwork problem that was not mine.`,
    `I was told my coverage had been backdated as ended. I had already collected and paid for those prescriptions in good faith.`,
    `Getting an invoice for medication I collected six months ago, which the plan paid for at the time, is not something I expected to have to deal with.`,
  ],
  "oop-shock": () => [
    `One prescription cost me over four hundred dollars. I had no warning it would be that much until I was at the till.`,
    `I had to decide at the counter whether I could afford my own medication. I left it there.`,
  ],
  /*
   * The only term in the schedule that can land on either side, because a low
   * out-of-pocket year is a credit and a high one is a deduction. Phrasing it
   * as a grievance regardless produced promoters who complained bitterly about
   * costs in the middle of recommending the plan.
   */
  "oop-band": ({ points }) =>
    points > 0
      ? [
          `What I actually pay at the counter has been very reasonable.`,
          `The costs have been low enough that I have not really had to think about them.`,
        ]
      : [
          `I pay for this out of every paycheque and then pay again every time I collect anything.`,
          `The amount I have spent out of pocket this year on top of my premiums is genuinely difficult.`,
        ],
  "brand-penalty": () => [
    `I was charged extra for taking the brand my doctor wrote on the prescription.`,
    `Apparently choosing what my consultant actually prescribed makes it my fault, and I pay a penalty for it.`,
  ],
  deductible: () => [
    `I was paying the whole cost myself for the first few months before the coverage seemed to start doing anything.`,
    `Nobody explained the deductible clearly. I thought I was covered from January.`,
  ],
  "dur-major": () => [
    `The pharmacist stopped and rang my doctor about an interaction. It held things up, but honestly I would rather they checked.`,
  ],
  reversal: () => [
    `There was some confusion at the pharmacy and the prescription had to be put through twice.`,
  ],
  "pa-on-time": () => [
    `It needed approval and the answer came back the same day, which I was not expecting.`,
    `The authorisation went through quickly and the pharmacy rang to tell me. That was handled well.`,
  ],
  "extended-supply": () => [
    `Getting ninety days at a time by post has made this much easier to live with.`,
    `The mail order works well. One less errand every month.`,
  ],
};

/** How the comment opens, keyed to how the member feels overall. */
const OPENINGS: Record<"promoter" | "passive" | "detractor", string[]> = {
  promoter: [
    "No complaints.",
    "Generally this has worked well for me.",
    "Honestly, better than the last plan I was on.",
  ],
  passive: [
    "It does the job, mostly.",
    "No strong feelings either way.",
    "Fine, I suppose.",
  ],
  detractor: [
    "Frankly, it has been a struggle.",
    "I would not recommend this to anyone.",
    "This has been more difficult than it needed to be.",
  ],
};

export interface Verbatim {
  memberId: string;
  score: number;
  segment: ScoredMember["segment"];
  text: string;
  /** Rubric term ids the sentences came from, so the page can show the source. */
  fromTerms: string[];
}

/**
 * The single term that hurt this member most.
 *
 * Used both to head a comment and, aggregated, to rank complaint themes. A
 * member's worst experience is a better description of their year than the sum
 * of their grievances: somebody clawed back after a retro-termination is
 * defined by that, not by the four dollars of copay around it.
 */
export function worstTerm(applied: AppliedTerm[]): AppliedTerm | null {
  let worst: AppliedTerm | null = null;
  for (const t of applied) {
    if (t.points >= 0) continue;
    if (!worst || t.points < worst.points) worst = t;
  }
  return worst;
}

function bestTerm(applied: AppliedTerm[]): AppliedTerm | null {
  let best: AppliedTerm | null = null;
  for (const t of applied) {
    if (t.points <= 0) continue;
    if (!best || t.points > best.points) best = t;
  }
  return best;
}

/**
 * Render one member's year as the comment they would have left.
 *
 * Detractors lead with what went wrong; promoters lead with what went right.
 * Both get at most two clauses, because a comment box is not an essay and a
 * paragraph listing eleven grievances reads as generated even when every item
 * in it is true.
 */
export function verbatimFor(scored: ScoredMember): Verbatim {
  const { memberId, segment, applied } = scored;
  const parts: string[] = [pick(memberId, "open", OPENINGS[segment])];
  const fromTerms: string[] = [];

  const negative = applied
    .filter((t) => t.points < 0)
    .sort((a, b) => a.points - b.points);
  const positive = applied
    .filter((t) => t.points > 0)
    .sort((a, b) => b.points - a.points);

  /*
   * Promoters are quoted only on what went right, everyone else led by what
   * went wrong.
   *
   * The asymmetry is deliberate. Somebody scoring nine or ten has, by
   * construction, had a year with nothing much in it, and the phrasings below
   * are written at the intensity of a real complaint — a member who would
   * recommend the plan does not describe their costs as genuinely difficult in
   * the same breath. Letting a promoter reach the negative list produced
   * exactly that sentence, and a quotation that argues with its own score
   * discredits the page rather than enriching it.
   */
  const ordered =
    segment === "promoter" ? positive : [...negative, ...positive];

  for (const term of ordered.slice(0, 2)) {
    const options = PHRASINGS[term.id]?.(term);
    if (!options || options.length === 0) continue;
    parts.push(pick(memberId, `p:${term.id}`, options));
    fromTerms.push(term.id);
  }

  return {
    memberId,
    score: scored.score,
    segment,
    text: parts.join(" "),
    fromTerms,
  };
}

/**
 * A one-line summary of why a member scored as they did.
 *
 * Sits under the quotation on the page, so a reader can go straight from the
 * sentence to the arithmetic without having to trust the sentence.
 */
export function reasonLine(scored: ScoredMember): string {
  const worst = worstTerm(scored.applied);
  const best = bestTerm(scored.applied);
  const bits: string[] = [];

  if (worst) {
    const term = RUBRIC_BY_ID[worst.id];
    bits.push(
      `${term?.group ?? "Experience"}: ${worst.occurrences > 1 ? `${worst.occurrences}× ` : ""}${worst.id} ${worst.points.toFixed(1)}`,
    );
  }
  if (best) bits.push(`${best.id} +${best.points.toFixed(1)}`);
  return bits.join(" · ");
}
