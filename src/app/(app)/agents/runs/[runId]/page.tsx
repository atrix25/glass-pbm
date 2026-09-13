import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardHeader,
  SectionTitle,
  Stat,
} from "@/components/ui";
import { ProposalReview } from "@/components/proposal-review";
import { getRun, type StepRow } from "@/lib/queries/agents";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KIND_TONE: Record<string, "neutral" | "accent" | "warn" | "positive" | "negative"> =
  {
    Think: "accent",
    Tool: "neutral",
    Evidence: "positive",
    Proposal: "positive",
    Gate: "warn",
    Refusal: "negative",
  };

const KIND_LABEL: Record<string, string> = {
  Think: "Judgement",
  Tool: "Tool call",
  Evidence: "Evidence",
  Proposal: "Proposal",
  Gate: "Held for a person",
  Refusal: "Declined",
};

export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();

  const subjectHref = subjectLink(run.subjectType, run.subjectId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/agents/${run.agent.id}`}
          className="text-[12.5px] text-glass-700 hover:text-glass-900"
        >
          ← {run.agent.name}
        </Link>
      </div>

      <SectionTitle description={run.goal}>
        Run {run.id.slice(0, 8)}
      </SectionTitle>

      <Card>
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Outcome"
            value={
              <Badge
                tone={
                  run.outcome === "Completed"
                    ? "positive"
                    : run.outcome === "Escalated"
                      ? "warn"
                      : "neutral"
                }
              >
                {run.outcome}
              </Badge>
            }
            sub={formatDateTime(run.startedAt)}
          />
          <Stat
            label="Took"
            value={`${formatNumber(run.elapsedMs)} ms`}
            sub={`${run.steps.length} steps`}
          />
          <Stat
            label="Reasoned by"
            value={run.brain === "model" ? (run.modelName ?? "model") : run.brain}
            sub={
              run.brain === "deterministic"
                ? "The agent's scripted planner. No model call was made."
                : `${formatNumber(run.inputTokens + run.outputTokens)} tokens`
            }
          />
          <Stat
            label="Autonomy in force"
            value={run.autonomy}
            sub="Copied onto the run, so later policy changes cannot rewrite it"
          />
        </div>
        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-700">{run.summary}</p>
          {subjectHref ? (
            <p className="mt-2 text-[12.5px] text-ink-600">
              About{" "}
              <Link href={subjectHref} className="text-glass-700 hover:text-glass-900">
                {run.subjectType} {run.subjectId}
              </Link>
              .
            </p>
          ) : null}
        </div>
      </Card>

      {run.proposals.map((p) => (
        <Card key={p.id}>
          <CardHeader
            title={p.consequential ? "Held for a person" : "Proposal"}
            description={
              p.consequential
                ? "This action would move money or deny care, so the runtime refused to apply it automatically at any autonomy level."
                : p.autoApplied
                  ? "Applied under the autonomy in force at the time, and reversible by a person."
                  : "Written for a person to decide."
            }
            action={
              <Badge tone={p.consequential ? "warn" : p.autoApplied ? "positive" : "neutral"}>
                {p.status}
              </Badge>
            }
          />
          <div className="px-5 py-4">
            <p className="text-[13.5px] font-medium text-ink-900">{p.headline}</p>
            <p className="mt-2 max-w-4xl text-[13px] leading-relaxed text-ink-700">
              {p.rationale}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-ink-600">
              <span>
                Action <code className="rounded bg-ink-100 px-1 py-0.5">{p.action}</code>
              </span>
              <span>Confidence {(p.confidenceBps / 100).toFixed(0)}%</span>
            </div>
            {p.overrideNote ? (
              <div className="mt-3 rounded-lg border border-rose-300/60 bg-rose-50/60 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-rose-900">
                  Reversed by a person
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-rose-950">
                  {p.overrideNote}
                </p>
              </div>
            ) : null}
            {p.executionStatus ? (
              <div className="mt-3 rounded-lg border border-ink-200 bg-white px-4 py-3 text-[12.5px] text-ink-700">
                <span className="font-semibold">Execution receipt:</span>{" "}
                {p.executionStatus}
                {p.executionError ? ` — ${p.executionError}` : ""}
                {p.executionResult ? <Payload json={p.executionResult} /> : null}
              </div>
            ) : null}
            <ProposalReview proposalId={p.id} status={p.status} />
            <Payload json={p.payload} />
          </div>
        </Card>
      ))}

      <Card>
        <CardHeader
          title="What it did, in order"
          description="Every step records why it happened before it happened, what came back, and which brain produced it. A step marked as a tool call can be re-run by hand from the arguments below."
        />
        <ol className="divide-y divide-ink-100">
          {run.steps.map((s) => (
            <Step key={s.ordinal} step={s} />
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Step({ step }: { step: StepRow }) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tnum inline-flex h-5 w-5 items-center justify-center rounded bg-ink-100 text-[11px] font-semibold text-ink-700">
          {step.ordinal}
        </span>
        <Badge tone={KIND_TONE[step.kind] ?? "neutral"}>
          {KIND_LABEL[step.kind] ?? step.kind}
        </Badge>
        {step.tool ? (
          <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[11.5px] text-ink-800">
            {step.tool}
          </code>
        ) : null}
        {step.elapsedMs > 0 ? (
          <span className="tnum text-[11.5px] text-ink-500">{step.elapsedMs} ms</span>
        ) : null}
        {step.brain === "model" ? (
          <Badge tone="accent">model</Badge>
        ) : null}
      </div>
      <p className="mt-2 max-w-4xl text-[12.5px] leading-relaxed text-ink-600">
        {step.because}
      </p>
      <p className="mt-1.5 text-[13px] font-medium text-ink-900">{step.summary}</p>
      <Payload json={step.detail} />
    </li>
  );
}

function Payload({ json }: { json: string }) {
  if (!json || json === "{}") return null;
  let pretty = json;
  try {
    pretty = JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    /* leave as-is */
  }
  if (pretty.length < 3) return null;
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer text-[12px] text-ink-500 transition hover:text-ink-700">
        Raw data
      </summary>
      <pre className="scroll-thin mt-2 max-h-80 overflow-auto rounded-lg bg-ink-50 p-3 text-[11.5px] leading-relaxed text-ink-700">
        {pretty}
      </pre>
    </details>
  );
}

function subjectLink(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "PriorAuthorization":
      return `/pa/${id}`;
    case "IntegritySignal":
      return "/integrity";
    case "EligibilityTransaction":
      return "/eligibility";
    case "MacAppeal":
      return "/mac";
    case "PlanDesign":
      return "/trends";
    default:
      return null;
  }
}
