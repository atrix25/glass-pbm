"use client";

/**
 * The pharmacist's console.
 *
 * The rule this screen exists to make real is that automation may approve and
 * only a person may refuse. Everything here follows from that asymmetry. A
 * traversal that reached an approve edge is already recorded and appears
 * nowhere in this queue; a traversal that reached a deny edge is sitting here
 * unrecorded, presented as a recommendation with the step it came from, and it
 * becomes a determination when somebody with a licence signs it or overturns it.
 *
 * The "record it as automation" button is not decoration. It sends the refusal
 * with an automated reviewer and shows the server refusing it, because a rule
 * that can only be read in a paragraph is indistinguishable from a rule nobody
 * implemented.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  FileQuestion,
  Loader2,
  PenLine,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { formatDuration } from "@/lib/pa/status";
import { describeFailure, postJson } from "@/lib/post-json";
import type { ReviewBucket, ReviewItem } from "@/lib/queries/pa";
import { cn } from "@/lib/utils";

interface Reviewer {
  label: string;
  licence: string;
}

interface DecideResult {
  ok?: boolean;
  error?: string;
  determination?: string;
  decidedBy?: string;
  onTime?: boolean;
  dueAt?: string;
  boundBy?: "regulatory" | "contractual";
  requiresSignature?: boolean;
  escalated?: boolean;
}

const BUCKETS: Array<{
  id: ReviewBucket;
  label: string;
  blurb: string;
}> = [
  {
    id: "signature",
    label: "Awaiting a signature",
    blurb:
      "The engine walked the published form and reached a deny edge. Nothing has been recorded. Read the traversal and either sign it or overturn it.",
  },
  {
    id: "unresolved",
    label: "Criteria did not resolve",
    blurb:
      "The form was walked as far as the submitted facts allow and then stopped. The engine does not guess the rest, so these need a person.",
  },
  {
    id: "noCriteria",
    label: "No transcribed form",
    blurb:
      "This product's criteria document has not been encoded, so there is no tree to walk. The reviewer works from the plan document and the determination carries no step citation.",
  },
];

export function PaReviewConsole({
  signature,
  unresolved,
  noCriteria,
  reviewer,
  nowIso,
}: {
  signature: ReviewItem[];
  unresolved: ReviewItem[];
  noCriteria: ReviewItem[];
  reviewer: Reviewer;
  nowIso: string;
}) {
  const groups: Record<ReviewBucket, ReviewItem[]> = {
    signature,
    unresolved,
    noCriteria,
  };

  const [bucket, setBucket] = useState<ReviewBucket>(
    signature.length > 0
      ? "signature"
      : unresolved.length > 0
        ? "unresolved"
        : "noCriteria",
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    groups[
      signature.length > 0
        ? "signature"
        : unresolved.length > 0
          ? "unresolved"
          : "noCriteria"
    ][0]?.id ?? null,
  );

  const rows = groups[bucket];
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const active = BUCKETS.find((b) => b.id === bucket)!;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="self-start">
        <div className="flex gap-1 border-b border-ink-200/70 px-3 py-2.5">
          {BUCKETS.map((b) => (
            <button
              key={b.id}
              onClick={() => {
                setBucket(b.id);
                setSelectedId(groups[b.id][0]?.id ?? null);
              }}
              className={cn(
                "flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-medium transition",
                bucket === b.id
                  ? "bg-ink-900 text-white"
                  : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
              )}
            >
              {b.id === "signature"
                ? "Signature"
                : b.id === "unresolved"
                  ? "Unresolved"
                  : "No form"}
              <span
                className={cn(
                  "tnum ml-1.5",
                  bucket === b.id ? "text-white/70" : "text-ink-400",
                )}
              >
                {groups[b.id].length}
              </span>
            </button>
          ))}
        </div>

        <p className="border-b border-ink-200/70 px-4 py-3 text-[12.5px] leading-relaxed text-ink-600">
          {active.blurb}
        </p>

        <div className="scroll-thin max-h-[34rem] divide-y divide-ink-200/60 overflow-auto">
          {rows.map((r) => (
            <QueueRow
              key={r.id}
              item={r}
              nowIso={nowIso}
              selected={selected?.id === r.id}
              onSelect={() => setSelectedId(r.id)}
            />
          ))}
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-ink-500">
              Nothing in this bucket as of the clock.
            </div>
          ) : null}
        </div>
      </Card>

      {selected ? (
        <ReviewPanel key={selected.id} item={selected} reviewer={reviewer} nowIso={nowIso} />
      ) : (
        <Card>
          <div className="px-5 py-16 text-center text-[13px] text-ink-500">
            The queue is empty at this instant. Advance the clock to let more
            requests arrive.
          </div>
        </Card>
      )}
    </div>
  );
}

function QueueRow({
  item,
  nowIso,
  selected,
  onSelect,
}: {
  item: ReviewItem;
  nowIso: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const left = remaining(item.decisionDueAt, nowIso);
  return (
    <button
      onClick={onSelect}
      className={cn(
        "block w-full px-4 py-3 text-left transition",
        selected ? "bg-glass-50/70" : "hover:bg-ink-50/70",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="tnum text-[12px] font-medium text-ink-900">
          {item.paNumber}
        </span>
        {item.urgency === "Expedited" ? <Badge tone="warn">expedited</Badge> : null}
      </div>
      <div className="mt-0.5 truncate text-[12.5px] text-ink-700">
        {item.drugName}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11.5px] text-ink-500">
          {item.memberName}
        </span>
        {left ? (
          <span
            className={cn(
              "tnum shrink-0 text-[11px]",
              left.breached ? "font-medium text-rose-700" : "text-ink-500",
            )}
          >
            {left.breached ? `${left.text} over` : `${left.text} left`}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function ReviewPanel({
  item,
  reviewer,
  nowIso,
}: {
  item: ReviewItem;
  reviewer: Reviewer;
  nowIso: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<DecideResult | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [reason, setReason] = useState(item.proposed?.reason ?? "");
  const [days, setDays] = useState(365);
  const [note, setNote] = useState("");

  const left = remaining(item.decisionDueAt, nowIso);

  async function send(
    kind: "pharmacist" | "automation",
    action: Record<string, unknown>,
    tag: string,
  ) {
    setBusy(tag);
    setRefused(null);
    if (kind === "pharmacist") setResult(null);
    try {
      const data = await postJson<DecideResult>("/api/pa/decide", {
        paId: item.id,
        reviewer:
          kind === "pharmacist"
            ? { kind, label: reviewer.label, licence: reviewer.licence }
            : { kind, label: "Glass criteria engine" },
        action,
        note: note || undefined,
      });
      setResult(data);
      router.refresh();
    } catch (e) {
      // The 403 on an automated refusal is the demonstration, so the server's
      // own wording is shown as an answer rather than as a failure of the page.
      setRefused(describeFailure(e, "The server declined that."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link
                href={`/pa/${item.id}`}
                className="tnum text-ink-900 hover:text-glass-700"
              >
                {item.paNumber}
              </Link>
              <span className="font-normal text-ink-600">{item.drugName}</span>
              {item.urgency === "Expedited" ? (
                <Badge tone="warn">expedited</Badge>
              ) : null}
              {item.requestType !== "PA" ? (
                <Badge tone="neutral">{spaced(item.requestType)}</Badge>
              ) : null}
            </span>
          }
          description={
            <>
              {item.memberName} · prescriber {item.prescriberName ?? "not named"}
              {item.treeName ? ` · ${item.treeName}` : " · no transcribed form"}
            </>
          }
          action={
            left ? (
              <span
                className={cn(
                  "tnum inline-flex items-center gap-1.5 text-[12.5px]",
                  left.breached ? "font-medium text-rose-700" : "text-ink-600",
                )}
              >
                <Clock className="h-3.5 w-3.5" />
                {left.breached ? `${left.text} past due` : `${left.text} left`}
              </span>
            ) : null
          }
        />

        {item.proposed ? (
          <div className="border-b border-ink-200/70 bg-amber-50/50 px-5 py-4">
            <div className="flex items-start gap-3">
              <Bot className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13.5px] font-semibold text-amber-900">
                    Automation recommends a refusal
                    {item.proposed.decidingStep
                      ? ` at step ${item.proposed.decidingStep}`
                      : ""}
                  </h3>
                  <Badge tone="warn">not recorded</Badge>
                </div>
                {item.proposed.question ? (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-amber-900/85">
                    <span className="font-medium">The step that stopped it:</span>{" "}
                    {item.proposed.question}
                  </p>
                ) : null}
                {item.proposed.reason ? (
                  <p className="mt-1 text-[13px] leading-relaxed text-amber-900/85">
                    {item.proposed.reason}
                  </p>
                ) : null}
                {item.proposed.citation ? (
                  <p className="mt-1.5 text-[11.5px] italic text-amber-900/70">
                    {item.proposed.citation}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="border-b border-ink-200/70 px-5 py-4">
            <div className="flex items-start gap-3">
              <FileQuestion className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" />
              <p className="text-[13px] leading-relaxed text-ink-700">
                {item.treeId
                  ? "The traversal stopped before reaching a terminal outcome, because the submitted facts do not answer the next question on the form. Nothing has been proposed; the engine routed it here rather than assuming an answer."
                  : "No criteria form has been transcribed for this product, so there is no decision tree to walk. Whatever is decided here will carry no step citation, and the queue will say so."}
              </p>
            </div>
          </div>
        )}

        {item.walked.length > 0 ? (
          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              The traversal, as far as it went
            </div>
            <Table className="mt-2.5">
              <thead>
                <tr>
                  <Th align="right">Step</Th>
                  <Th>Question on the published form</Th>
                  <Th>Answer</Th>
                  <Th>On what evidence</Th>
                </tr>
              </thead>
              <tbody>
                {item.walked.map((w) => (
                  <tr
                    key={w.step}
                    className={cn(
                      item.proposed?.decidingStep === w.step &&
                        "bg-amber-50/60",
                    )}
                  >
                    <Td align="right" className="tnum">
                      {w.step}
                    </Td>
                    <Td className="max-w-md">
                      <span className="line-clamp-2 text-[12.5px]" title={w.question}>
                        {w.question}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={w.answer ? "positive" : "negative"}>
                        {w.answer ? "yes" : "no"}
                      </Badge>
                    </Td>
                    <Td className="max-w-md text-[12px] text-ink-600">
                      {w.evidence ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Record a determination"
          description={`Signed as ${reviewer.label}, licence ${reviewer.licence}. Everything written here goes through the same authorisation check the API applies to any other caller.`}
        />

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Reason, if refusing
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="The clinical reason this request does not meet the published criteria."
              className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-ink-800 focus:border-glass-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                Approval term
              </label>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="mt-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink-800 focus:border-glass-400 focus:outline-none"
              >
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>365 days</option>
              </select>
            </div>
            <div className="min-w-[14rem] flex-1">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                Reviewer note
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional, stored on the request."
                className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[12.5px] text-ink-800 focus:border-glass-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-ink-200/70 pt-4">
            <button
              onClick={() =>
                send(
                  "pharmacist",
                  {
                    record: "Approved",
                    approvedDays: days,
                    decidingStep: item.proposed?.decidingStep ?? null,
                  },
                  "approve",
                )
              }
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-emerald-800 disabled:opacity-50"
            >
              {busy === "approve" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {item.proposed ? "Overturn and approve" : "Approve"}
            </button>

            <button
              onClick={() =>
                send(
                  "pharmacist",
                  {
                    record: "Denied",
                    reason:
                      reason ||
                      "Published criteria are not met on the documentation submitted.",
                    decidingStep: item.proposed?.decidingStep ?? null,
                  },
                  "deny",
                )
              }
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-rose-800 disabled:opacity-50"
            >
              {busy === "deny" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PenLine className="h-3.5 w-3.5" />
              )}
              {item.proposed ? "Sign the refusal" : "Refuse"}
            </button>

            <button
              onClick={() =>
                send(
                  "pharmacist",
                  {
                    record: "Escalated",
                    reason: note || "Referred for further clinical review.",
                  },
                  "escalate",
                )
              }
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-[12.5px] font-medium text-ink-700 transition hover:border-ink-300 hover:text-ink-900 disabled:opacity-50"
            >
              {busy === "escalate" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              Refer on
            </button>

            <button
              onClick={() =>
                send(
                  "automation",
                  {
                    record: "Denied",
                    reason:
                      reason ||
                      "Criteria not met at the deciding step of the published form.",
                    decidingStep: item.proposed?.decidingStep ?? null,
                  },
                  "asAutomation",
                )
              }
              disabled={busy !== null}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-dashed border-ink-300 px-3 py-1.5 text-[12.5px] text-ink-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
              title="Sends the same refusal with an automated reviewer instead of a licensed one."
            >
              {busy === "asAutomation" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bot className="h-3.5 w-3.5" />
              )}
              Try to record it as automation
            </button>
          </div>

          {refused ? (
            <div className="rounded-lg border border-rose-600/25 bg-rose-50/60 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-rose-700" />
                <div>
                  <div className="text-[12.5px] font-semibold text-rose-900">
                    The server refused the write
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-rose-900/85">
                    {refused}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {result?.ok ? (
            <div className="rounded-lg border border-emerald-600/25 bg-emerald-50/60 px-4 py-3">
              <div className="flex items-start gap-2.5">
                {result.escalated ? (
                  <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-700" />
                ) : result.determination === "Denied" ? (
                  <XCircle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-700" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-700" />
                )}
                <div>
                  <div className="text-[12.5px] font-semibold text-emerald-900">
                    {result.escalated
                      ? "Referred on. No determination was recorded."
                      : `${result.determination} recorded, signed by ${result.decidedBy}.`}
                  </div>
                  {result.dueAt ? (
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-emerald-900/85">
                      {result.onTime ? "Inside" : "Outside"} the{" "}
                      {result.boundBy === "contractual"
                        ? "contractual turnaround the plan bought"
                        : "regulatory deadline"}
                      , which fell{" "}
                      {new Date(result.dueAt).toISOString().slice(0, 16).replace("T", " ")} UTC.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function remaining(
  due: Date | string | null,
  nowIso: string,
): { text: string; breached: boolean } | null {
  if (!due) return null;
  const ms = new Date(due).getTime() - new Date(nowIso).getTime();
  return { text: formatDuration(ms), breached: ms < 0 };
}

/** "FormularyException" reads badly in a badge. */
function spaced(requestType: string): string {
  return requestType
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}
