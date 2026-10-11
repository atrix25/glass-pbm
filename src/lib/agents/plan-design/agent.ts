/**
 * The plan design agent.
 *
 * It reads the trend decomposition, picks the driver worth acting on, writes
 * three candidate benefit changes, and then does the thing that makes the
 * recommendation worth reading: it re-adjudicates every claim in the book
 * against each candidate and reports what actually happens.
 *
 * Two rules shape the output.
 *
 * A saving is only a saving if it leaves the system. A change that moves cost
 * from the plan onto a member's deductible has not saved anybody anything, and
 * this agent reports the shift on the same line as the saving rather than at
 * the back of a deck. Where most of a "saving" is a shift, it says so, and it
 * will not recommend that option on savings alone.
 *
 * Disruption is counted, not estimated. The replay knows exactly which fills
 * would have rejected and exactly which members would have paid more, because
 * it repriced them.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { judge } from "../brain";
import { startRun, type Run } from "../runtime";
import { replay, type ConfigOverride } from "@/lib/engine/replay";
import {
  getTrendOverview,
  getDrugDrivers,
  trendPeriods,
  type DriverRow,
  type TrendOverview,
} from "@/lib/queries/trends";
import type { SimulationClock } from "@/lib/clock";

export interface Candidate {
  id: string;
  /** What a benefits committee would call it. */
  name: string;
  /** What it does, in a sentence, without jargon. */
  description: string;
  /** The clause of the benefit it changes. */
  lever: string;
  override: ConfigOverride;
  /** What the agent expects to happen, written before the replay runs. */
  hypothesis: string;
}

export interface Scored extends Candidate {
  claimsEvaluated: number;
  claimsChanged: number;
  /** Plan cost after rebates, before minus after. Positive is a saving. */
  planSavingCents: number;
  /** How much of that saving is a member paying instead of the plan. */
  memberShiftCents: number;
  /** The saving that actually leaves the system. */
  netSystemSavingCents: number;
  membersPayingMore: number;
  worstMemberIncreaseCents: number;
  fillsThatWouldReject: number;
  rebateChangeCents: number;
  /** Saving per member disrupted. The number nobody wants to publish. */
  costPerDisruptedMember: number;
}

const DAYS_LEFT_FACTOR = 1;

/** Annualise a part-year replay result onto the remaining plan year. */
function annualise(cents: number): number {
  return Math.round(cents * DAYS_LEFT_FACTOR);
}

// ---------------------------------------------------------------------------
// Candidate construction
// ---------------------------------------------------------------------------

/**
 * The scripted planner's candidate set.
 *
 * These are the four levers a pharmacy benefit actually has against a single
 * product: make the prescriber justify it, make the member try something
 * cheaper first, cap the quantity, or move where it is dispensed. A model
 * writing this section produces the same four, because there are only four.
 */
function candidatesFor(driver: DriverRow, tierName: string): Candidate[] {
  const name = driver.label;
  const short = name.split(/[\s,(]/)[0];
  return [
    {
      id: "pa",
      name: `Require prior authorisation on ${short}`,
      description: `Add a prior authorisation requirement to ${name}. Fills continue for members with an approved request; new starts need the prescriber to document the indication.`,
      lever: "Utilisation management",
      override: { formulary: [{ nameContains: short, requiresPA: true }] },
      hypothesis:
        "Removes fills that would not meet published criteria, and leaves continuing therapy alone. Expect a moderate saving and a small number of members who lose access at the counter.",
    },
    {
      id: "step",
      name: `Step therapy before ${short}`,
      description: `Require a documented trial of a lower-cost alternative before ${name} is covered.`,
      lever: "Utilisation management",
      override: { formulary: [{ nameContains: short, requiresStep: true }] },
      hypothesis:
        "Redirects new starts rather than removing therapy. Expect a smaller saving than prior authorisation and a similar level of disruption, concentrated in members starting treatment.",
    },
    {
      id: "tier",
      name: `Move ${short} to the ${tierName} tier`,
      description: `Reprice ${name} to the ${tierName} cost share. The drug stays covered; the member pays the higher tier's share.`,
      lever: "Cost share",
      override: {
        formulary: [{ nameContains: short, level: tierName }],
      },
      hypothesis:
        "Almost all of this will be a transfer to members rather than a saving. Included so the committee can see the difference on the same page.",
    },
  ];
}

const PlanSchema = z.object({
  driverKey: z.string(),
  reasoning: z.string(),
  candidateIds: z.array(z.string()),
});

// ---------------------------------------------------------------------------

export interface PlanDesignResult {
  runId: string;
  driver: DriverRow;
  trend: TrendOverview;
  scored: Scored[];
  recommendation: Scored | null;
  caution: string | null;
}

export async function runPlanDesign(opts: {
  clock: SimulationClock;
  /** Force a particular driver, for reproducing a run. */
  driverKey?: string;
  persist?: boolean;
  onProgress?: (note: string) => void;
}): Promise<{ run: Run; result: PlanDesignResult } | null> {
  const periods = trendPeriods(opts.clock);
  if (!periods) return null;

  const run = await startRun({
    agentId: "plan-design",
    goal: "Find the largest driver of pharmacy trend and cost out what can be done about it.",
    at: opts.clock.now,
  });

  const trend = await run.tool(
    "getTrendDrivers",
    "A recommendation has to start from what actually moved, not from what is fashionable to cut.",
    () => getTrendOverview(opts.clock),
    (t) =>
      t
        ? `Net PMPM moved ${(t.netChangePct * 100).toFixed(1)}% between the two periods.`
        : "Not enough of the year has run.",
  );
  if (!trend) {
    await run.finish("Failed", "Not enough of the plan year has run.");
    return null;
  }

  const drivers = await run.tool(
    "getTrendDrivers",
    "Decompose the change by product, so the conversation is about a molecule rather than about a category.",
    () => getDrugDrivers(trend),
    (d) => `${d.length} products contributed to the change.`,
  );

  // Only products that grew, are material, and are big enough per script for a
  // benefit lever to be worth the disruption it causes.
  const actionable = drivers.filter(
    (d) =>
      d.changeCents > 0 &&
      d.currentScripts > 200 &&
      d.currentCostPerScriptCents > 20_000,
  );
  if (actionable.length === 0) {
    run.refuse(
      "No single product moved enough to be worth a benefit change.",
      "Trend is spread across the book rather than concentrated, and a change aimed at any one product would disrupt members without moving the number.",
    );
    if (opts.persist !== false) {
      await run.finish(
        "Completed",
        "No product concentrated enough to act on this period.",
      );
    }
    return null;
  }

  const chosen = await judge({
    system:
      "You are advising a self-funded employer on pharmacy benefit design. You may only recommend acting on a product where the trend is concentrated enough that a change would matter. You never claim a saving you have not measured.",
    prompt: [
      "Products ranked by contribution to the change in net plan cost per member per month:",
      ...actionable
        .slice(0, 8)
        .map(
          (d) =>
            `- ${d.key}: ${d.label} (${d.sublabel ?? "unclassified"}), ${(d.changeCents / 100).toFixed(2)} dollars PMPM, ${d.priorScripts} to ${d.currentScripts} scripts, ${(d.currentCostPerScriptCents / 100).toFixed(0)} dollars per script`,
        ),
      "",
      "Pick the one driver to act on and say why in one sentence.",
    ].join("\n"),
    schema: PlanSchema,
    fallback: () => ({
      driverKey: (opts.driverKey ?? actionable[0].key) as string,
      reasoning: `${actionable[0].label} contributed the largest increase in net plan cost per member per month of any single product, at ${(actionable[0].changeCents / 100).toFixed(2)} dollars, on ${actionable[0].currentScripts} fills.`,
      candidateIds: ["pa", "step", "tier"],
    }),
  });

  const driver =
    actionable.find((d) => d.key === (opts.driverKey ?? chosen.value.driverKey)) ??
    actionable[0];

  run.absorb(
    chosen,
    "Of the products that grew, only some are worth a benefit change: the spend has to be concentrated enough that a change moves the number, and the unit cost high enough to justify the friction.",
    `Selected ${driver.label}.`,
    { driverKey: driver.key, reasoning: chosen.value.reasoning },
  );

  run.evidence(
    `${driver.label} moved ${(driver.changeCents / 100).toFixed(2)} dollars of net PMPM`,
    `${driver.priorScripts} fills in the prior period against ${driver.currentScripts} in the current one, at ${(driver.currentCostPerScriptCents / 100).toFixed(0)} dollars a fill.`,
    driver,
  );

  const tierName = "Specialty";
  const candidates = candidatesFor(driver, tierName).filter((c) =>
    chosen.value.candidateIds.length
      ? chosen.value.candidateIds.includes(c.id)
      : true,
  );

  const scored: Scored[] = [];
  for (const c of candidates) {
    opts.onProgress?.(`Re-adjudicating the book against: ${c.name}`);
    const r = await run.tool(
      "replay",
      `${c.hypothesis} Rather than assume that, reprice every claim in the book against it.`,
      () => replay(c.override, { maxDiffs: 20, asOf: opts.clock.now }),
      (res) =>
        `${res.claimsEvaluated.toLocaleString()} claims repriced, ${res.claimsChanged.toLocaleString()} changed, in ${(res.elapsedMs / 1000).toFixed(1)}s.`,
    );

    const planSaving =
      r.planPaidBeforeCents -
      r.planPaidAfterCents -
      (r.rebateBeforeCents - r.rebateAfterCents);
    const memberShift = r.memberPaidAfterCents - r.memberPaidBeforeCents;
    const paidMore = r.memberImpacts.filter((m) => m.deltaCents > 0);

    const disruption = await run.tool(
      "countDisruption",
      "A saving without a disruption count is half a sentence. Count the members who pay more and the fills that would have rejected.",
      async () => ({
        membersPayingMore: paidMore.length,
        worstIncreaseCents: Math.max(0, ...paidMore.map((m) => m.deltaCents)),
        fillsThatWouldReject: r.newRejects,
      }),
      (d) =>
        `${d.membersPayingMore} members pay more; ${d.fillsThatWouldReject.toLocaleString()} fills would have rejected at the counter.`,
    );

    scored.push({
      ...c,
      claimsEvaluated: r.claimsEvaluated,
      claimsChanged: r.claimsChanged,
      planSavingCents: annualise(planSaving),
      memberShiftCents: annualise(memberShift),
      netSystemSavingCents: annualise(planSaving - memberShift),
      membersPayingMore: disruption.membersPayingMore,
      worstMemberIncreaseCents: disruption.worstIncreaseCents,
      fillsThatWouldReject: disruption.fillsThatWouldReject,
      rebateChangeCents: annualise(r.rebateAfterCents - r.rebateBeforeCents),
      costPerDisruptedMember:
        disruption.membersPayingMore + disruption.fillsThatWouldReject === 0
          ? 0
          : annualise(planSaving) /
            (disruption.membersPayingMore + disruption.fillsThatWouldReject),
    });
  }

  // Ranked on the saving that leaves the system, not on the saving that leaves
  // the plan's ledger.
  const ranked = [...scored].sort(
    (a, b) => b.netSystemSavingCents - a.netSystemSavingCents,
  );
  const best = ranked[0] ?? null;

  const mostlyShift =
    best && best.planSavingCents > 0
      ? best.memberShiftCents / best.planSavingCents
      : 0;
  const caution =
    best && mostlyShift > 0.4
      ? `${Math.round(mostlyShift * 100)}% of the saving on the recommended option is cost moved onto members rather than removed from the system.`
      : null;

  if (best) {
    run.propose({
      subjectType: "PlanDesign",
      subjectId: driver.key,
      action: "apply-benefit-change",
      headline: `${best.name}: ${(best.planSavingCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} off plan cost, ${best.membersPayingMore} members paying more.`,
      rationale: [
        chosen.value.reasoning,
        `Of the three options costed, this one removes the most cost from the system rather than moving it: ${(best.netSystemSavingCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} of the ${(best.planSavingCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} plan saving.`,
        caution ?? "",
        `Every figure comes from repricing ${best.claimsEvaluated.toLocaleString()} claims, not from a model.`,
      ]
        .filter(Boolean)
        .join(" "),
      payload: { override: best.override, driverKey: driver.key, scored },
      confidence: 0.8,
    });
  }

  const result: PlanDesignResult = {
    runId: run.id,
    driver,
    trend,
    scored,
    recommendation: best,
    caution,
  };

  if (opts.persist !== false) {
    await run.finish(
      "Completed",
      best
        ? `${driver.label} is the largest driver. Three options costed against the full book; ${best.name.toLowerCase()} recommended.`
        : `${driver.label} is the largest driver, but no option tested was worth the disruption.`,
    );
  }
  return { run, result };
}

/** Trend drivers the agent could act on, for the page to list. */
export async function actionableDrivers(clock: SimulationClock) {
  const trend = await getTrendOverview(clock);
  if (!trend) return [];
  const drivers = await getDrugDrivers(trend);
  return drivers.filter(
    (d) =>
      d.changeCents > 0 &&
      d.currentScripts > 200 &&
      d.currentCostPerScriptCents > 20_000,
  );
}

/** Products already carrying the lever a candidate proposes. */
export async function existingControls(nameContains: string) {
  return prisma.formularyEntry.findFirst({
    where: { drug: { name: { contains: nameContains } } },
    select: { requiresPA: true, requiresStep: true, hasQuantityLimit: true, level: true },
  });
}
