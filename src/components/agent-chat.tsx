"use client";

/**
 * Shared building blocks for the agent chat surfaces.
 *
 * The member-service assistant and the sponsor data agent present the same
 * conversation: a chat column on the left, a work panel on the right showing
 * every tool call the agent made. What differs between them — the endpoint,
 * the answer shape, the copy, the paragraph rendering — is passed in, and
 * everything else lives here once.
 */

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

export interface Citation {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  locator?: string;
}

export interface WorkStep {
  tool: string;
  because: string;
  args: unknown;
  error: string | null;
  summary: string | null;
  data: unknown;
  citations: Citation[];
  /** True when the call was chosen after seeing an earlier result. */
  followUp: boolean;
}

export interface AgentAnswerBase {
  question: string;
  intent: string;
  paragraphs: string[];
  citations: Citation[];
  links: { label: string; href: string }[];
  work: WorkStep[];
  runId: string;
  autonomy: string;
  elapsedMs: number;
}

export interface Turn<A extends AgentAnswerBase> {
  question: string;
  answer: A | null;
}

export function useAgentChat<A extends AgentAnswerBase>({
  endpoint,
  buildBody,
  resetKey,
}: {
  endpoint: string;
  buildBody: (question: string) => unknown;
  /** When provided, a change starts a fresh conversation. */
  resetKey?: string;
}) {
  const [turns, setTurns] = useState<Turn<A>[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A new key means a new conversation: carrying one subject's thread into
  // another's view would show one party's numbers under another's name.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setTurns([]);
    setInput("");
  }

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
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(q)),
      });
      const answer = (await res.json()) as A;
      setTurns((t) =>
        t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)),
      );
    } finally {
      setBusy(false);
    }
  }

  const last = turns.at(-1)?.answer ?? null;

  return { turns, input, setInput, busy, send, scrollRef, last };
}

// ---------------------------------------------------------------------------

export function ChatLayout({
  children,
  workPanel,
}: {
  children: React.ReactNode;
  workPanel: React.ReactNode;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {children}
      {workPanel}
    </div>
  );
}

export function ChatWindow({
  scrollRef,
  children,
  composer,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  composer: React.ReactNode;
}) {
  return (
    <div className="flex h-[calc(100vh-172px)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
        {children}
      </div>
      {composer}
    </div>
  );
}

export function ChatComposer({
  input,
  onInputChange,
  busy,
  onSend,
  placeholder,
  chips,
}: {
  input: string;
  onInputChange: (value: string) => void;
  busy: boolean;
  onSend: (question: string) => void;
  placeholder: string;
  /** Quick suggestion chips shown under the input. */
  chips: string[];
}) {
  return (
    <div className="border-t border-ink-200 bg-ink-50/40 px-4 py-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend(input);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(input);
            }
          }}
          rows={1}
          placeholder={placeholder}
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
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSend(s)}
              disabled={busy}
              className="truncate rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11.5px] text-ink-600 transition hover:border-glass-400 hover:text-glass-800 disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BusyIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-500">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  );
}

export function WelcomeIntro({
  title,
  description,
  suggestions,
  onPick,
}: {
  title: string;
  description: React.ReactNode;
  suggestions: string[];
  onPick: (question: string) => void;
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-glass-600">
          <Sparkles className="h-4.5 w-4.5 text-white" />
        </div>
        <h2 className="mt-4 text-[19px] font-semibold tracking-tight text-ink-900">
          {title}
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">
          {description}
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

export function QuestionBubble({ question }: { question: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-ink-900 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white">
        {question}
      </div>
    </div>
  );
}

export function AnswerLinks({
  links,
}: {
  links: { label: string; href: string }[];
}) {
  if (links.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {links.map((l) => (
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
  );
}

export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2.5 space-y-1">
      {citations.map((c) => (
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
  );
}

// ---------------------------------------------------------------------------

export function WorkPanel<A extends AgentAnswerBase>({
  answer,
  busy,
  description,
  toolLabels,
  emptyWork,
  footer,
  showStepCitations = false,
}: {
  answer: A | null;
  busy: boolean;
  description: string;
  toolLabels: Record<string, string>;
  /** Shown when an answer arrived without any tool calls. */
  emptyWork?: React.ReactNode;
  footer: (answer: A) => React.ReactNode;
  showStepCitations?: boolean;
}) {
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
          {description}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!answer ? (
          <p className="px-1 py-6 text-center text-[12px] text-ink-400">
            {busy ? "Working…" : "Ask something to see the tool calls."}
          </p>
        ) : answer.work.length === 0 ? (
          (emptyWork ?? (
            <p className="px-1 py-6 text-center text-[12px] text-ink-400">
              No tools were called.
            </p>
          ))
        ) : (
          <div className="space-y-2">
            {answer.work.map((step, i) => (
              <WorkStepCard
                key={i}
                step={step}
                index={i}
                toolLabels={toolLabels}
                showCitations={showStepCitations}
              />
            ))}
          </div>
        )}
      </div>

      {answer ? (
        <div className="border-t border-ink-200 bg-ink-50/50 px-4 py-2.5 text-[11px] leading-snug text-ink-500">
          {footer(answer)}
        </div>
      ) : null}
    </aside>
  );
}

function WorkStepCard({
  step,
  index,
  toolLabels,
  showCitations,
}: {
  step: WorkStep;
  index: number;
  toolLabels: Record<string, string>;
  showCitations: boolean;
}) {
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
            {toolLabels[step.tool] ?? step.tool}
          </span>
          {step.followUp ? (
            <span className="mt-1 inline-block rounded bg-glass-50 px-1.5 py-0.5 text-[10.5px] font-medium text-glass-800 ring-1 ring-inset ring-glass-600/20">
              chosen after reading the previous result
            </span>
          ) : null}
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
          {showCitations && step.citations.length > 0 ? (
            <Field label="Cited">
              <ul className="space-y-1">
                {step.citations.map((c) => (
                  <li key={c.sourceId + (c.locator ?? "")}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] leading-snug text-glass-700 hover:underline"
                    >
                      {c.title}
                    </a>
                    {c.locator ? (
                      <span className="block text-[10.5px] leading-snug text-ink-500">
                        {c.locator}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Field>
          ) : null}
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
