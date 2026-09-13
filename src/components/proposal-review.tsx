"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProposalReview({
  proposalId,
  status,
}: {
  proposalId: string;
  status: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [role, setRole] = useState<
    "admin" | "ops" | "pharmacist" | "plan_sponsor"
  >("admin");
  const [pending, setPending] = useState<"Approved" | "Rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!["Proposed", "Approved"].includes(status)) return null;

  async function decide(decision: "Approved" | "Rejected") {
    setPending(decision);
    setError(null);
    try {
      const response = await fetch(
        `/api/agents/proposals/${proposalId}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision,
            note: note || undefined,
            reviewerLabel: `Demo ${role.replace("_", " ")} reviewer`,
            reviewerRole: role,
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Review failed.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review failed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-600">
        Human review
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[180px_1fr]">
        <select
          aria-label="Reviewer role"
          value={role}
          onChange={(event) => setRole(event.target.value as typeof role)}
          className="rounded-md border border-ink-300 bg-white px-3 py-2 text-[13px] text-ink-800"
        >
          <option value="admin">Administrator</option>
          <option value="ops">Operations</option>
          <option value="pharmacist">Pharmacist</option>
          <option value="plan_sponsor">Plan sponsor</option>
        </select>
        <input
          aria-label="Review note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Decision note"
          className="rounded-md border border-ink-300 bg-white px-3 py-2 text-[13px] text-ink-800"
        />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => decide("Approved")}
          className="rounded-md bg-glass-700 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          {pending === "Approved" ? "Applying…" : "Approve and apply"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => decide("Rejected")}
          className="rounded-md border border-rose-300 bg-white px-3 py-2 text-[12px] font-semibold text-rose-800 disabled:opacity-50"
        >
          {pending === "Rejected" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[12px] text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
