"use client";

/**
 * Filing the things a member does after a no.
 *
 * The interesting behaviour here is the clock, and it is not cosmetic. An
 * exception to coverage asks the plan to depart from its own formulary, which
 * turns on a clinical assertion only the prescriber can make, so the deadline
 * does not start when the member files — it starts when the supporting statement
 * arrives. Filing without one is a real state that can sit for days, and the
 * form says so rather than pretending the request is already running.
 *
 * An appeal has an additional constraint that has nothing to do with timing:
 * whoever decides it must not be whoever refused it. So the form makes you pick
 * the refusal you are contesting, and it shows who signed that one.
 */

import { useState } from "react";
import { CheckCircle2, Clock, Loader2, Send } from "lucide-react";
import { Badge, Table, Td, Th } from "@/components/ui";
import { EXCEPTION_KINDS, type ExceptionKind } from "@/lib/pa/review";
import { describeFailure, postJson } from "@/lib/post-json";
import { cn } from "@/lib/utils";

export interface AppealTarget {
  paId: string;
  paNumber: string;
  memberId: string;
  memberName: string;
  drugId: string;
  drugName: string;
  decidedBy: string | null;
  denyReason: string | null;
  decidingStep: number | null;
}

interface Filed {
  ok?: boolean;
  error?: string;
  paNumber?: string;
  status?: string;
  kind?: string;
  clockStarted?: boolean;
  dueAt?: string | null;
  citation?: string;
  note?: string;
}

export function ExceptionIntake({ targets }: { targets: AppealTarget[] }) {
  const [kind, setKind] = useState<ExceptionKind>("FormularyException");
  const [targetId, setTargetId] = useState(targets[0]?.paId ?? "");
  const [statement, setStatement] = useState("");
  const [rationale, setRationale] = useState("");
  const [urgency, setUrgency] = useState<"Standard" | "Expedited">("Standard");
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<Filed | null>(null);

  const info = EXCEPTION_KINDS.find((k) => k.kind === kind)!;
  const target = targets.find((t) => t.paId === targetId) ?? null;

  async function file() {
    setBusy(true);
    setFiled(null);
    try {
      const filing = await postJson<Filed>("/api/pa/exception", {
        kind,
        // An appeal must name what it contests. Everything else inherits the
        // member and drug from the request it was filed against, which is how
        // these arrive in practice.
        againstPaId: target?.paId,
        memberId: target?.memberId,
        drugId: target?.drugId,
        urgency,
        supportingStatement: statement || undefined,
        rationale: rationale || undefined,
      });
      setFiled(filing);
    } catch (e) {
      // A refused filing answers with `{ error }` under a 4xx, which used to be
      // read as a successful Filed record and rendered as a receipt.
      setFiled({ error: describeFailure(e, "The filing did not go through.") });
    } finally {
      setBusy(false);
    }
  }

  if (targets.length === 0) {
    return (
      <div className="px-5 py-10 text-center text-[13px] text-ink-500">
        No determination has been released yet as of the clock, so there is
        nothing to contest.
      </div>
    );
  }

  return (
    <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-ink-200/70">
      <div className="space-y-4 px-5 py-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
            What is being filed
          </label>
          <div className="mt-2 space-y-1.5">
            {EXCEPTION_KINDS.map((k) => (
              <button
                key={k.kind}
                onClick={() => setKind(k.kind)}
                className={cn(
                  "block w-full rounded-lg border px-3 py-2 text-left transition",
                  kind === k.kind
                    ? "border-glass-600/40 bg-glass-50/70"
                    : "border-ink-200 hover:border-ink-300",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-medium text-ink-900">
                    {k.label}
                  </span>
                  {k.needsSupportingStatement ? (
                    <Badge tone="warn">needs a statement</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-600">
                  {k.asks}
                </p>
              </button>
            ))}
          </div>
        </div>

        <p className="rounded-lg bg-ink-50/70 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-600">
          {info.citation}
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
            {kind === "Appeal"
              ? "The refusal being contested"
              : "Filed on behalf of"}
          </label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink-800 focus:border-glass-400 focus:outline-none"
          >
            {targets.map((t) => (
              <option key={t.paId} value={t.paId}>
                {t.paNumber} — {t.memberName} — {t.drugName}
              </option>
            ))}
          </select>
          {target && kind === "Appeal" ? (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-600">
              Refused by {target.decidedBy ?? "an unnamed reviewer"}
              {target.decidingStep ? ` at step ${target.decidingStep}` : ""}. The
              appeal must be decided by somebody else, and the record of who
              refused it stays intact because the appeal is a separate request.
            </p>
          ) : null}
        </div>

        {info.needsSupportingStatement ? (
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Prescriber&apos;s supporting statement
            </label>
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={3}
              placeholder="Leave this empty to file without one and watch the clock stay stopped."
              className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-ink-800 focus:border-glass-400 focus:outline-none"
            />
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
              The deadline runs from this statement, not from the filing. Without
              it the plan cannot lawfully decide, so measuring from receipt would
              report the plan late on a request it was not allowed to answer.
            </p>
          </div>
        ) : null}

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
            Rationale
          </label>
          <input
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Optional, stored on the request."
            className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[12.5px] text-ink-800 focus:border-glass-400 focus:outline-none"
          />
        </div>

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Urgency
            </label>
            <select
              value={urgency}
              onChange={(e) =>
                setUrgency(e.target.value === "Expedited" ? "Expedited" : "Standard")
              }
              className="mt-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink-800 focus:border-glass-400 focus:outline-none"
            >
              <option value="Standard">Standard</option>
              <option value="Expedited">Expedited</option>
            </select>
          </div>
          <button
            onClick={file}
            disabled={busy || !targetId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-glass-700 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-glass-800 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            File it
          </button>
        </div>

        {filed?.error ? (
          <div className="rounded-lg border border-rose-600/25 bg-rose-50/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-rose-900">
            {filed.error}
          </div>
        ) : null}

        {filed?.ok ? (
          <div className="rounded-lg border border-emerald-600/25 bg-emerald-50/60 px-3 py-3">
            <div className="flex items-start gap-2.5">
              {filed.clockStarted ? (
                <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-700" />
              ) : (
                <Clock className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-700" />
              )}
              <div>
                <div className="tnum text-[12.5px] font-semibold text-emerald-900">
                  {filed.kind} filed as {filed.paNumber}
                </div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-emerald-900/85">
                  {filed.note}
                  {filed.dueAt
                    ? ` Due ${new Date(filed.dueAt).toISOString().slice(0, 16).replace("T", " ")} UTC.`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {target && kind !== "Appeal" && kind !== "Grievance" ? (
        <div className="border-t border-ink-200/70 px-5 py-4 lg:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
            What the plan already said about this drug for this member
          </div>
          <Table className="mt-2.5">
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Drug</Th>
                <Th>Outcome</Th>
                <Th>Reason on file</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="tnum">{target.paNumber}</Td>
                <Td>{target.drugName}</Td>
                <Td>
                  <Badge tone="negative">refused</Badge>
                </Td>
                <Td className="max-w-lg text-[12px] text-ink-600">
                  {target.denyReason ?? "—"}
                </Td>
              </tr>
            </tbody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
