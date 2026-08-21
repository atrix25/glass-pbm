/**
 * Turning complaints into things somebody can actually do on Monday.
 *
 * A satisfaction score that only reports a number produces a meeting in which
 * everyone agrees the number should be higher. What makes the difference is the
 * concentration in the data: the sixteen thousand members hit by a quantity
 * limit did not run into forty-five hundred different drugs, they ran into
 * forty-five, and the single worst one turned away nearly four thousand people
 * on its own. That is not a strategy problem. It is a list.
 *
 * So each recommendation here names the specific edit, the specific drug or
 * tier behind it, and how many real members it would stop hurting. Every figure
 * is counted from the book rather than assumed, and each one carries the
 * override that would enact it, so the change console can price it against the
 * plan before anybody commits to anything.
 *
 * Deliberately not ranked by expected score improvement. Ranking by the metric
 * is how a metric gets gamed: it would put whatever is cheapest to move at the
 * top regardless of whether it mattered. These are ranked by how many members
 * are affected, and the projected score movement is shown beside each one as a
 * consequence rather than as the objective.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import type { ConfigOverride } from "@/lib/engine/replay";

export type RecommendationKind =
  | "prior-auth"
  | "quantity"
  | "step-therapy"
  | "cost-share"
  | "refill";

export type Lever =
  | { kind: "removePA"; match: string }
  | { kind: "removeQuantityLimit"; match: string }
  | { kind: "removeStepTherapy"; match: string }
  | { kind: "level3CountsToRxOop" }
  | { kind: "level1Copay"; cents: number }
  | { kind: "refillThreshold"; value: number };

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  /** The edit, in the words a benefits committee would minute it in. */
  title: string;
  /** Why it is on the list, with the counts that put it there. */ 
  rationale: string;
  /** The rubric term this is aimed at. */
  addresses: string;
  /** Members who hit the thing being removed. */
  membersAffected: number;
  /** Rejected fills those members were turned away on. */
  eventsAvoided: number;
  /**
   * Points currently deducted across the book by the part of the term this
   * change would remove. An upper bound on the improvement, not a promise:
   * caps, temperament and rounding all eat into it, and a fill that starts
   * paying brings cost share with it.
   *
   * Null where the effect runs through what members pay rather than through a
   * countable event. Cost share moves people across out-of-pocket bands in
   * ways that cannot be counted without re-pricing the year, and printing a
   * confident zero would read as "this would not help" rather than "this needs
   * the engine to answer".
   */
  pointsAtStake: number | null;
  /** Applied by the change console when this is picked up. */
  override: ConfigOverride;
  /**
   * The same edit named as a lever on the console's form.
   *
   * Carried separately from the override so that picking a recommendation
   * fills in a visible field rather than applying something the reader cannot
   * see. Kept as a plain tagged union because this module has no business
   * importing a type out of a client component.
   */
  lever: Lever;
  /**
   * Preloads the console. Kept as a query parameter rather than posted, so a
   * recommendation can be pasted into an email and still work.
   */
  href: string;
  /** The honest caveat particular to this kind of change. */
  caution: string;
}

/** Reject codes, named where they are used. */
const PA_REQUIRED = "75";
const QUANTITY_LIMIT = "76";
const STEP_THERAPY = "608";

interface DrugRejectRow {
  drugId: string;
  name: string;
  level: string | null;
  members: bigint | number;
  claims: bigint | number;
}

async function rejectsByDrug(
  cutoff: Date,
  code: string,
  limit: number,
): Promise<DrugRejectRow[]> {
  return prisma.$queryRawUnsafe<DrugRejectRow[]>(
    `SELECT c.drugId AS drugId, MAX(d.name) AS name, MAX(c.formularyLevel) AS level,
            COUNT(DISTINCT c.memberId) AS members, COUNT(*) AS claims
     FROM Claim c JOIN Drug d ON d.id = c.drugId
     WHERE c.responseStatus = 'R'
       AND json_extract(c.rejectCodes, '$[0]') = ?
       AND c.dateOfService <= ?
     GROUP BY c.drugId
     ORDER BY members DESC
     LIMIT ?`,
    code,
    cutoff,
    limit,
  );
}

const n = (v: bigint | number) => Number(v);

/**
 * A drug name that can be matched on.
 *
 * The console's formulary override matches by case-insensitive substring, which
 * is the right interface for a human typing into a box and the wrong one for
 * generated input: "sildenafil susp sildenafil tab - CARDI" is a real name in
 * this book and matching on the whole of it would catch nothing. The first
 * token is stable, specific enough in practice, and visible to whoever applies
 * the recommendation, so an over-broad match is something they can see rather
 * than something that happens to them.
 */
function matchToken(name: string): string {
  return name.trim().split(/[\s/(),]+/)[0];
}

/**
 * The drug name as it should appear in a sentence.
 *
 * A guard rather than a fix. The names in this book once ended in stray
 * brackets, because the formulary parser truncated rule clauses that contained
 * their own brackets; that is repaired at the source now, so on a correctly
 * ingested catalogue this changes nothing. It stays because drug files are
 * untidy in general and a trailing bracket in a recommendation reads as a
 * defect in the thing making the suggestion.
 */
function displayName(name: string): string {
  return name.replace(/\s*[(),;:-]+\s*$/, "").trim();
}

function consoleHref(id: string): string {
  return `/changes?recommend=${encodeURIComponent(id)}`;
}

export async function getRecommendations(
  clock: SimulationClock,
): Promise<Recommendation[]> {
  const cutoff = clock.now;

  const [paDrugs, qlDrugs, stDrugs, levelBurden, refill] = await Promise.all([
    rejectsByDrug(cutoff, PA_REQUIRED, 3),
    rejectsByDrug(cutoff, QUANTITY_LIMIT, 3),
    rejectsByDrug(cutoff, STEP_THERAPY, 2),
    prisma.$queryRawUnsafe<
      { level: string | null; members: bigint; fills: bigint; oop: bigint }[]
    >(
      `SELECT c.formularyLevel AS level, COUNT(DISTINCT c.memberId) AS members,
              COUNT(*) AS fills, SUM(c.patientPayCents) AS oop
       FROM Claim c
       WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
         AND c.dateOfService <= ?
       GROUP BY c.formularyLevel`,
      cutoff,
    ),
    prisma.$queryRawUnsafe<{ members: bigint; claims: bigint }[]>(
      `SELECT COUNT(DISTINCT memberId) AS members, COUNT(*) AS claims
       FROM Claim
       WHERE responseStatus = 'R'
         AND json_extract(rejectCodes, '$[0]') = '79'
         AND dateOfService <= ?`,
      cutoff,
    ),
  ]);

  const out: Recommendation[] = [];

  /*
   * Prior authorisation, one drug at a time.
   *
   * The heaviest term in the whole schedule, and the one where the fix is most
   * obviously available: the edit exists on a named drug, somebody chose to put
   * it there, and somebody can take it off.
   */
  for (const d of paDrugs) {
    const token = matchToken(d.name);
    const name = displayName(d.name);
    out.push({
      id: `pa-${d.drugId}`,
      kind: "prior-auth",
      title: `Remove prior authorisation from ${name}`,
      rationale:
        `${formatCount(n(d.members))} members were turned away at a counter on this drug alone, across ` +
        `${formatCount(n(d.claims))} rejected fills. It sits on Level ${d.level ?? "—"}. ` +
        `The first refusal costs a member 1.5 points and each one after that half a point more.`,
      addresses: "reject-pa-required",
      membersAffected: n(d.members),
      eventsAvoided: n(d.claims),
      pointsAtStake: estimateRejectPoints(n(d.members), n(d.claims), 1.5, 0.5, 3),
      override: { formulary: [{ nameContains: token, requiresPA: false }] },
      lever: { kind: "removePA", match: token },
      href: consoleHref(`pa-${d.drugId}`),
      caution:
        "Removing the edit means the plan starts paying for fills it was declining. Model it before committing: the member gain is real and so is the cost.",
    });
  }

  /*
   * Quantity limits. Broader than prior authorisation and cheaper to fix,
   * because the fill was going to be paid eventually — the limit mostly moves
   * it, and the extra trip to the pharmacy is the whole of the harm.
   */
  for (const d of qlDrugs) {
    const token = matchToken(d.name);
    const name = displayName(d.name);
    out.push({
      id: `ql-${d.drugId}`,
      kind: "quantity",
      title: `Lift the quantity limit on ${name}`,
      rationale:
        `${formatCount(n(d.members))} members were given less than their prescription said, ` +
        `over ${formatCount(n(d.claims))} rejected fills. Level ${d.level ?? "—"}. ` +
        `Often the same medication is dispensed anyway a week later, so the limit buys a second trip rather than a saving.`,
      addresses: "reject-quantity",
      membersAffected: n(d.members),
      eventsAvoided: n(d.claims),
      pointsAtStake: estimateRejectPoints(n(d.members), n(d.claims), 1, 0.4, 2.5),
      override: {
        formulary: [{ nameContains: token, hasQuantityLimit: false }],
      },
      lever: { kind: "removeQuantityLimit", match: token },
      href: consoleHref(`ql-${d.drugId}`),
      caution:
        "Quantity limits exist for safety on some molecules as well as for cost. Check why this one was set before removing it.",
    });
  }

  for (const d of stDrugs) {
    const token = matchToken(d.name);
    const name = displayName(d.name);
    out.push({
      id: `st-${d.drugId}`,
      kind: "step-therapy",
      title: `Drop the step therapy requirement on ${name}`,
      rationale:
        `${formatCount(n(d.members))} members were told to fail on something else first, across ` +
        `${formatCount(n(d.claims))} rejected fills. This is the complaint members phrase as the plan overruling their doctor.`,
      addresses: "reject-step-therapy",
      membersAffected: n(d.members),
      eventsAvoided: n(d.claims),
      pointsAtStake: estimateRejectPoints(n(d.members), n(d.claims), 1.5, 0.5, 3),
      override: { formulary: [{ nameContains: token, requiresStep: false }] },
      lever: { kind: "removeStepTherapy", match: token },
      href: consoleHref(`st-${d.drugId}`),
      caution:
        "Step therapy is the single largest generic-substitution lever on the plan. Removing it on a high-volume molecule moves real money.",
    });
  }

  /*
   * Cost share. Not a reject, so it produces no dramatic anecdote, but it is
   * the burden every member carries rather than the one a few thousand run
   * into.
   */
  const level3 = levelBurden.find((r) => r.level === "3");
  if (level3) {
    out.push({
      id: "level3-counts",
      kind: "cost-share",
      title: "Let Level 3 cost share count toward the $600 limit",
      rationale:
        `${formatCount(n(level3.members))} members paid ${formatMoney(n(level3.oop))} out of pocket on Level 3 brands, ` +
        `and none of it counts toward their own out-of-pocket limit. This is the asymmetry members ring up about: ` +
        `a ceiling that does not apply to the tier where the money actually goes.`,
      addresses: "oop-band",
      membersAffected: n(level3.members),
      eventsAvoided: 0,
      pointsAtStake: null,
      override: { costShare: [{ level: "3", accumulatesToRxOop: true }] },
      lever: { kind: "level3CountsToRxOop" },
      href: consoleHref("level3-counts"),
      caution:
        "Helps the sickest members most and the median member not at all, so it moves the score less than it moves lives. Worth doing for the second reason.",
    });
  }

  const level1 = levelBurden.find((r) => r.level === "1");
  if (level1) {
    out.push({
      id: "level1-free",
      kind: "cost-share",
      title: "Take Level 1 generics to $0",
      rationale:
        `${formatCount(n(level1.members))} members — most of the book — pay a $5 copay across ` +
        `${formatCount(n(level1.fills))} generic fills, ${formatMoney(n(level1.oop))} in total. ` +
        `The broadest lever available, because it touches nearly everybody rather than a cohort.`,
      addresses: "oop-band",
      membersAffected: n(level1.members),
      eventsAvoided: 0,
      pointsAtStake: null,
      override: { costShare: [{ level: "1", copayCents: 0 }] },
      lever: { kind: "level1Copay", cents: 0 },
      href: consoleHref("level1-free"),
      caution:
        "The plan absorbs the whole of what members stop paying. This is a spend decision wearing a satisfaction argument.",
    });
  }

  const r79 = refill[0];
  if (r79 && n(r79.members) > 0) {
    out.push({
      id: "refill-threshold",
      kind: "refill",
      title: "Loosen the refill-too-soon threshold from 75% to 70%",
      rationale:
        `${formatCount(n(r79.members))} members were turned away for arriving early, across ` +
        `${formatCount(n(r79.claims))} fills. A small irritation each time and rarely the member's fault ` +
        `when it is a holiday or a travel week, which is why it is weighted lightly and still worth removing.`,
      addresses: "reject-refill-too-soon",
      membersAffected: n(r79.members),
      eventsAvoided: n(r79.claims),
      pointsAtStake: estimateRejectPoints(n(r79.members), n(r79.claims), 0.4, 0.2, 1.2),
      override: { refillThreshold: 0.7 },
      lever: { kind: "refillThreshold", value: 0.7 },
      href: consoleHref("refill-threshold"),
      caution:
        "A looser threshold lets genuine stockpiling through as well as genuine travel. It is a deliberate trade, not a free win.",
    });
  }

  return out.sort((a, b) => b.membersAffected - a.membersAffected);
}

/**
 * Points currently taken off by a set of rejects, respecting the term's cap.
 *
 * An upper bound and described as one. It assumes the removed rejects are
 * spread across members the way the totals imply and that nothing else about
 * those members changes, neither of which is exactly true.
 */
function estimateRejectPoints(
  members: number,
  claims: number,
  first: number,
  repeat: number,
  cap: number,
): number {
  if (members === 0) return 0;
  const perMember = claims / members;
  const raw = first + repeat * Math.max(0, perMember - 1);
  return Math.round(members * Math.min(raw, cap) * 10) / 10;
}

function formatCount(v: number): string {
  return v.toLocaleString("en-US");
}

function formatMoney(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
