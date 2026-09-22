"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  Loader2,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { formatCents, formatCentsWhole } from "@/lib/money";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import type { ConfigOverride } from "@/lib/engine/replay";

// ---------------------------------------------------------------------------

export interface BaselineConfig {
  level1CopayCents: number;
  level2RateBps: number;
  level2MaxCents: number;
  level3RateBps: number;
  level3MaxCents: number;
  level3CountsToRxOop: boolean;
  level4CopayCents: number;
  level4CountsToRxOop: boolean;
  rxOopLimitCents: number;
  dawPenaltyEnabled: boolean;
  specialtyChannelRestricted: boolean;
  includeUandC: boolean;
  refillThreshold: number;
}

interface Draft extends BaselineConfig {
  /*
   * Utilisation edits, expressed as a drug-name match rather than a drug list.
   *
   * They live on the draft next to the copays so that a recommendation arriving
   * from the member-experience page lands in a field the reader can see and
   * edit, rather than being applied invisibly. A suggestion you cannot inspect
   * or narrow is not a suggestion, it is an instruction.
   */
  paRemovedFor: string;
  quantityLimitRemovedFor: string;
  stepTherapyRemovedFor: string;
}

interface ReplayResponse {
  claimsEvaluated: number;
  claimsChanged: number;
  membersAffected: number;
  planPaidBeforeCents: number;
  planPaidAfterCents: number;
  memberPaidBeforeCents: number;
  memberPaidAfterCents: number;
  rebateBeforeCents: number;
  rebateAfterCents: number;
  newRejects: number;
  newlyPaid: number;
  memberImpacts: {
    memberId: string;
    memberName: string;
    beforeCents: number;
    afterCents: number;
    deltaCents: number;
    claims: number;
  }[];
  diffs: {
    claimId: string;
    claimNumber: string;
    memberId: string;
    memberName: string;
    drugName: string;
    dateOfService: string;
    level: string | null;
    channel: string;
    before: { status: string; planPaidCents: number; patientPayCents: number };
    after: { status: string; planPaidCents: number; patientPayCents: number };
    planDeltaCents: number;
    memberDeltaCents: number;
    kind: "cost" | "newly-rejected" | "newly-paid";
  }[];
  nps?: {
    before: NpsSide;
    after: NpsSide;
  };
  /** One for a measured run, a fraction for a projection. */
  sampleRate: number;
  elapsedMs: number;
}

interface NpsSide {
  census: {
    scored: number;
    promoters: number;
    passives: number;
    detractors: number;
    nps: number;
  };
  surveyed: { scored: number; nps: number };
  histogram: number[];
  drivers: { id: string; membersAffected: number; totalPoints: number }[];
}

/**
 * A change the member-experience page put forward, carried through to here.
 *
 * Shaped as a draft patch rather than a raw override so that applying one
 * fills in the same fields a person would have typed, and can then be narrowed
 * or widened by hand before it is priced.
 */
export interface ConsoleRecommendation {
  id: string;
  title: string;
  rationale: string;
  membersAffected: number;
  caution: string;
  patch: Partial<Draft>;
}

const PRESETS: {
  id: string;
  label: string;
  rationale: string;
  apply: (b: BaselineConfig) => Partial<Draft>;
}[] = [
  {
    id: "level3-counts",
    label: "Let Level 3 cost share count toward the $600 limit",
    rationale:
      "The most-complained-about rule on this plan. Members on a Level 3 brand pay 40% all year with no ceiling short of the federal maximum.",
    apply: () => ({ level3CountsToRxOop: true }),
  },
  {
    id: "level2-max",
    label: "Raise the Level 2 coinsurance maximum from $50 to $75",
    rationale:
      "A cost-shifting lever. Small per-fill effect, concentrated on members with expensive preferred brands.",
    apply: () => ({ level2MaxCents: 7500 }),
  },
  {
    id: "level1-free",
    label: "Take Level 1 generics to $0",
    rationale:
      "Removes the $5 copay on the highest-volume tier to test adherence economics.",
    apply: () => ({ level1CopayCents: 0 }),
  },
  {
    id: "drop-uandc",
    label: "Drop usual & customary from the lesser-of",
    rationale:
      "Not a benefit change. This is what a traditional contract looks like when the pharmacy's cash price is not allowed to cap the claim.",
    apply: () => ({ includeUandC: false }),
  },
  {
    id: "open-specialty",
    label: "Open the specialty channel to any network pharmacy",
    rationale:
      "Removes the Lumicera and UW Health restriction on Level 4 drugs.",
    apply: () => ({ specialtyChannelRestricted: false }),
  },
  {
    id: "remove-pa-glp1",
    label: "Remove prior authorization from semaglutide",
    rationale:
      "Tests what the utilization management edit is actually holding back.",
    apply: () => ({ paRemovedFor: "SEMAGLUTIDE" }),
  },
];

// ---------------------------------------------------------------------------

/**
 * The fraction of members a projection runs against.
 *
 * Chosen by measurement rather than by feel: across the changes worth modelling
 * here, a sixth of the book lands within about two tenths of a point of the
 * full run and answers in six seconds rather than thirty. Dropping to a twelfth
 * saves barely a second and roughly doubles the error, so there is no reason to
 * take it.
 */
const PROJECTION_SAMPLE = 0.15;

export function ChangeConsole({
  baseline,
  history,
  recommendations = [],
}: {
  baseline: BaselineConfig;
  history: {
    id: string;
    label: string;
    createdAt: string;
    changeSummary: string[];
    planCostDeltaCents: number;
    memberCostDeltaCents: number;
    claimsChanged: number;
  }[];
  recommendations?: ConsoleRecommendation[];
}) {
  const initial: Draft = {
    ...baseline,
    paRemovedFor: "",
    quantityLimitRemovedFor: "",
    stepTherapyRemovedFor: "",
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const [result, setResult] = useState<ReplayResponse | null>(null);
  const [projection, setProjection] = useState<ReplayResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [committed, setCommitted] = useState<string | null>(null);
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);

  const changes = describeChanges(baseline, draft);
  const dirty = changes.length > 0;

  /*
   * A projection is discarded the moment the configuration moves.
   *
   * Leaving the last one on screen while somebody edits is the worst behaviour
   * available here: a stale projection looks exactly like a current one, and
   * the reader has no way to tell that the number stopped describing what is
   * in front of them.
   */
  const clearResults = () => {
    setResult(null);
    setProjection(null);
    setCommitted(null);
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    clearResults();
  };

  const reset = () => {
    setDraft(initial);
    clearResults();
    setAppliedPreset(null);
  };

  const applyDraft = (patch: Partial<Draft>, presetId: string | null) => {
    const next = { ...initial, ...patch };
    setDraft(next);
    clearResults();
    setAppliedPreset(presetId);
    // Same path as recommendations: picking a scenario answers the cost
    // question immediately rather than parking the change in the levers and
    // waiting for a second click.
    void project(next);
  };

  const project = async (d: Draft) => {
    setProjecting(true);
    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          override: buildOverride(baseline, d),
          sampleRate: PROJECTION_SAMPLE,
        }),
      });
      setProjection((await res.json()) as ReplayResponse);
    } finally {
      setProjecting(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setCommitted(null);
    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ override: buildOverride(baseline, draft) }),
      });
      setResult((await res.json()) as ReplayResponse);
    } finally {
      setRunning(false);
    }
  };

  /*
   * A recommendation arriving by link from the member-experience page.
   *
   * Applied and projected on arrival, because somebody who followed "model this
   * change" has already asked the question and should not have to ask it again
   * on landing. Runs once: re-applying whenever the parameter is still in the
   * address bar would stamp on edits the reader had made since.
   */
  const searchParams = useSearchParams();
  const requested = searchParams.get("recommend");
  const [intake, setIntake] = useState<string | null>(null);

  useEffect(() => {
    if (!requested || intake === requested) return;
    const rec = recommendations.find((r) => r.id === requested);
    if (!rec) return;

    setIntake(requested);
    const next = { ...initial, ...rec.patch };
    setDraft(next);
    clearResults();
    setAppliedPreset(`rec:${rec.id}`);
    void project(next);
    // initial and project are rebuilt every render; depending on them would
    // re-run this on every keystroke, which is the opposite of running once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, recommendations, intake]);

  const commit = async () => {
    if (!result) return;
    const res = await fetch("/api/changes/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: changes[0] ?? "Benefit change",
        description: changes.join(" "),
        override: buildOverride(baseline, draft),
        changeSummary: changes,
        metrics: {
          claimsEvaluated: result.claimsEvaluated,
          claimsChanged: result.claimsChanged,
          membersAffected: result.membersAffected,
          planDeltaCents: result.planPaidAfterCents - result.planPaidBeforeCents,
          memberDeltaCents:
            result.memberPaidAfterCents - result.memberPaidBeforeCents,
          newRejects: result.newRejects,
        },
        diffs: result.diffs.slice(0, 100),
        // The member-experience reading the decision was taken against, so the
        // history on /experience records what this change did rather than only
        // that it happened.
        nps: result.nps?.after ?? null,
      }),
    });
    const json = (await res.json()) as { contentHash: string };
    setCommitted(json.contentHash);
  };

  return (
    <div className="space-y-5">
      {recommendations.length > 0 ? (
        <Card className="border-glass-500/25 bg-glass-50/30">
          <CardHeader
            title="Member concerns"
            description="Drawn from the modelled member experience: the edits sitting on the largest numbers of turned-away members. Picking one loads it into the levers and projects it."
            action={
              <Link
                href="/experience"
                className="text-[12.5px] font-medium text-glass-700 hover:text-glass-800"
              >
                Where these come from
              </Link>
            }
          />
          <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  const next = { ...initial, ...r.patch };
                  setDraft(next);
                  clearResults();
                  setAppliedPreset(`rec:${r.id}`);
                  void project(next);
                }}
                className={cn(
                  "bg-white px-4 py-3.5 text-left transition hover:bg-glass-50/60",
                  appliedPreset === `rec:${r.id}` &&
                    "bg-glass-50 ring-1 ring-inset ring-glass-400/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-medium leading-snug text-ink-900">
                    {r.title}
                  </div>
                  <span className="tnum shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/15">
                    {formatNumber(r.membersAffected)}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                  {r.rationale}
                </p>
              </button>
            ))}
          </div>
          <div className="border-t border-ink-200/70 px-5 py-3">
            <p className="text-[12.5px] leading-relaxed text-ink-600">
              Ranked by members affected, not by how much each would move the
              score. Ranking a list of fixes by the metric they are measured
              against is how the metric stops being worth measuring.
            </p>
          </div>
        </Card>
      ) : null}

      {/* Presets */}
      <Card>
        <CardHeader
          title="Changes a plan sponsor actually asks for"
          description="Pick one to load it into the levers and project the cost, or set the levers by hand below. Nothing is saved until you commit."
        />
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyDraft(p.apply(baseline), p.id)}
              className={cn(
                "bg-white px-4 py-3.5 text-left transition hover:bg-glass-50/60",
                appliedPreset === p.id && "bg-glass-50 ring-1 ring-inset ring-glass-400/40",
              )}
            >
              <div className="flex items-start gap-2">
                <Sparkles
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    appliedPreset === p.id ? "text-glass-600" : "text-ink-300",
                  )}
                />
                <div>
                  <div className="text-[13px] font-medium leading-snug text-ink-900">
                    {p.label}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                    {p.rationale}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr] lg:items-start">
        {/* Levers */}
        <Card className="lg:sticky lg:top-4">
          <CardHeader
            title="Benefit configuration"
            description="Plan year 2026, IYC Health Plan."
            action={
              dirty ? (
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-500 hover:text-ink-800"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              ) : null
            }
          />
          <div className="divide-y divide-ink-100">
            <Group title="Member cost share">
              <MoneyField
                label="Level 1 copay"
                value={draft.level1CopayCents}
                baseline={baseline.level1CopayCents}
                onChange={(v) => set("level1CopayCents", v)}
              />
              <PercentField
                label="Level 2 coinsurance"
                value={draft.level2RateBps}
                baseline={baseline.level2RateBps}
                onChange={(v) => set("level2RateBps", v)}
              />
              <MoneyField
                label="Level 2 maximum per fill"
                value={draft.level2MaxCents}
                baseline={baseline.level2MaxCents}
                onChange={(v) => set("level2MaxCents", v)}
              />
              <PercentField
                label="Level 3 coinsurance"
                value={draft.level3RateBps}
                baseline={baseline.level3RateBps}
                onChange={(v) => set("level3RateBps", v)}
              />
              <MoneyField
                label="Level 3 maximum per fill"
                value={draft.level3MaxCents}
                baseline={baseline.level3MaxCents}
                onChange={(v) => set("level3MaxCents", v)}
              />
              <MoneyField
                label="Level 4 specialty copay"
                value={draft.level4CopayCents}
                baseline={baseline.level4CopayCents}
                onChange={(v) => set("level4CopayCents", v)}
              />
            </Group>

            <Group title="Out-of-pocket limits">
              <MoneyField
                label="Prescription limit, individual"
                value={draft.rxOopLimitCents}
                baseline={baseline.rxOopLimitCents}
                onChange={(v) => set("rxOopLimitCents", v)}
              />
              <Toggle
                label="Level 3 counts toward it"
                hint="Off in the filed 2026 design. This is the asymmetry members call about."
                value={draft.level3CountsToRxOop}
                baseline={baseline.level3CountsToRxOop}
                onChange={(v) => set("level3CountsToRxOop", v)}
              />
              <Toggle
                label="Level 4 counts toward it"
                value={draft.level4CountsToRxOop}
                baseline={baseline.level4CountsToRxOop}
                onChange={(v) => set("level4CountsToRxOop", v)}
              />
            </Group>

            <Group title="Utilization rules">
              <Toggle
                label="Level 4 must use a designated specialty pharmacy"
                value={draft.specialtyChannelRestricted}
                baseline={baseline.specialtyChannelRestricted}
                onChange={(v) => set("specialtyChannelRestricted", v)}
              />
              <Toggle
                label="Brand selection penalty on DAW 1"
                value={draft.dawPenaltyEnabled}
                baseline={baseline.dawPenaltyEnabled}
                onChange={(v) => set("dawPenaltyEnabled", v)}
              />
              <RangeField
                label="Refill-too-soon threshold"
                value={draft.refillThreshold}
                baseline={baseline.refillThreshold}
                onChange={(v) => set("refillThreshold", v)}
              />
              <TextField
                label="Remove prior authorization from"
                placeholder="drug name contains…"
                value={draft.paRemovedFor}
                onChange={(v) => set("paRemovedFor", v)}
              />
            </Group>

            <Group title="Contract terms">
              <Toggle
                label="Usual & customary caps the claim"
                hint="Turning this off models a contract that lets the plan pay more than the walk-in cash price."
                value={draft.includeUandC}
                baseline={baseline.includeUandC}
                onChange={(v) => set("includeUandC", v)}
              />
            </Group>
          </div>

          <div className="space-y-2.5 border-t border-ink-200/70 p-4">
            {dirty ? (
              <ul className="space-y-1">
                {changes.map((c) => (
                  <li
                    key={c}
                    className="flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-700"
                  >
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-glass-500" />
                    {c}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-ink-500">
                No changes staged. Move a lever, or pick one of the scenarios
                above.
              </p>
            )}
            <button
              onClick={run}
              disabled={!dirty || running}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 py-2.5 text-[13px] font-medium text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
            >
              {running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Re-adjudicating every claim…
                </>
              ) : (
                <>Model this change</>
              )}
            </button>
            <button
              onClick={() => project(draft)}
              disabled={!dirty || running || projecting}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-ink-600 transition hover:text-ink-900 disabled:cursor-not-allowed disabled:text-ink-300"
            >
              {projecting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Projecting…
                </>
              ) : (
                <>Quick projection instead</>
              )}
            </button>
          </div>
        </Card>

        {/* Results */}
        <div className="space-y-5">
          {projecting && !running ? (
            <Card>
              <div className="flex items-center justify-center gap-3 px-6 py-10 text-[13px] text-ink-600">
                <Loader2 className="h-4 w-4 animate-spin text-glass-600" />
                Projecting from {Math.round(PROJECTION_SAMPLE * 100)}% of members…
              </div>
            </Card>
          ) : null}

          {projection && !projecting && !running ? (
            <ProjectionPanel
              projection={projection}
              measured={result}
              onRunFull={run}
            />
          ) : null}

          {!result && !running && !projection && !projecting ? (
            <Card>
              <div className="px-6 py-14 text-center">
                <h3 className="text-[14px] font-semibold text-ink-900">
                  Nothing is estimated here
                </h3>
                <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-ink-600">
                  When you model a change, the engine re-adjudicates all{" "}
                  {formatNumber(39951)} stored claims against the new
                  configuration, in member and date order, rebuilding each
                  member&apos;s accumulators as it goes. You get the actual
                  effect on every claim, not a factor applied to a total.
                </p>
                <p className="mx-auto mt-3 max-w-lg text-[12.5px] text-ink-500">
                  Replaying with no change reproduces every stored claim to the
                  cent, which is how we know the difference you see is caused by
                  the change and nothing else.
                </p>
              </div>
            </Card>
          ) : null}

          {running ? (
            <Card>
              <div className="flex items-center justify-center gap-3 px-6 py-16 text-[13px] text-ink-600">
                <Loader2 className="h-4 w-4 animate-spin text-glass-600" />
                Re-adjudicating the full plan year…
              </div>
            </Card>
          ) : null}

          {result && !running ? (
            <Results
              result={result}
              changes={changes}
              onCommit={commit}
              committed={committed}
            />
          ) : null}

          {history.length > 0 ? (
            <Card>
              <CardHeader
                title="Change history"
                description="Every committed configuration is content-addressed, so a claim can always be replayed against the version it was adjudicated under."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Change</Th>
                    <Th align="right">Claims moved</Th>
                    <Th align="right">Plan</Th>
                    <Th align="right">Member</Th>
                    <Th align="right">Committed</Th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <Td>
                        <span className="font-medium text-ink-900">
                          {h.label}
                        </span>
                      </Td>
                      <Td align="right">{formatNumber(h.claimsChanged)}</Td>
                      <Td align="right">
                        <Delta cents={h.planCostDeltaCents} invert />
                      </Td>
                      <Td align="right">
                        <Delta cents={h.memberCostDeltaCents} invert />
                      </Td>
                      <Td align="right" className="text-[12px] text-ink-500">
                        {formatDate(h.createdAt)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Results({
  result,
  changes,
  onCommit,
  committed,
}: {
  result: ReplayResponse;
  changes: string[];
  onCommit: () => void;
  committed: string | null;
}) {
  const planDelta = result.planPaidAfterCents - result.planPaidBeforeCents;
  const memberDelta = result.memberPaidAfterCents - result.memberPaidBeforeCents;
  const total = planDelta + memberDelta;

  return (
    <>
      <Card>
        <CardHeader
          title="Change impact"
          description={`${formatNumber(result.claimsEvaluated)} claims re-adjudicated in ${(result.elapsedMs / 1000).toFixed(1)} seconds. ${formatNumber(result.claimsChanged)} of them came out differently.`}
          action={
            committed ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[12px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
                <Check className="h-3.5 w-3.5" />
                Committed · {committed.slice(0, 10)}
              </span>
            ) : (
              <button
                onClick={onCommit}
                className="rounded-lg bg-glass-600 px-3 py-2 text-[12.5px] font-medium text-white transition hover:bg-glass-700"
              >
                Commit this change
              </button>
            )
          }
        />
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Annual plan cost"
            value={<Delta cents={planDelta} invert big whole />}
            note={`${formatCents(result.planPaidBeforeCents)} to ${formatCents(result.planPaidAfterCents)}`}
          />
          <Metric
            label="Member out of pocket"
            value={<Delta cents={memberDelta} invert big whole />}
            note={`${formatCents(result.memberPaidBeforeCents)} to ${formatCents(result.memberPaidAfterCents)}`}
          />
          <Metric
            label="Members affected"
            value={
              <span className="tnum text-[22px] font-semibold text-ink-900">
                {formatNumber(result.membersAffected)}
              </span>
            }
            note={`${formatNumber(result.claimsChanged)} claims moved`}
          />
          <Metric
            label="Coverage changes"
            value={
              <span
                className={cn(
                  "tnum text-[22px] font-semibold",
                  result.newRejects > 0 ? "text-rose-700" : "text-ink-900",
                )}
              >
                {result.newRejects > 0
                  ? `${formatNumber(result.newRejects)} new rejects`
                  : result.newlyPaid > 0
                    ? `${formatNumber(result.newlyPaid)} newly paid`
                    : "none"}
              </span>
            }
            note={
              result.newRejects > 0
                ? "Claims that paid before and would not now"
                : "Claims that rejected before and would pay now"
            }
          />
        </div>
        <div className="border-t border-ink-200/70 px-5 py-3.5">
          <p className="text-[13px] leading-relaxed text-ink-700">
            {changes.join(" ")} Total cost of the fill moves{" "}
            {total >= 0 ? "up" : "down"} by{" "}
            <strong className="font-semibold">
              {formatCents(Math.abs(total))}
            </strong>{" "}
            across the plan year, and the split between the plan and its members
            moves as shown.
          </p>
        </div>
      </Card>

      {result.nps ? <MemberExperiencePanel nps={result.nps} /> : null}

      {result.newRejects > 0 ? (
        <Card className="border-rose-600/25 bg-rose-50/40">
          <div className="flex items-start gap-3 px-5 py-4">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <p className="text-[13px] leading-relaxed text-rose-950">
              {formatNumber(result.newRejects)} claims that paid under the
              current design would reject under this one. Those are members who
              would have been turned away at the counter. They are listed below
              and worth reading before committing.
            </p>
          </div>
        </Card>
      ) : null}

      {result.memberImpacts.length > 0 ? (
        <Card>
          <CardHeader
            title="Members most affected"
            description="Full plan-year out of pocket, before and after."
          />
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Before</Th>
                <Th align="right">After</Th>
                <Th align="right">Change</Th>
              </tr>
            </thead>
            <tbody>
              {result.memberImpacts.map((m) => (
                <tr key={m.memberId} className="group transition hover:bg-glass-50/40">
                  <Td>
                    <Link
                      href={`/members/${m.memberId}`}
                      className="font-medium text-ink-900 group-hover:text-glass-700"
                    >
                      {m.memberName}
                    </Link>
                  </Td>
                  <Td align="right">{m.claims}</Td>
                  <Td align="right">{formatCents(m.beforeCents)}</Td>
                  <Td align="right">{formatCents(m.afterCents)}</Td>
                  <Td align="right">
                    <Delta cents={m.deltaCents} invert />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {result.diffs.length > 0 ? (
        <Card>
          <CardHeader
            title="Claim-level diff"
            description="The largest movements, with a link to the full derivation of each claim as it stands today."
          />
          <Table>
            <thead>
              <tr>
                <Th>Claim</Th>
                <Th>Member</Th>
                <Th>Drug</Th>
                <Th align="center">Result</Th>
                <Th align="right">Plan</Th>
                <Th align="right">Member</Th>
              </tr>
            </thead>
            <tbody>
              {result.diffs.slice(0, 60).map((d) => (
                <tr key={d.claimId} className="group transition hover:bg-glass-50/40">
                  <Td>
                    <Link
                      href={`/claims/${d.claimId}`}
                      className="tnum text-[12.5px] font-medium text-ink-900 group-hover:text-glass-700"
                    >
                      {d.claimNumber}
                    </Link>
                    <span className="block text-[11px] text-ink-500">
                      {formatDate(d.dateOfService)} · Level {d.level}
                    </span>
                  </Td>
                  <Td className="text-[12.5px]">{d.memberName}</Td>
                  <Td>
                    <span className="line-clamp-1 max-w-[200px] text-[12.5px]">
                      {d.drugName}
                    </span>
                  </Td>
                  <Td align="center">
                    {d.kind === "newly-rejected" ? (
                      <Badge tone="negative">now rejects</Badge>
                    ) : d.kind === "newly-paid" ? (
                      <Badge tone="positive">now pays</Badge>
                    ) : (
                      <span className="text-[12px] text-ink-400">repriced</span>
                    )}
                  </Td>
                  <Td align="right">
                    <Delta cents={d.planDeltaCents} invert />
                  </Td>
                  <Td align="right">
                    <Delta cents={d.memberDeltaCents} invert />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function buildOverride(base: BaselineConfig, d: Draft): ConfigOverride {
  const o: ConfigOverride = {
    costShare: [
      { level: "1", copayCents: d.level1CopayCents },
      {
        level: "2",
        coinsuranceRateBps: d.level2RateBps,
        coinsuranceMaxCents: d.level2MaxCents,
      },
      {
        level: "3",
        coinsuranceRateBps: d.level3RateBps,
        coinsuranceMaxCents: d.level3MaxCents,
        accumulatesToRxOop: d.level3CountsToRxOop,
      },
      {
        level: "4",
        copayCents: d.level4CopayCents,
        accumulatesToRxOop: d.level4CountsToRxOop,
      },
    ],
    rxOopLimitIndividual: d.rxOopLimitCents,
    dawPenaltyEnabled: d.dawPenaltyEnabled,
    specialtyChannelRestricted: d.specialtyChannelRestricted,
    refillThreshold: d.refillThreshold,
  };
  const formulary: NonNullable<ConfigOverride["formulary"]> = [];
  if (d.paRemovedFor.trim())
    formulary.push({ nameContains: d.paRemovedFor.trim(), requiresPA: false });
  if (d.quantityLimitRemovedFor.trim())
    formulary.push({
      nameContains: d.quantityLimitRemovedFor.trim(),
      hasQuantityLimit: false,
    });
  if (d.stepTherapyRemovedFor.trim())
    formulary.push({
      nameContains: d.stepTherapyRemovedFor.trim(),
      requiresStep: false,
    });
  if (formulary.length > 0) o.formulary = formulary;
  if (d.includeUandC !== base.includeUandC) {
    o.lesserOfArms = d.includeUandC
      ? ["AWP_MINUS", "MAC", "UANDC", "SUBMITTED"]
      : ["AWP_MINUS", "MAC", "SUBMITTED"];
  }
  return o;
}

function describeChanges(b: BaselineConfig, d: Draft): string[] {
  const out: string[] = [];
  const m = (c: number) => formatCents(c);
  const p = (bps: number) => `${(bps / 100).toFixed(0)}%`;

  if (d.level1CopayCents !== b.level1CopayCents)
    out.push(`Level 1 copay ${m(b.level1CopayCents)} to ${m(d.level1CopayCents)}.`);
  if (d.level2RateBps !== b.level2RateBps)
    out.push(`Level 2 coinsurance ${p(b.level2RateBps)} to ${p(d.level2RateBps)}.`);
  if (d.level2MaxCents !== b.level2MaxCents)
    out.push(`Level 2 per-fill maximum ${m(b.level2MaxCents)} to ${m(d.level2MaxCents)}.`);
  if (d.level3RateBps !== b.level3RateBps)
    out.push(`Level 3 coinsurance ${p(b.level3RateBps)} to ${p(d.level3RateBps)}.`);
  if (d.level3MaxCents !== b.level3MaxCents)
    out.push(`Level 3 per-fill maximum ${m(b.level3MaxCents)} to ${m(d.level3MaxCents)}.`);
  if (d.level4CopayCents !== b.level4CopayCents)
    out.push(`Level 4 copay ${m(b.level4CopayCents)} to ${m(d.level4CopayCents)}.`);
  if (d.rxOopLimitCents !== b.rxOopLimitCents)
    out.push(
      `Prescription out-of-pocket limit ${m(b.rxOopLimitCents)} to ${m(d.rxOopLimitCents)}.`,
    );
  if (d.level3CountsToRxOop !== b.level3CountsToRxOop)
    out.push(
      d.level3CountsToRxOop
        ? "Level 3 cost share now counts toward the prescription out-of-pocket limit."
        : "Level 3 cost share no longer counts toward the prescription out-of-pocket limit.",
    );
  if (d.level4CountsToRxOop !== b.level4CountsToRxOop)
    out.push(
      d.level4CountsToRxOop
        ? "Level 4 cost share now counts toward the prescription out-of-pocket limit."
        : "Level 4 cost share no longer counts toward the prescription out-of-pocket limit.",
    );
  if (d.specialtyChannelRestricted !== b.specialtyChannelRestricted)
    out.push(
      d.specialtyChannelRestricted
        ? "Level 4 drugs restricted to designated specialty pharmacies."
        : "Level 4 drugs may be filled at any network pharmacy.",
    );
  if (d.dawPenaltyEnabled !== b.dawPenaltyEnabled)
    out.push(
      d.dawPenaltyEnabled
        ? "Brand selection penalty on."
        : "Brand selection penalty removed.",
    );
  if (d.refillThreshold !== b.refillThreshold)
    out.push(
      `Refill-too-soon threshold ${Math.round(b.refillThreshold * 100)}% to ${Math.round(d.refillThreshold * 100)}%.`,
    );
  if (d.includeUandC !== b.includeUandC)
    out.push(
      d.includeUandC
        ? "Usual & customary restored to the lesser-of."
        : "Usual & customary removed from the lesser-of comparison.",
    );
  if (d.paRemovedFor.trim())
    out.push(`Prior authorization removed from drugs matching "${d.paRemovedFor.trim()}".`);
  if (d.quantityLimitRemovedFor.trim())
    out.push(
      `Quantity limit lifted on drugs matching "${d.quantityLimitRemovedFor.trim()}".`,
    );
  if (d.stepTherapyRemovedFor.trim())
    out.push(
      `Step therapy removed from drugs matching "${d.stepTherapyRemovedFor.trim()}".`,
    );
  return out;
}

// ---------------------------------------------------------------------------
// Small controls

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3.5">
      <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-400">
        {title}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function FieldShell({
  label,
  hint,
  changed,
  children,
}: {
  label: string;
  hint?: string;
  changed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-[12.5px] leading-snug text-ink-700">
          {label}
          {changed ? (
            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-glass-500 align-middle" />
          ) : null}
        </label>
        {children}
      </div>
      {hint ? (
        <p className="mt-0.5 max-w-[300px] text-[11px] leading-snug text-ink-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function MoneyField({
  label,
  value,
  baseline,
  onChange,
}: {
  label: string;
  value: number;
  baseline: number;
  onChange: (v: number) => void;
}) {
  return (
    <FieldShell label={label} changed={value !== baseline}>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-ink-400">
          $
        </span>
        <input
          type="number"
          min={0}
          step={1}
          value={value / 100}
          onChange={(e) => onChange(Math.round(Number(e.target.value) * 100))}
          className={cn(
            "tnum w-[92px] rounded-md border border-ink-200 bg-white py-1 pl-5 pr-1.5 text-right text-[12.5px] outline-none focus:border-glass-400 focus:ring-2 focus:ring-glass-100",
            value !== baseline && "border-glass-400 bg-glass-50/70",
          )}
        />
      </div>
    </FieldShell>
  );
}

function PercentField({
  label,
  value,
  baseline,
  onChange,
}: {
  label: string;
  value: number;
  baseline: number;
  onChange: (v: number) => void;
}) {
  return (
    <FieldShell label={label} changed={value !== baseline}>
      <div className="relative">
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={value / 100}
          onChange={(e) => onChange(Math.round(Number(e.target.value) * 100))}
          className={cn(
            "tnum w-[92px] rounded-md border border-ink-200 bg-white py-1 pl-2 pr-5 text-right text-[12.5px] outline-none focus:border-glass-400 focus:ring-2 focus:ring-glass-100",
            value !== baseline && "border-glass-400 bg-glass-50/70",
          )}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-ink-400">
          %
        </span>
      </div>
    </FieldShell>
  );
}

function RangeField({
  label,
  value,
  baseline,
  onChange,
}: {
  label: string;
  value: number;
  baseline: number;
  onChange: (v: number) => void;
}) {
  return (
    <FieldShell label={label} changed={value !== baseline}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={50}
          max={95}
          step={5}
          value={Math.round(value * 100)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="w-[64px] accent-glass-600"
        />
        <span className="tnum w-[34px] text-right text-[12.5px] text-ink-700">
          {Math.round(value * 100)}%
        </span>
      </div>
    </FieldShell>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell label={label} changed={value.trim().length > 0}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-[130px] rounded-md border border-ink-200 bg-white px-2 py-1 text-[12.5px] outline-none placeholder:text-ink-300 focus:border-glass-400 focus:ring-2 focus:ring-glass-100",
          value.trim() && "border-glass-400 bg-glass-50/70",
        )}
      />
    </FieldShell>
  );
}

function Toggle({
  label,
  hint,
  value,
  baseline,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  baseline: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <FieldShell label={label} hint={hint} changed={value !== baseline}>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          "relative h-[18px] w-8 shrink-0 rounded-full transition",
          value ? "bg-glass-600" : "bg-ink-300",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all",
            value ? "left-[16px]" : "left-[2px]",
          )}
        />
      </button>
    </FieldShell>
  );
}

/**
 * The answer available in six seconds rather than thirty.
 *
 * The same engine over a fixed sixth of the members, which makes this an
 * understatement of confidence rather than a different sort of claim. One thing
 * has to be said carefully, and the panel says it: the sampled *level* is not
 * the book's level, because a sixth of the members is a slightly different
 * population. The sampled *movement* is reliable, because it is the same people
 * scored twice and whatever makes the sample unrepresentative is present on
 * both sides and cancels. So only the movement is shown.
 */
function ProjectionPanel({
  projection,
  measured,
  onRunFull,
}: {
  projection: ReplayResponse;
  measured: ReplayResponse | null;
  onRunFull: () => void;
}) {
  const share = projection.sampleRate > 0 ? 1 / projection.sampleRate : 1;

  /*
   * Rounded to the nearest thousand dollars.
   *
   * A figure multiplied by seven to stand in for members who were never looked
   * at does not know its own value to the cent, and printing it that way
   * invites exactly the misreading the rest of the panel is trying to prevent.
   * The measured run keeps its pennies because it has earned them.
   */
  const scaled = (before: number, after: number) =>
    Math.round(((after - before) * share) / 100_000) * 100_000;

  const planDelta = scaled(
    projection.planPaidBeforeCents,
    projection.planPaidAfterCents,
  );
  const memberDelta = scaled(
    projection.memberPaidBeforeCents,
    projection.memberPaidAfterCents,
  );

  const npsDelta = projection.nps
    ? Math.round(
        (projection.nps.after.census.nps - projection.nps.before.census.nps) *
          10,
      ) / 10
    : null;

  const measuredDelta =
    measured?.nps
      ? Math.round(
          (measured.nps.after.census.nps - measured.nps.before.census.nps) * 10,
        ) / 10
      : null;

  return (
    <Card className="border-glass-500/30">
      <CardHeader
        title="Projected"
        description={`Run against ${formatNumber(projection.nps?.before.census.scored ?? 0)} members, one in ${Math.round(share)}, in ${(projection.elapsedMs / 1000).toFixed(1)} seconds. The same engine on a smaller book.`}
        action={
          <button
            onClick={onRunFull}
            className="rounded-lg bg-ink-900 px-3 py-2 text-[12.5px] font-medium text-white transition hover:bg-ink-800"
          >
            Measure it properly
          </button>
        }
      />
      <div className="grid gap-px bg-ink-200/60 sm:grid-cols-3">
        <Metric
          label="Member experience"
          value={
            npsDelta === null ? (
              <span className="text-[22px] font-semibold text-ink-400">—</span>
            ) : (
              <span
                className={cn(
                  "tnum text-[22px] font-semibold",
                  Math.abs(npsDelta) <= 0.1
                    ? "text-ink-900"
                    : npsDelta > 0
                      ? "text-emerald-700"
                      : "text-rose-700",
                )}
              >
                {Math.abs(npsDelta) <= 0.1
                  ? "no change"
                  : `${npsDelta > 0 ? "+" : "−"}${Math.abs(npsDelta).toFixed(1)}`}
              </span>
            )
          }
          note="NPS points, ±0.2 against a full run"
        />
        <Metric
          label="Annual plan cost"
          value={<Delta cents={planDelta} invert big whole />}
          note="Scaled from the sample, to the nearest thousand"
        />
        <Metric
          label="Member out of pocket"
          value={<Delta cents={memberDelta} invert big whole />}
          note="Scaled from the sample, to the nearest thousand"
        />
      </div>
      <div className="border-t border-ink-200/70 px-5 py-3.5">
        <p className="text-[13px] leading-relaxed text-ink-700">
          {measuredDelta !== null && npsDelta !== null ? (
            <>
              The full run came back at{" "}
              <strong className="font-semibold">
                {measuredDelta > 0 ? "+" : ""}
                {measuredDelta.toFixed(1)}
              </strong>
              , against a projection of {npsDelta > 0 ? "+" : ""}
              {npsDelta.toFixed(1)}. The projection is shown next to the
              measurement rather than replaced by it, because a shortcut nobody
              ever checks is a shortcut nobody should trust.
            </>
          ) : (
            <>
              These are estimates. The money is scaled up from the sample and
              carries the sampling error with it; the experience figure is a
              movement rather than a level, which is the part sampling gets
              right, because it is the same members scored on both sides.
              Nothing here can be committed — press{" "}
              <strong className="font-semibold">measure it properly</strong> to
              re-adjudicate the whole book.
            </>
          )}
        </p>
      </div>
    </Card>
  );
}

/**
 * What the change costs the people it happens to.
 *
 * Sits directly beneath the money on purpose. Every lever on this page has a
 * member on the other end of it, and a saving is only a saving if you are
 * willing to say what it was bought with. The figure is modelled rather than
 * surveyed, which the panel says plainly rather than in a footnote.
 */
function MemberExperiencePanel({
  nps,
}: {
  nps: NonNullable<ReplayResponse["nps"]>;
}) {
  const before = nps.before.census;
  const after = nps.after.census;
  const delta = Math.round((after.nps - before.nps) * 10) / 10;
  const detractorDelta = after.detractors - before.detractors;

  // A tenth of a point on ninety thousand members is noise from rounding, not
  // a finding. Anything at or under it is reported as no movement.
  const moved = Math.abs(delta) > 0.1;

  return (
    <Card>
      <CardHeader
        title="Member impact"
        description="Every member's full plan year, scored against the published schedule, before and after the change. Nobody was surveyed."
        action={
          <Link
            href="/experience"
            className="text-[12.5px] font-medium text-glass-700 hover:text-glass-800"
          >
            The schedule
          </Link>
        }
      />
      <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="Modelled NPS"
          value={
            <span
              className={cn(
                "tnum text-[22px] font-semibold",
                !moved
                  ? "text-ink-900"
                  : delta > 0
                    ? "text-emerald-700"
                    : "text-rose-700",
              )}
            >
              {!moved
                ? "no change"
                : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`}
            </span>
          }
          note={`${before.nps.toFixed(1)} to ${after.nps.toFixed(1)}`}
        />
        <Metric
          label="Detractors"
          value={
            <span
              className={cn(
                "tnum text-[22px] font-semibold",
                detractorDelta === 0
                  ? "text-ink-900"
                  : detractorDelta > 0
                    ? "text-rose-700"
                    : "text-emerald-700",
              )}
            >
              {detractorDelta === 0
                ? "no change"
                : `${detractorDelta > 0 ? "+" : "−"}${formatNumber(Math.abs(detractorDelta))}`}
            </span>
          }
          note={`${formatNumber(before.detractors)} to ${formatNumber(after.detractors)} members scoring 6 or below`}
        />
        <Metric
          label="Promoters"
          value={
            <span
              className={cn(
                "tnum text-[22px] font-semibold",
                after.promoters === before.promoters
                  ? "text-ink-900"
                  : after.promoters > before.promoters
                    ? "text-emerald-700"
                    : "text-rose-700",
              )}
            >
              {after.promoters === before.promoters
                ? "no change"
                : `${after.promoters > before.promoters ? "+" : "−"}${formatNumber(Math.abs(after.promoters - before.promoters))}`}
            </span>
          }
          note={`${formatNumber(before.promoters)} to ${formatNumber(after.promoters)} members scoring 9 or 10`}
        />
      </div>
      <div className="border-t border-ink-200/70 px-5 py-3.5">
        <p className="text-[13px] leading-relaxed text-ink-700">
          {!moved ? (
            <>
              This change does not move member experience. It shifts money
              without changing what anybody is told at a counter, waits for, or
              pays enough to notice.
            </>
          ) : delta < 0 ? (
            <>
              This change makes the benefit worse for the people using it, by{" "}
              <strong className="font-semibold">
                {Math.abs(delta).toFixed(1)} points
              </strong>
              . Whatever it saves, that is what it is being bought with.
            </>
          ) : (
            <>
              This change makes the benefit better for the people using it, by{" "}
              <strong className="font-semibold">
                {delta.toFixed(1)} points
              </strong>
              . If it also costs money, that is the price of the improvement.
            </>
          )}{" "}
          Scored across {formatNumber(before.scored)} members over the whole
          plan year, on the same basis as the money above. The{" "}
          <Link
            href="/experience"
            className="font-medium text-glass-700 hover:text-glass-900"
          >
            member experience page
          </Link>{" "}
          reads higher against the year so far, because a year that is only
          part run has had fewer chances to go wrong. Compare the movement
          here, not the level.
        </p>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note: string;
}) {
  return (
    <div className="bg-white px-5 py-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
        {label}
      </div>
      <div className="mt-1">{value}</div>
      <p className="mt-1 text-[11.5px] leading-snug text-ink-500">{note}</p>
    </div>
  );
}

function Delta({
  cents,
  invert,
  big,
  whole,
}: {
  cents: number;
  /** Cost going down is good, so invert the colour of the sign. */
  invert?: boolean;
  big?: boolean;
  /**
   * Drop the pennies. For figures scaled up from a sample, where two decimal
   * places on a number rounded to the nearest thousand claims a precision the
   * measurement does not have.
   */
  whole?: boolean;
}) {
  if (cents === 0)
    return <span className="tnum text-ink-400">{big ? "no change" : "—"}</span>;
  const good = invert ? cents < 0 : cents > 0;
  return (
    <span
      className={cn(
        "tnum font-semibold",
        big ? "text-[22px]" : "text-[13px]",
        good ? "text-emerald-700" : "text-rose-700",
      )}
    >
      {cents > 0 ? "+" : "−"}
      {whole ? formatCentsWhole(Math.abs(cents)) : formatCents(Math.abs(cents))}
    </span>
  );
}
