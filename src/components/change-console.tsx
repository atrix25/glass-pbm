"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Loader2,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { formatCents } from "@/lib/money";
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
  paRemovedFor: string;
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
  elapsedMs: number;
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

export function ChangeConsole({
  baseline,
  history,
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
}) {
  const initial: Draft = { ...baseline, paRemovedFor: "" };
  const [draft, setDraft] = useState<Draft>(initial);
  const [result, setResult] = useState<ReplayResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [committed, setCommitted] = useState<string | null>(null);
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);

  const changes = describeChanges(baseline, draft);
  const dirty = changes.length > 0;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setResult(null);
    setCommitted(null);
  };

  const reset = () => {
    setDraft(initial);
    setResult(null);
    setCommitted(null);
    setAppliedPreset(null);
  };

  const run = async () => {
    setRunning(true);
    setCommitted(null);
    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOverride(baseline, draft)),
      });
      setResult((await res.json()) as ReplayResponse);
    } finally {
      setRunning(false);
    }
  };

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
      }),
    });
    const json = (await res.json()) as { contentHash: string };
    setCommitted(json.contentHash);
  };

  return (
    <div className="space-y-5">
      {/* Presets */}
      <Card>
        <CardHeader
          title="Changes a plan sponsor actually asks for"
          description="Pick one, or set the levers by hand below. Nothing is saved until you commit."
        />
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setDraft({ ...initial, ...p.apply(baseline) });
                setResult(null);
                setCommitted(null);
                setAppliedPreset(p.id);
              }}
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
          </div>
        </Card>

        {/* Results */}
        <div className="space-y-5">
          {!result && !running ? (
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
          title="What this change does"
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
            value={<Delta cents={planDelta} invert big />}
            note={`${formatCents(result.planPaidBeforeCents)} to ${formatCents(result.planPaidAfterCents)}`}
          />
          <Metric
            label="Member out of pocket"
            value={<Delta cents={memberDelta} invert big />}
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
  if (d.paRemovedFor.trim()) {
    o.formulary = [{ nameContains: d.paRemovedFor.trim(), requiresPA: false }];
  }
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
}: {
  cents: number;
  /** Cost going down is good, so invert the colour of the sign. */
  invert?: boolean;
  big?: boolean;
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
      {formatCents(Math.abs(cents))}
    </span>
  );
}
