import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";
import { latestRelease, RELEASE_TAG } from "@/lib/benefit-release";
import { replay } from "@/lib/engine/replay";
import { getDrugDrivers, getTrendOverview } from "@/lib/queries/trends";
import { resolveClock } from "@/lib/clock";
import { startRun } from "@/lib/agents/runtime";
import { AGENTS } from "@/lib/agents/registry";
import {
  GoalsSchema,
  BenefitSchema,
  mergeBenefit,
  rank,
  type Goals,
  type Option,
} from "./model";

export interface Analysis {
  runId: string;
  goals: Goals;
  options: Option[];
  recommendedId: string | null;
  baselineId: string | null;
  asOf: string;
  generatedAt: string;
  proposalId: string | null;
}
export async function analyzeBenefits(
  goalsInput: unknown,
  asOf: string,
  progress: (value: number) => Promise<void>,
): Promise<Analysis> {
  const goals = GoalsSchema.parse(goalsInput);
  const clock = resolveClock(asOf);
  const current = await latestRelease();
  if (current && new Date(current.effectiveAt) > new Date())
    throw Error(
      "A benefit release is scheduled. Analyze again after it takes effect.",
    );
  const base = current?.benefit ?? { formulary: [] };
  const run = await startRun({
    agentId: "account-management",
    at: new Date(),
    goal: `Find at least $${(goals.savingCents / 100).toFixed(2)} in replayed savings with the fewest affected members.`,
  });
  try {
    const trend = await getTrendOverview(clock);
    if (!trend)
      throw Error("Not enough claims history to compare benefit options.");
    const drivers = (await getDrugDrivers(trend))
      .filter((d) => d.currentScripts > 0)
      .sort(
        (a, b) =>
          b.currentCostPerScriptCents * b.currentScripts -
          a.currentCostPerScriptCents * a.currentScripts,
      )
      .slice(0, 3);
    const entries = await prisma.formularyEntry.findMany({
      where: {
        formularyId: "navitus-etf-2026",
        drugId: { in: drivers.map((d) => d.key) },
        notCovered: false,
        planExclusion: false,
      },
      include: { drug: { select: { name: true, therapeuticClass: true } } },
    });
    const candidates: {
      id: string;
      name: string;
      override: Option["override"];
    }[] = [];
    for (const entry of entries) {
      const drug = entry.drug;
      const active = {
        ...entry,
        ...base.formulary.find((p) => p.drugId === entry.drugId),
      };
      if (!active.requiresPA && entry.criteriaTreeId)
        candidates.push({
          id: `pa-${entry.drugId}`,
          name: `Prior authorization · ${drug.name}`,
          override: mergeBenefit(base, {
            drugId: entry.drugId,
            requiresPA: true,
          }),
        });
      if (!active.requiresStep && drug.therapeuticClass)
        candidates.push({
          id: `step-${entry.drugId}`,
          name: `Step therapy · ${drug.name}`,
          override: mergeBenefit(base, {
            drugId: entry.drugId,
            requiresStep: true,
          }),
        });
      if (["1", "2"].includes(active.level))
        candidates.push({
          id: `tier-${entry.drugId}`,
          name: `Tier 3 · ${drug.name}`,
          override: mergeBenefit(base, { drugId: entry.drugId, level: "3" }),
        });
    }
    const baseline = await replay({}, { asOf: clock.now, maxDiffs: 0 });
    if (baseline.claimsChanged !== 0)
      throw Error(
        "Filed-plan replay does not reproduce the recorded book. Resolve baseline differences before recommending a change.",
      );
    const options: Option[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      await progress((i + 1) / (candidates.length + 2));
      const result = await replay(candidate.override, {
        asOf: clock.now,
        maxDiffs: 0,
      });
      const saving =
        result.planPaidBeforeCents -
        result.planPaidAfterCents -
        (result.rebateBeforeCents - result.rebateAfterCents);
      const shift = result.memberPaidAfterCents - result.memberPaidBeforeCents;
      const option: Option = {
        ...candidate,
        planSavingCents: saving,
        memberShiftCents: shift,
        netSavingCents: saving - shift,
        affectedMembers: result.membersAffected,
        membersPayingMore: result.membersPayingMore,
        newRejects: result.newRejects,
        claimsEvaluated: result.claimsEvaluated,
        reasons: [],
      };
      options.push(option);
      run.evidence(
        candidate.name,
        "Full-book replay against the filed plan, not a forecast or a clinical-outcome estimate.",
        { ...option, override: undefined },
      );
    }
    const ranked = rank(options, goals);
    const selected = ranked.find((o) => o.reasons.length === 0);
    let proposalId: string | null = null;
    const analysis: Analysis = {
      runId: run.id,
      goals,
      options: ranked,
      recommendedId: selected?.id ?? null,
      baselineId: current?.id ?? null,
      asOf: clock.now.toISOString(),
      generatedAt: new Date().toISOString(),
      proposalId: null,
    };
    if (selected) {
      run.propose({
        subjectType: "PlanDesign",
        subjectId: tenantSponsorId(),
        action: "activate-benefit-design",
        headline: selected.name,
        rationale: `Meets the savings goal with ${selected.affectedMembers} affected members, the fewest among the eligible options evaluated. ${selected.newRejects} additional rejected fills; ${selected.membersPayingMore} members pay more.`,
        payload: { analysis },
        confidence: 1,
      });
      proposalId = run.proposals[0].id;
      analysis.proposalId = proposalId;
    } else
      run.refuse(
        "No evaluated option meets the goals.",
        "The agent will not relax member-impact limits or count a pure cost transfer as a net saving.",
      );
    await run.finish(
      selected ? "Completed" : "Refused",
      selected
        ? `${selected.name} recommended for approval.`
        : "No eligible recommendation. Review goals or explore other benefit levers.",
    );
    return analysis;
  } catch (error) {
    await run.finish(
      "Failed",
      error instanceof Error ? error.message : "Analysis failed",
    );
    throw error;
  }
}

export async function activateBenefit(proposalId: string, actor: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(74839201)::text`;
      const proposal = await tx.agentProposal.findFirst({
        where: {
          id: proposalId,
          agentId: "account-management",
          action: "activate-benefit-design",
        },
      });
      if (!proposal) throw Error("Proposal not found.");
      if (proposal.status === "Applied") {
        const releases = await tx.configVersion.findMany({
          where: { description: RELEASE_TAG },
        });
        const existing = releases.find(
          (v) => JSON.parse(v.payload).proposalId === proposalId,
        );
        if (existing)
          return {
            id: existing.id,
            effectiveAt: JSON.parse(existing.payload).effectiveAt,
          };
        throw Error("Applied proposal has no release record.");
      }
      if (proposal.status !== "Proposed")
        throw Error("This proposal is no longer awaiting approval.");
      const { analysis } = JSON.parse(proposal.payload) as {
        analysis: Analysis;
      };
      if (
        !Number.isFinite(Date.parse(analysis.generatedAt)) ||
        Date.parse(analysis.generatedAt) > Date.now() ||
        Date.now() - Date.parse(analysis.generatedAt) > 86400000
      )
        throw Error(
          "Analysis is more than 24 hours old. Run it again before activation.",
        );
      if (Date.parse(analysis.asOf) > Date.now())
        throw Error(
          "Analysis uses a future clock. Rerun with the current date before activation.",
        );
      const releases = await tx.configVersion.findMany({
        where: { description: RELEASE_TAG },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const latest = releases.find(
        (v) => JSON.parse(v.payload).sponsorId === tenantSponsorId(),
      );
      if ((latest?.id ?? null) !== analysis.baselineId)
        throw Error("Benefits changed after this analysis. Run it again.");
      const best = rank(
        analysis.options,
        GoalsSchema.parse(analysis.goals),
      ).find((o) => o.reasons.length === 0);
      if (!best || best.id !== analysis.recommendedId)
        throw Error("No eligible recommendation.");
      const benefit = BenefitSchema.parse(best.override);
      const effective = new Date();
      effective.setUTCHours(24, 0, 0, 0);
      const payload = JSON.stringify({
        sponsorId: tenantSponsorId(),
        benefit,
        effectiveAt: effective.toISOString(),
        proposalId,
        analysisRunId: analysis.runId,
        baselineId: analysis.baselineId,
      });
      const version = await tx.configVersion.create({
        data: {
          label: `Account management · ${best.name}`,
          description: RELEASE_TAG,
          contentHash: createHash("sha256").update(payload).digest("hex"),
          payload,
          createdBy: actor,
          changeSummary: JSON.stringify([
            best.name,
            `Effective ${effective.toISOString()}`,
          ]),
        },
      });
      await tx.agentProposal.update({
        where: { id: proposalId },
        data: {
          status: "Applied",
          reviewedBy: actor,
          reviewedAt: new Date(),
          appliedAt: new Date(),
          autoApplied: false,
        },
      });
      // These are delivery records and human follow-up requests, not fabricated agent executions.
      for (const def of AGENTS.filter((a) => a.id !== "account-management")) {
        const id = randomUUID();
        await tx.agentRun.create({
          data: {
            id,
            agentId: def.id,
            startedAt: new Date(),
            endedAt: new Date(),
            goal: `Review benefit release ${version.id}`,
            subjectType: "BenefitRelease",
            subjectId: version.id,
            outcome: "Escalated",
            summary: `Account management delivered ${best.name}. Review the effect on ${def.surface}.`,
            brain: "deterministic",
            elapsedMs: 0,
            autonomy: "Propose",
            steps: {
              create: {
                id: randomUUID(),
                ordinal: 1,
                kind: "Gate",
                because:
                  "A benefit release requires accountable operational follow-up.",
                summary: `Responsible role: ${def.owner}. Effective ${effective.toISOString()}.`,
                detail: JSON.stringify({
                  configVersionId: version.id,
                  sourceRunId: analysis.runId,
                }),
                brain: "deterministic",
                elapsedMs: 0,
              },
            },
            proposals: {
              create: {
                id: randomUUID(),
                agentId: def.id,
                subjectType: "BenefitRelease",
                subjectId: version.id,
                action: "review-benefit-release",
                headline: `Review rollout · ${best.name}`,
                rationale: `Review release ${version.id} in ${def.surface}. Delivery is recorded; completion is not.`,
                payload: JSON.stringify({
                  configVersionId: version.id,
                  sourceRunId: analysis.runId,
                }),
                confidenceBps: 10000,
                consequential: true,
                status: "Proposed",
                autoApplied: false,
                createdAt: new Date(),
              },
            },
          },
        });
      }
      return { id: version.id, effectiveAt: effective.toISOString() };
    },
    { timeout: 30000 },
  );
}
