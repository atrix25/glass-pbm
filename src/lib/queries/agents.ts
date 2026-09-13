/**
 * What the agents have actually done, read back out of the run log.
 *
 * Nothing here is a claim about agents in general. Every figure is counted off
 * the AgentRun, AgentStep and AgentProposal tables, which are written by the
 * runtime as the work happens. The override rate in particular is the number
 * this whole surface exists for: an agent nobody ever reverses is either very
 * good or not being checked, and a plan sponsor is entitled to know which.
 */

import { prisma } from "@/lib/db";
import { AGENTS, type AgentDef, type Autonomy } from "@/lib/agents/registry";
import type { SimulationClock } from "@/lib/clock";

export interface AgentSummary {
  def: AgentDef;
  autonomy: Autonomy;
  autonomyRationale: string;
  autonomySetBy: string;
  autonomySince: Date | null;
  runs: number;
  escalated: number;
  refused: number;
  proposals: number;
  applied: number;
  autoApplied: number;
  held: number;
  overridden: number;
  /** Share of decided proposals a person reversed. */
  overrideRate: number;
  medianMs: number;
  p95Ms: number;
  costMillicents: number;
  lastRunAt: Date | null;
  brain: string;
  /**
   * When this agent's first case arrives, for an agent that has none yet.
   *
   * The register is cut to the demo date like everything else here, and the
   * program integrity detectors screen a subject over the whole span of its
   * fills, so a signal does not exist until that span closes. Rather than show
   * an agent as a row of dashes, the row says when it starts having something
   * to do. Null once the agent has run at least once.
   */
  firstCaseAt: Date | null;
}

export interface FleetOverview {
  agents: AgentSummary[];
  totalRuns: number;
  totalProposals: number;
  totalHeld: number;
  totalCostMillicents: number;
  /** Hours of human work the runs stand in for, at the registry's own rates. */
  hoursDisplaced: number;
  modelConfigured: boolean;
  /** Runs where a language model did the reasoning rather than the planner. */
  modelRuns: number;
}

/** Minutes of human work each completed run stands in for. */
const MINUTES_PER_RUN: Record<string, number> = {
  "pa-intake": 18,
  "plan-design": 900,
  "integrity-triage": 55,
  "eligibility-resolver": 12,
  "appeal-drafter": 35,
  "member-service": 7,
  "data-agent": 12,
  "rebate-collections": 25,
  "guarantee-credit": 20,
  "service-escalation-triage": 8,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i];
}

export async function getFleet(clock: SimulationClock): Promise<FleetOverview> {
  const now = clock.now;

  const [runs, proposals, policies] = await Promise.all([
    prisma.agentRun.findMany({
      where: { startedAt: { lte: now } },
      select: {
        agentId: true,
        outcome: true,
        elapsedMs: true,
        costMillicents: true,
        startedAt: true,
        brain: true,
      },
    }),
    prisma.agentProposal.findMany({
      where: { createdAt: { lte: now } },
      select: {
        agentId: true,
        status: true,
        autoApplied: true,
        consequential: true,
        overrideNote: true,
      },
    }),
    prisma.agentPolicy.findMany({
      where: { effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);

  // The first run each agent will ever have, ignoring the clock, so an agent
  // whose work has not surfaced yet can say when it does.
  const firstEver = new Map<string, Date>();
  for (const row of await prisma.agentRun.groupBy({
    by: ["agentId"],
    _min: { startedAt: true },
  })) {
    if (row._min.startedAt) firstEver.set(row.agentId, row._min.startedAt);
  }

  const summaries: AgentSummary[] = AGENTS.map((def) => {
    const mine = runs.filter((r) => r.agentId === def.id);
    const myProposals = proposals.filter((p) => p.agentId === def.id);
    const policy = policies.find(
      (p) =>
        p.agentId === def.id &&
        (p.effectiveTo === null || p.effectiveTo > now),
    );

    const times = mine.map((r) => r.elapsedMs).sort((a, b) => a - b);
    const overridden = myProposals.filter(
      (p) => p.status === "Rejected" || Boolean(p.overrideNote),
    ).length;
    const decided = myProposals.filter(
      (p) => p.status !== "Proposed" || Boolean(p.overrideNote),
    ).length;

    const brains = new Set(mine.map((r) => r.brain));

    return {
      def,
      autonomy: (policy?.autonomy as Autonomy) ?? def.autonomy,
      autonomyRationale: policy?.rationale ?? "Registry default.",
      autonomySetBy: policy?.setBy ?? def.owner,
      autonomySince: policy?.effectiveFrom ?? null,
      runs: mine.length,
      escalated: mine.filter((r) => r.outcome === "Escalated").length,
      refused: mine.filter((r) => r.outcome === "Refused").length,
      proposals: myProposals.length,
      applied: myProposals.filter((p) => p.status === "Applied").length,
      autoApplied: myProposals.filter((p) => p.autoApplied).length,
      held: myProposals.filter((p) => p.consequential).length,
      overridden,
      overrideRate: decided === 0 ? 0 : overridden / decided,
      medianMs: percentile(times, 0.5),
      p95Ms: percentile(times, 0.95),
      costMillicents: mine.reduce((s, r) => s + r.costMillicents, 0),
      lastRunAt:
        mine.length === 0
          ? null
          : new Date(Math.max(...mine.map((r) => r.startedAt.getTime()))),
      brain:
        brains.size === 0
          ? "—"
          : brains.size > 1
            ? "mixed"
            : [...brains][0],
      firstCaseAt: mine.length > 0 ? null : (firstEver.get(def.id) ?? null),
    };
  });

  const hoursDisplaced = summaries.reduce(
    (s, a) => s + (a.runs * (MINUTES_PER_RUN[a.def.id] ?? 10)) / 60,
    0,
  );

  return {
    agents: summaries,
    totalRuns: runs.length,
    totalProposals: proposals.length,
    totalHeld: proposals.filter((p) => p.consequential).length,
    totalCostMillicents: runs.reduce((s, r) => s + r.costMillicents, 0),
    hoursDisplaced,
    modelConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    modelRuns: runs.filter((r) => r.brain === "model" || r.brain === "mixed")
      .length,
  };
}

export interface PolicyPeriod {
  autonomy: string;
  rationale: string;
  setBy: string;
  from: Date;
  to: Date | null;
  runsUnder: number;
}

export interface RunRow {
  id: string;
  goal: string;
  summary: string;
  outcome: string;
  startedAt: Date;
  elapsedMs: number;
  autonomy: string;
  brain: string;
  subjectType: string | null;
  subjectId: string | null;
  steps: number;
  proposalHeadline: string | null;
  held: boolean;
}

export interface AgentDetail {
  summary: AgentSummary;
  policy: PolicyPeriod[];
  recent: RunRow[];
  /** Runs where the agent declined to act, which is the interesting half. */
  escalations: RunRow[];
  outcomeCounts: { outcome: string; n: number }[];
}

export async function getAgentDetail(
  agentId: string,
  clock: SimulationClock,
): Promise<AgentDetail | null> {
  const fleet = await getFleet(clock);
  const summary = fleet.agents.find((a) => a.def.id === agentId);
  if (!summary) return null;

  const now = clock.now;

  const [periods, runs] = await Promise.all([
    prisma.agentPolicy.findMany({
      where: { agentId, effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: "asc" },
    }),
    prisma.agentRun.findMany({
      where: { agentId, startedAt: { lte: now } },
      orderBy: { startedAt: "desc" },
      take: 400,
      select: {
        id: true,
        goal: true,
        summary: true,
        outcome: true,
        startedAt: true,
        elapsedMs: true,
        autonomy: true,
        brain: true,
        subjectType: true,
        subjectId: true,
        _count: { select: { steps: true } },
        proposals: {
          select: { headline: true, consequential: true },
          take: 1,
        },
      },
    }),
  ]);

  const counts = await prisma.agentRun.groupBy({
    by: ["autonomy"],
    where: { agentId, startedAt: { lte: now } },
    _count: true,
  });

  const toRow = (r: (typeof runs)[number]): RunRow => ({
    id: r.id,
    goal: r.goal,
    summary: r.summary,
    outcome: r.outcome,
    startedAt: r.startedAt,
    elapsedMs: r.elapsedMs,
    autonomy: r.autonomy,
    brain: r.brain,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    steps: r._count.steps,
    proposalHeadline: r.proposals[0]?.headline ?? null,
    held: r.proposals[0]?.consequential ?? false,
  });

  const outcomeGroups = await prisma.agentRun.groupBy({
    by: ["outcome"],
    where: { agentId, startedAt: { lte: now } },
    _count: true,
  });

  return {
    summary,
    policy: periods.map((p) => ({
      autonomy: p.autonomy,
      rationale: p.rationale,
      setBy: p.setBy,
      from: p.effectiveFrom,
      to: p.effectiveTo,
      runsUnder:
        counts.find((c) => c.autonomy === p.autonomy)?._count ?? 0,
    })),
    recent: runs.slice(0, 25).map(toRow),
    escalations: runs
      .filter((r) => r.outcome === "Escalated" || r.outcome === "Refused")
      .slice(0, 12)
      .map(toRow),
    outcomeCounts: outcomeGroups.map((g) => ({
      outcome: g.outcome,
      n: g._count,
    })),
  };
}

export interface StepRow {
  ordinal: number;
  kind: string;
  tool: string | null;
  because: string;
  summary: string;
  detail: string;
  brain: string;
  elapsedMs: number;
}

export interface RunDetail {
  id: string;
  agent: AgentDef;
  goal: string;
  summary: string;
  outcome: string;
  startedAt: Date;
  elapsedMs: number;
  autonomy: string;
  brain: string;
  modelName: string | null;
  costMillicents: number;
  inputTokens: number;
  outputTokens: number;
  subjectType: string | null;
  subjectId: string | null;
  steps: StepRow[];
  proposals: {
    id: string;
    action: string;
    headline: string;
    rationale: string;
    payload: string;
    confidenceBps: number;
    consequential: boolean;
    status: string;
    autoApplied: boolean;
    overrideNote: string | null;
    executionStatus: string | null;
    executionResult: string | null;
    executionError: string | null;
  }[];
}

export async function getRun(runId: string): Promise<RunDetail | null> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: {
      steps: { orderBy: { ordinal: "asc" } },
      proposals: { include: { execution: true } },
    },
  });
  if (!run) return null;
  const def = AGENTS.find((a) => a.id === run.agentId);
  if (!def) return null;

  return {
    id: run.id,
    agent: def,
    goal: run.goal,
    summary: run.summary,
    outcome: run.outcome,
    startedAt: run.startedAt,
    elapsedMs: run.elapsedMs,
    autonomy: run.autonomy,
    brain: run.brain,
    modelName: run.modelName,
    costMillicents: run.costMillicents,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    subjectType: run.subjectType,
    subjectId: run.subjectId,
    steps: run.steps.map((s) => ({
      ordinal: s.ordinal,
      kind: s.kind,
      tool: s.tool,
      because: s.because,
      summary: s.summary,
      detail: s.detail,
      brain: s.brain,
      elapsedMs: s.elapsedMs,
    })),
    proposals: run.proposals.map((p) => ({
      id: p.id,
      action: p.action,
      headline: p.headline,
      rationale: p.rationale,
      payload: p.payload,
      confidenceBps: p.confidenceBps,
      consequential: p.consequential,
      status: p.status,
      autoApplied: p.autoApplied,
      overrideNote: p.overrideNote,
      executionStatus: p.execution?.status ?? null,
      executionResult: p.execution?.result ?? null,
      executionError: p.execution?.error ?? null,
    })),
  };
}

/** The latest plan design run, unpacked for the recommendation card. */
export async function getLatestPlanDesign(clock: SimulationClock) {
  const run = await prisma.agentRun.findFirst({
    where: {
      agentId: "plan-design",
      startedAt: { lte: clock.now },
      outcome: "Completed",
    },
    orderBy: { startedAt: "desc" },
    include: { proposals: true },
  });
  if (!run || run.proposals.length === 0) return null;
  const payload = JSON.parse(run.proposals[0].payload) as {
    driverKey: string;
    scored: {
      id: string;
      name: string;
      description: string;
      lever: string;
      hypothesis: string;
      claimsEvaluated: number;
      planSavingCents: number;
      memberShiftCents: number;
      netSystemSavingCents: number;
      membersPayingMore: number;
      fillsThatWouldReject: number;
      rebateChangeCents: number;
    }[];
  };
  return {
    runId: run.id,
    at: run.startedAt,
    headline: run.proposals[0].headline,
    rationale: run.proposals[0].rationale,
    status: run.proposals[0].status,
    scored: payload.scored,
  };
}
