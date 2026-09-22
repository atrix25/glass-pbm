"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Analysis } from "@/lib/agents/account-management/service";
import { workDestination } from "@/lib/agents/work";
import { AGENTS } from "@/lib/agents/registry";
import accountStyles from "./account-management.module.css";
import { AgentRefresh } from "./agent-refresh";
import styles from "@/app/(app)/agents/agents.module.css";
const money = (c: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
interface Props {
  canWrite: boolean;
  job: {
    id: string;
    status: string;
    progress: number;
    error: string | null;
  } | null;
  analysis: Analysis | null;
  release: {
    id: string;
    effectiveAt: string;
    actor: string;
    proposalId: string;
    scheduled: boolean;
  } | null;
  tasks: {
    id: string;
    agentId: string;
    status: string;
    reviewedBy: string | null;
  }[];
}
export function AccountManagement({
  canWrite,
  job,
  analysis,
  release,
  tasks,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const [pending, start] = useTransition();
  const working = job?.status === "pending" || job?.status === "running";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => start(() => router.refresh()), 5000);
    return () => clearInterval(timer);
  }, [working, router]);
  async function submit(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account-management", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setApproved(false);
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>ACCOUNT MANAGEMENT</p>
          <h1>Savings with less disruption.</h1>
          <p className={styles.muted}>
            Set the goal. Compare measured options. Approve the rollout.
          </p>
        </div>
        <Link className={styles.link} href="/agents">
          Agent operations →
        </Link>
        <AgentRefresh />
      </header>
      <section className={styles.panel}>
        <h2>Benefit goals</h2>
        <form
          className={styles.filters}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void submit({
              action: "analyze",
              goals: {
                savingCents: Math.round(Number(data.get("saving")) * 100),
                maxAffectedMembers: Number(data.get("members")),
                maxMembersPayingMore: Number(data.get("oop")),
                maxNewRejects: Number(data.get("rejects")),
              },
            });
          }}
        >
          <label>
            Savings goal ($)
            <input
              name="saving"
              type="number"
              min="1"
              required
              defaultValue={10000}
            />
          </label>
          <label>
            Members affected, max
            <input
              name="members"
              type="number"
              min="0"
              required
              defaultValue={50}
            />
          </label>
          <label>
            Members paying more, max
            <input name="oop" type="number" min="0" required defaultValue={0} />
          </label>
          <label>
            New rejected fills, max
            <input
              name="rejects"
              type="number"
              min="0"
              required
              defaultValue={0}
            />
          </label>
          <button disabled={!canWrite || busy || working}>
            Evaluate options
          </button>
        </form>
        <p className="px-6 py-4 text-xs leading-relaxed text-ink-500">
          Full-book historical replay against the filed plan, net of modeled
          rebates. Not an annual forecast. Evaluates supported PA, step-therapy
          and tier changes for three high-cost products. Rejected fills are
          access disruption, not proven clinical savings.
        </p>
        {!canWrite && (
          <p className="px-6 pb-4 text-xs text-amber-800">
            Sign in as a benefits lead or administrator to evaluate and approve
            changes.
          </p>
        )}
      </section>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {job && (
        <div className={`${styles.panel} p-5 text-sm`} role="status">
          {working
            ? `Analysis ${job.status} · ${Math.round(job.progress * 100)}%`
            : job.status === "failed"
              ? `Analysis failed: ${job.error}`
              : "Analysis complete"}
          {working && (
            <p className={styles.muted}>
              Full-book replays run in the worker. Progress refreshes every five
              seconds.
            </p>
          )}
        </div>
      )}
      {analysis && (
        <section className={styles.panel}>
          <h2 className="flex items-center justify-between gap-3">
            Evaluated options{" "}
            <Link
              className={styles.link}
              href={`/agents/runs/${analysis.runId}`}
            >
              View analysis →
            </Link>
          </h2>
          <p className="px-6 py-3 text-xs text-ink-500">
            Goal {money(analysis.goals.savingCents)} · Up to{" "}
            {analysis.goals.maxAffectedMembers} affected members · Through{" "}
            {analysis.asOf.slice(0, 10)}. Ranked by fewest affected members
            among eligible options.
          </p>
          <div className={styles.scroll}>
            <table className={`${styles.table} ${accountStyles.options}`}>
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Plan savings</th>
                  <th>Member shift</th>
                  <th>Net savings</th>
                  <th>Affected</th>
                  <th>Paying more / rejects</th>
                  <th>Position</th>
                </tr>
              </thead>
              <tbody>
                {analysis.options.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{money(o.planSavingCents)}</td>
                    <td>{money(o.memberShiftCents)}</td>
                    <td>{money(o.netSavingCents)}</td>
                    <td>{o.affectedMembers.toLocaleString()}</td>
                    <td>
                      {o.membersPayingMore} / {o.newRejects}
                    </td>
                    <td>
                      {o.id === analysis.recommendedId
                        ? "Recommended"
                        : o.reasons.length
                          ? o.reasons.join(" · ")
                          : "Meets limits"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!analysis.recommendedId && (
            <p className={styles.empty}>
              No evaluated option meets the goals. No change will be applied.
            </p>
          )}
          {analysis.proposalId &&
            release?.proposalId !== analysis.proposalId && (
              <div className="space-y-4 border-t border-ink-100 p-6">
                <Link
                  className={styles.link}
                  href={`/agents/runs/${analysis.runId}`}
                >
                  Review evidence and proposal →
                </Link>
                <label className="flex items-start gap-3 text-xs leading-relaxed text-ink-600">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  I approve the recommended design and its member-impact results
                  for activation at the next UTC midnight. I have completed the
                  required benefit and clinical review.
                </label>
                <button
                  disabled={
                    !canWrite || !approved || busy || pending || working
                  }
                  className="rounded-lg bg-glass-700 px-4 py-3 text-sm text-white disabled:opacity-40"
                  onClick={() =>
                    submit({
                      action: "activate",
                      proposalId: analysis.proposalId,
                      approved: true,
                    })
                  }
                >
                  Approve & schedule
                </button>
                <p className={styles.note}>
                  Approval is recorded. Stale analyses and changed baselines
                  must be rerun. Historical claims remain unchanged.
                </p>
              </div>
            )}
        </section>
      )}
      {release && (
        <section className={styles.panel}>
          <h2>Benefit rollout</h2>
          <div className="px-6 py-4">
            <p className="text-sm">
              {release.scheduled ? "Scheduled" : "Effective"} ·{" "}
              {release.effectiveAt.slice(0, 16).replace("T", " ")} UTC
            </p>
            <p className={styles.muted}>
              Release {release.id} · Approved by {release.actor}
            </p>
            <p className="mt-3 text-xs text-ink-600">
              New fill simulations, member coverage and pricing tools, and
              utilization-management reporting read the effective release. Other
              teams receive review tasks below; delivered does not mean
              completed.
            </p>
          </div>
          {tasks.map((t) => (
            <div
              className={`${styles.related} flex flex-wrap items-center justify-between gap-3`}
              key={t.id}
            >
              <div>
                <Link href={workDestination(t.agentId).href}>
                  {AGENTS.find((a) => a.id === t.agentId)?.name ?? t.agentId} →
                </Link>
                <p className={styles.note}>
                  {AGENTS.find((a) => a.id === t.agentId)?.owner ??
                    "Owner not recorded"}
                </p>
                <p className={styles.note}>
                  {t.status === "Proposed"
                    ? "Review pending"
                    : `Reviewed · ${t.reviewedBy ?? "Reviewer not recorded"}`}
                </p>
              </div>
              {t.status === "Proposed" && (
                <form
                  className="flex max-w-full flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit({
                      action: "review",
                      proposalId: t.id,
                      note: String(new FormData(e.currentTarget).get("note")),
                    });
                  }}
                >
                  <input
                    aria-label={`Review note for ${t.agentId}`}
                    name="note"
                    minLength={5}
                    maxLength={1000}
                    required
                    placeholder="Review evidence or reference"
                    className="min-w-0 rounded border border-ink-200 p-2 text-xs"
                  />
                  <button
                    disabled={!canWrite || busy}
                    className="text-xs text-glass-700"
                  >
                    Record review
                  </button>
                </form>
              )}
            </div>
          ))}
        </section>
      )}
      <p className={styles.note}>
        Fewer members affected is evaluated across all changed claims, including
        cost changes and coverage outcomes. The display sample does not
        determine the count.
      </p>
    </div>
  );
}
