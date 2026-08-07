"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Citation {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  locator?: string;
}

interface WorkStep {
  tool: string;
  because: string;
  args: unknown;
  error: string | null;
  summary: string | null;
  data: unknown;
  citations: Citation[];
  followUp: boolean;
}

interface Answer {
  question: string;
  intent: string;
  paragraphs: string[];
  citations: Citation[];
  links: { label: string; href: string }[];
  briefingMarkdown: string | null;
  handoff: string | null;
  work: WorkStep[];
  runId: string;
  autonomy: string;
  elapsedMs: number;
}

interface Turn {
  question: string;
  answer: Answer | null;
}

const TOOL_LABEL: Record<string, string> = {
  getBookSnapshot: "Read the book snapshot",
  getContractReports: "Pull contract report sections",
  getTrendDrivers: "Compute the PMPM trend bridge",
  getTopSpend: "Rank top drugs and classes",
  getSettlementSnapshot: "Read settlement and receivables",
  getGuaranteeScorecard: "Read the operational scorecard",
  getHighCostDrugUm: "List UM rules on top-spend drugs",
  searchFormularyUm: "Search the formulary UM index",
  getPriorAuthOverview: "Read PA queue and determinations",
  getMacOverview: "Read MAC list and appeals",
  getMemberExperience: "Compute census NPS and drivers",
  getIntegrityOverview: "Read program integrity signals",
  getRejectOverview: "Summarize claim reject codes",
  getClinicalOverview: "Read clinical alert screening",
  getEligibilityOverview: "Read eligibility feed status",
  lookupClaims: "Search the claim ledger",
  getClaimDetail: "Open one claim's derivation",
  composeReportBriefing: "Compose a report briefing",
};

export function DataAgent({ suggestions }: { suggestions: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setTurns((t) => [...t, { question: q, answer: null }]);
    try {
      const res = await fetch("/api/data-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const answer = (await res.json()) as Answer;
      setTurns((t) =>
        t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)),
      );
    } finally {
      setBusy(false);
    }
  }

  const last = turns.at(-1)?.answer ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex h-[calc(100vh-172px)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-ink-200 bg-white">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
          {turns.length === 0 ? (
            <Welcome suggestions={suggestions} onPick={send} />
          ) : (
            <div className="space-y-6">
              {turns.map((turn, i) => (
                <Exchange key={i} turn={turn} />
              ))}
              {busy ? (
                <div className="flex items-center gap-2 text-[13px] text-ink-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Querying the claim ledger and contract reports
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="border-t border-ink-200 bg-ink-50/40 px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Ask about the book, guarantees, rebates, trends…"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[13.5px] leading-relaxed text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-glass-500 focus:ring-2 focus:ring-glass-500/15"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-white transition hover:bg-ink-800 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
          {turns.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.slice(0, 3).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={busy}
                  className="truncate rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11.5px] text-ink-600 transition hover:border-glass-400 hover:text-glass-800 disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <WorkPanel answer={last} busy={busy} />
    </div>
  );
}

function Welcome({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (q: string) => void;
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-glass-600">
          <Sparkles className="h-4.5 w-4.5 text-white" />
        </div>
        <h2 className="mt-4 text-[19px] font-semibold tracking-tight text-ink-900">
          Data agent for the plan book
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">
          Ask for totals, contract reports, trend drivers, or a composed
          briefing. Every figure is returned by a query over the claim ledger —
          the same numbers as the sponsor and reports pages. The panel on the
          right shows each tool call.
        </p>
        <div className="mt-6 space-y-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-left text-[13px] text-ink-700 transition hover:border-glass-400 hover:bg-glass-50/50 hover:text-ink-900"
            >
              <span>{s}</span>
              <ArrowUp className="h-3.5 w-3.5 shrink-0 rotate-45 text-ink-300" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Exchange({ turn }: { turn: Turn }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-ink-900 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white">
          {turn.question}
        </div>
      </div>
      {turn.answer ? (
        <div className="max-w-[92%]">
          <div className="space-y-3 rounded-2xl rounded-bl-md bg-ink-50 px-4 py-3.5">
            {turn.answer.paragraphs.map((p, i) =>
              p === "——" ? (
                <hr key={i} className="border-ink-200" />
              ) : p.startsWith("#") ? (
                <p
                  key={i}
                  className="text-[13px] font-semibold leading-relaxed text-ink-900"
                >
                  {p.replace(/^#+\s*/, "")}
                </p>
              ) : (
                <p
                  key={i}
                  className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-800"
                >
                  {p}
                </p>
              ),
            )}
          </div>

          {turn.answer.links.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {turn.answer.links.map((l) => (
                <Link
                  key={l.href + l.label}
                  href={l.href}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink-700 transition hover:border-glass-400 hover:text-glass-800"
                >
                  {l.label}
                  <ArrowUp className="h-3 w-3 rotate-45" />
                </Link>
              ))}
            </div>
          ) : null}

          {turn.answer.citations.length > 0 ? (
            <div className="mt-2.5 space-y-1">
              {turn.answer.citations.map((c) => (
                <a
                  key={c.sourceId + (c.locator ?? "")}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-1.5 text-[11.5px] leading-snug text-ink-500 transition hover:text-glass-700"
                >
                  <FileText className="mt-[1px] h-3 w-3 shrink-0" />
                  <span>
                    <span className="font-medium text-ink-600 group-hover:text-glass-700">
                      {c.title}
                    </span>
                    {c.locator ? (
                      <span className="text-ink-500"> — {c.locator}</span>
                    ) : null}
                  </span>
                  <ExternalLink className="mt-[2px] h-2.5 w-2.5 shrink-0 opacity-0 transition group-hover:opacity-60" />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkPanel({ answer, busy }: { answer: Answer | null; busy: boolean }) {
  return (
    <aside className="hidden h-[calc(100vh-172px)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-ink-200 bg-white lg:flex">
      <div className="border-b border-ink-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-ink-400" />
          <h3 className="text-[12.5px] font-semibold text-ink-900">
            What the agent did
          </h3>
          {answer ? (
            <span className="tnum ml-auto text-[11px] text-ink-400">
              {answer.elapsedMs} ms
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-ink-500">
          Tools read the sponsor rollups and contract reports. No figure in the
          reply was produced by the language layer alone.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!answer ? (
          <p className="px-1 py-6 text-center text-[12px] text-ink-400">
            {busy ? "Working…" : "Ask something to see the tool calls."}
          </p>
        ) : answer.work.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12px] text-ink-400">
            No tools were called.
          </p>
        ) : (
          <div className="space-y-2">
            {answer.work.map((step, i) => (
              <WorkStepCard key={i} step={step} index={i} />
            ))}
          </div>
        )}
      </div>

      {answer ? (
        <div className="border-t border-ink-200 bg-ink-50/50 px-4 py-2.5 text-[11px] leading-snug text-ink-500">
          Routed as{" "}
          <span className="font-medium text-ink-700">{answer.intent}</span>.{" "}
          <Link
            href={`/agents/runs/${answer.runId}`}
            className="text-glass-700 hover:text-glass-900"
          >
            Full trace
          </Link>
          .
        </div>
      ) : null}
    </aside>
  );
}

function WorkStepCard({ step, index }: { step: WorkStep; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition hover:bg-ink-50"
      >
        <span className="tnum mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded bg-ink-100 text-[10px] font-semibold text-ink-600">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium leading-tight text-ink-900">
            {TOOL_LABEL[step.tool] ?? step.tool}
          </span>
          <span className="mt-1 block text-[11.5px] leading-snug text-ink-500">
            {step.because}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400 transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="space-y-2.5 border-t border-ink-100 bg-ink-50/50 px-3 py-2.5">
          <Field label="Called with">
            <code className="block break-all font-mono text-[10.5px] leading-relaxed text-ink-700">
              {step.tool}({JSON.stringify(step.args)})
            </code>
          </Field>
          {step.error ? (
            <Field label="Error">
              <span className="text-[11.5px] text-rose-700">{step.error}</span>
            </Field>
          ) : (
            <>
              {step.summary ? (
                <Field label="Came back">
                  <span className="text-[11.5px] leading-relaxed text-ink-700">
                    {step.summary}
                  </span>
                </Field>
              ) : null}
              <Field label="Raw result">
                <pre className="max-h-52 overflow-auto rounded border border-ink-200 bg-white p-2 font-mono text-[10px] leading-relaxed text-ink-600">
                  {JSON.stringify(step.data, null, 2)}
                </pre>
              </Field>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-400">
        {label}
      </div>
      {children}
    </div>
  );
}
