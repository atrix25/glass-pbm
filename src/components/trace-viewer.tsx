"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStage, TraceStepInput } from "@/lib/engine/types";

export interface TraceSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
}

const STAGE_ORDER: PipelineStage[] = [
  "eligibility",
  "coverage",
  "um",
  "pricing",
  "costshare",
  "rebate",
  "pa",
];

const STAGE_META: Record<PipelineStage, { label: string; question: string }> = {
  eligibility: {
    label: "Eligibility",
    question: "Is this person covered under this plan on the fill date?",
  },
  coverage: {
    label: "Coverage",
    question: "Is this drug covered, and at what benefit level?",
  },
  um: {
    label: "Utilization management",
    question:
      "Quantity limits, diagnosis restrictions, refill timing, prior authorization, step therapy.",
  },
  pricing: {
    label: "Pricing",
    question: "Which benchmark set the price, and what did the pharmacy receive?",
  },
  costshare: {
    label: "Member cost share",
    question: "What does the member owe, and which limits does it count toward?",
  },
  rebate: {
    label: "Rebate",
    question: "Does this claim earn a manufacturer rebate, and who keeps it?",
  },
  pa: { label: "Prior authorization", question: "Traversal of published criteria." },
};

export function TraceViewer({
  steps,
  sources,
  defaultOpenStages = ["pricing", "costshare"],
}: {
  steps: TraceStepInput[];
  sources: Record<string, TraceSource>;
  defaultOpenStages?: PipelineStage[];
}) {
  const [open, setOpen] = useState<Set<string>>(
    new Set(defaultOpenStages as string[]),
  );
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    steps: steps.filter((s) => s.stage === stage),
  })).filter((g) => g.steps.length > 0);

  const toggle = (stage: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  return (
    <div className="divide-y divide-ink-200/70">
      <div className="flex items-center justify-between px-5 py-2.5">
        <span className="text-[12px] text-ink-500">
          {steps.length} rules evaluated,{" "}
          {steps.filter((s) => s.fired).length} of which changed the outcome
        </span>
        <div className="flex gap-2 text-[12px]">
          <button
            onClick={() => setOpen(new Set(byStage.map((g) => g.stage)))}
            className="font-medium text-glass-700 hover:text-glass-900"
          >
            Expand all
          </button>
          <span className="text-ink-300">/</span>
          <button
            onClick={() => setOpen(new Set())}
            className="font-medium text-ink-500 hover:text-ink-800"
          >
            Collapse
          </button>
        </div>
      </div>

      {byStage.map(({ stage, steps: stageSteps }) => {
        const isOpen = open.has(stage);
        const fired = stageSteps.filter((s) => s.fired).length;
        return (
          <div key={stage}>
            <button
              onClick={() => toggle(stage)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-ink-50/70"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-ink-400 transition-transform",
                  !isOpen && "-rotate-90",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-semibold text-ink-900">
                    {STAGE_META[stage].label}
                  </span>
                  <span className="tnum text-[11.5px] text-ink-400">
                    {stageSteps.length} rule{stageSteps.length === 1 ? "" : "s"}
                    {fired ? `, ${fired} fired` : ""}
                  </span>
                </div>
                {!isOpen ? (
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-500">
                    {stageSteps.find((s) => s.fired)?.detail ??
                      STAGE_META[stage].question}
                  </p>
                ) : null}
              </div>
            </button>

            {isOpen ? (
              <ol className="space-y-px bg-ink-100/50 px-5 pb-4">
                {stageSteps.map((step, i) => {
                  const key = `${stage}-${i}`;
                  const expanded = expandedStep === key;
                  const source = step.sourceDocumentId
                    ? sources[step.sourceDocumentId]
                    : undefined;
                  return (
                    <li
                      key={key}
                      className={cn(
                        "rounded-lg border bg-white transition",
                        step.fired
                          ? "border-glass-300/70"
                          : "border-ink-200/70",
                      )}
                    >
                      <button
                        onClick={() => setExpandedStep(expanded ? null : key)}
                        className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left"
                      >
                        <span
                          className={cn(
                            "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                            step.fired
                              ? "bg-glass-100 text-glass-700"
                              : "bg-ink-100 text-ink-400",
                          )}
                        >
                          {step.fired ? (
                            <Zap className="h-2.5 w-2.5" fill="currentColor" />
                          ) : (
                            <span className="h-1 w-1 rounded-full bg-current" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-ink-900">
                            {step.question}
                          </p>
                          {step.detail ? (
                            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-600">
                              {step.detail}
                            </p>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <code className="rounded bg-ink-100 px-1 py-px font-mono text-[10.5px] text-ink-500">
                              {step.ruleId}
                            </code>
                            {source ? (
                              <span className="text-[11px] text-ink-400">
                                {source.publisher}
                              </span>
                            ) : (
                              <span className="text-[11px] text-ink-400">
                                internal computation
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronDown
                          className={cn(
                            "mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300 transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                      </button>

                      {expanded ? (
                        <div className="animate-fade-up space-y-3 border-t border-ink-100 px-3.5 py-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <KeyValues title="Inputs read" data={step.inputs} />
                            <KeyValues title="Output" data={step.output} />
                          </div>
                          {step.citation ? (
                            <div className="rounded-lg border-l-2 border-glass-400 bg-glass-50/60 px-3 py-2">
                              <p className="text-[12px] leading-relaxed text-ink-700">
                                {step.citation}
                              </p>
                              {source ? (
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-glass-700 hover:text-glass-900"
                                >
                                  {source.title}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function KeyValues({ title, data }: { title: string; data: unknown }) {
  const entries =
    data && typeof data === "object" && !Array.isArray(data)
      ? Object.entries(data as Record<string, unknown>)
      : [["value", data] as [string, unknown]];

  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        {title}
      </div>
      <dl className="space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 font-mono text-[11px] text-ink-500">{k}</dt>
            <dd className="tnum min-w-0 break-words text-right font-mono text-[11px] text-ink-800">
              {renderValue(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
