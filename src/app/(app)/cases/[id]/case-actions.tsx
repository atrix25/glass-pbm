"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "assign" | "resolve" | "reopen";

export function CaseActions({
  caseId,
  status,
  owner,
  defaultOperatorLabel,
}: {
  caseId: string;
  status: string;
  owner: string | null;
  defaultOperatorLabel: string;
}) {
  const router = useRouter();
  const [operatorLabel, setOperatorLabel] = useState(defaultOperatorLabel);
  const [nextOwner, setNextOwner] = useState(owner ?? defaultOperatorLabel);
  const [resolution, setResolution] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mutate(action: Action) {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          operatorLabel,
          ...(action === "assign" ? { owner: nextOwner } : {}),
          ...(action === "resolve" ? { resolution } : {}),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Case update failed.");
      if (action === "resolve") setResolution("");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Case update failed.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4 px-5 py-4">
      <div>
        <label
          htmlFor="operator-label"
          className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500"
        >
          Operator
        </label>
        <input
          id="operator-label"
          value={operatorLabel}
          onChange={(event) => setOperatorLabel(event.target.value)}
          className="mt-1.5 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-[13px] text-ink-800"
        />
        <p className="mt-1 text-[11.5px] text-ink-500">
          Used in demo mode. Signed-in production actions use the session identity.
        </p>
      </div>

      {status === "Open" ? (
        <>
          <div>
            <label
              htmlFor="case-owner"
              className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500"
            >
              Assign owner
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="case-owner"
                value={nextOwner}
                onChange={(event) => setNextOwner(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-ink-300 bg-white px-3 py-2 text-[13px] text-ink-800"
              />
              <button
                type="button"
                disabled={pending !== null || !nextOwner.trim()}
                onClick={() => mutate("assign")}
                className="rounded-md border border-ink-300 bg-white px-3 py-2 text-[12px] font-semibold text-ink-800 transition hover:bg-ink-50 disabled:opacity-50"
              >
                {pending === "assign" ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="case-resolution"
              className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500"
            >
              Resolution
            </label>
            <textarea
              id="case-resolution"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="Record what was done and why the case can close."
              rows={4}
              className="mt-1.5 w-full resize-y rounded-md border border-ink-300 bg-white px-3 py-2 text-[13px] leading-relaxed text-ink-800"
            />
            <button
              type="button"
              disabled={pending !== null || !resolution.trim()}
              onClick={() => mutate("resolve")}
              className="mt-2 rounded-md bg-glass-700 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-glass-800 disabled:opacity-50"
            >
              {pending === "resolve" ? "Resolving…" : "Resolve case"}
            </button>
          </div>
        </>
      ) : (
        <div>
          <p className="text-[12.5px] leading-relaxed text-ink-600">
            Reopening returns this case to its queue and clears the recorded
            resolution.
          </p>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => mutate("reopen")}
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
          >
            {pending === "reopen" ? "Reopening…" : "Reopen case"}
          </button>
        </div>
      )}

      {error ? (
        <p className="text-[12px] text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
