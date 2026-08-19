"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { describeFailure, postJson } from "@/lib/post-json";
import { cn } from "@/lib/utils";

export interface IntakeOption {
  paId: string;
  label: string;
  channel: string;
}

interface Extracted {
  key: string;
  label: string;
  step: number;
  value: string | boolean | null;
  quote: string | null;
  confidence: number;
}

interface IntakeResponse {
  paNumber: string;
  drug: string;
  tree: string | null;
  note: { body: string; channel: string; author: string };
  onFile: {
    determination: string | null;
    decidingStep: number | null;
    decidedBy: string | null;
  };
  result: {
    extracted: Extracted[];
    outcome: string;
    decidingStep?: number;
    reason?: string;
    escalationReason?: string;
    path: { step: number; question: string; answer: boolean; evidence: string }[];
    accuracy?: { fields: number; correct: number; missed: number; wrong: number };
  };
  steps: {
    kind: string;
    tool: string | null;
    because: string;
    summary: string;
    brain: string;
    elapsedMs: number;
  }[];
  brain: string;
  elapsedMs: number;
  autonomy: string;
}

/**
 * Reading is the whole demonstration here, so the note is shown as it arrived
 * and the lines the agent relied on are marked in place. A field with no mark
 * against it is one the agent could not establish, and that is the interesting
 * case rather than a gap in the interface.
 */
function Highlighted({
  body,
  quotes,
}: {
  body: string;
  quotes: { quote: string; label: string }[];
}) {
  const marks = quotes.filter((q) => q.quote && body.includes(q.quote));
  if (marks.length === 0) {
    return <>{body}</>;
  }

  // Split on the quotes, longest first so a short quote inside a long one does
  // not cut the long one in half.
  const ordered = [...marks].sort((a, b) => b.quote.length - a.quote.length);
  let parts: (string | { quote: string; label: string })[] = [body];
  for (const m of ordered) {
    const next: typeof parts = [];
    for (const part of parts) {
      if (typeof part !== "string") {
        next.push(part);
        continue;
      }
      const at = part.indexOf(m.quote);
      if (at === -1) {
        next.push(part);
        continue;
      }
      if (at > 0) next.push(part.slice(0, at));
      next.push(m);
      const rest = part.slice(at + m.quote.length);
      if (rest) next.push(rest);
    }
    parts = next;
  }

  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <mark
            key={i}
            className="rounded bg-glass-100 px-0.5 text-ink-900 ring-1 ring-inset ring-glass-300"
            title={p.label}
          >
            {p.quote}
          </mark>
        ),
      )}
    </>
  );
}

function display(value: string | boolean | null): string {
  if (value === null) return "not established";
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === "__none") return "none of the listed options";
  return String(value);
}

export function IntakeDemo({ options }: { options: IntakeOption[] }) {
  const [paId, setPaId] = useState(options[0]?.paId ?? "");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<IntakeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setData(await postJson<IntakeResponse>("/api/agents/intake", { paId }));
    } catch (e) {
      setError(describeFailure(e, "The agent could not read that request."));
    } finally {
      setBusy(false);
    }
  }

  const quotes =
    data?.result.extracted
      .filter((e) => e.quote)
      .map((e) => ({ quote: e.quote!, label: e.label })) ?? [];

  return (
    <Card>
      <CardHeader
        title="Watch it read one"
        description="Pick a request that came in this year and run the agent against it now. The note is shown exactly as it arrived; the lines the agent relied on are marked, and every answer names the step of the published form it feeds."
        action={
          <div className="flex items-center gap-2">
            <select
              value={paId}
              onChange={(e) => setPaId(e.target.value)}
              className="max-w-[22rem] rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink-800 focus:border-glass-400 focus:outline-none"
            >
              {options.map((o) => (
                <option key={o.paId} value={o.paId}>
                  {o.label} ({o.channel.toLowerCase()})
                </option>
              ))}
            </select>
            <button
              onClick={run}
              disabled={busy || !paId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-glass-700 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-glass-800 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run intake
            </button>
          </div>
        }
      />

      {error ? (
        <div className="px-5 py-4 text-[13px] text-rose-700">{error}</div>
      ) : null}

      {!data ? (
        <div className="px-5 py-10 text-center text-[13px] text-ink-500">
          Nothing has been read yet. The corpus holds {options.length > 0 ? "1,651" : "no"} chart
          notes attached to real requests in this book.
        </div>
      ) : (
        <>
          <div className="grid gap-0 border-b border-ink-200/70 lg:grid-cols-2 lg:divide-x lg:divide-ink-200/70">
            <div className="min-w-0 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                  As it arrived
                </span>
                <Badge tone="neutral">{data.note.channel}</Badge>
              </div>
              <pre className="scroll-thin mt-3 max-h-[30rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink-50 p-4 font-mono text-[11.5px] leading-relaxed text-ink-800">
                <Highlighted body={data.note.body} quotes={quotes} />
              </pre>
            </div>

            <div className="min-w-0 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                  What it filled in
                </span>
                <Badge tone="accent">{data.tree ?? "no form"}</Badge>
                <span className="tnum text-[11.5px] text-ink-500">
                  {data.elapsedMs} ms · {data.brain}
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {data.result.extracted.map((e) => (
                  <div
                    key={e.key}
                    className={cn(
                      "rounded-lg border px-3 py-2",
                      e.value === null
                        ? "border-amber-300/70 bg-amber-50/60"
                        : "border-ink-200 bg-white",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px] font-medium text-ink-900">
                        {e.label}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-500">
                        step {e.step}
                        {e.value !== null
                          ? ` · ${(e.confidence * 100).toFixed(0)}%`
                          : ""}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 text-[12.5px]",
                        e.value === null
                          ? "text-amber-900"
                          : "text-ink-700",
                      )}
                    >
                      {display(e.value)}
                    </div>
                    {e.quote ? (
                      <div className="mt-1 border-l-2 border-glass-300 pl-2 text-[11.5px] italic leading-snug text-ink-600">
                        {e.quote}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-b border-ink-200/70 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                Then the published tree decided
              </span>
              <Badge
                tone={
                  data.result.outcome === "Approved"
                    ? "positive"
                    : data.result.outcome === "Denied"
                      ? "negative"
                      : "warn"
                }
              >
                {data.result.outcome}
              </Badge>
              {data.result.outcome === "Denied" ? (
                <Badge tone="warn">held for a pharmacist</Badge>
              ) : null}
            </div>

            {data.result.escalationReason ? (
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-amber-900">
                {data.result.escalationReason} The agent left the field blank
                rather than guessing it, so the request goes to a pharmacist
                with everything it did establish already filled in.
              </p>
            ) : null}

            {data.result.path.length > 0 ? (
              <Table className="mt-3">
                <thead>
                  <tr>
                    <Th align="right">Step</Th>
                    <Th>Question on the published form</Th>
                    <Th>Answer</Th>
                    <Th>Why</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.result.path.map((p) => (
                    <tr key={p.step}>
                      <Td align="right">{p.step}</Td>
                      <Td className="max-w-md">
                        <span className="line-clamp-2 text-[12.5px]" title={p.question}>
                          {p.question}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={p.answer ? "positive" : "negative"}>
                          {p.answer ? "yes" : "no"}
                        </Badge>
                      </Td>
                      <Td className="max-w-md text-[12px] text-ink-600">
                        {p.evidence}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
          </div>

          <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                Marked against the answer key
              </div>
              {data.result.accuracy ? (
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">
                  {data.result.accuracy.correct} of{" "}
                  {data.result.accuracy.fields} fields correct,{" "}
                  {data.result.accuracy.missed} not established and{" "}
                  {data.result.accuracy.wrong} wrong. The key is the fact set the
                  note was written from. The agent never sees it, and the score
                  does not change what it did.
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] text-ink-600">
                  No answer key for this request.
                </p>
              )}
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                What is on file for this request
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">
                {data.onFile.determination
                  ? `${data.onFile.determination}${data.onFile.decidingStep ? ` at step ${data.onFile.decidingStep}` : ""}, recorded as decided by ${data.onFile.decidedBy ?? "a reviewer"}.`
                  : "Still in review."}
              </p>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
