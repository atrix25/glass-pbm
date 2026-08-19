"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { describeFailure, postJson } from "@/lib/post-json";

/**
 * Record where the score stands today, under a label.
 *
 * Readings are only useful against each other. One taken before a change and
 * one after it are the difference between claiming a decision was good for
 * members and showing it.
 */
export function TakeReading() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = label.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    try {
      await postJson<unknown>("/api/nps/snapshot", { label: trimmed });
      setLabel("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(describeFailure(e, "Could not take the reading."));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-glass-600 px-3 py-2 text-[12.5px] font-medium text-white transition hover:bg-glass-700"
      >
        Take a reading
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="What is this reading for?"
        className="w-56 rounded-lg border border-ink-300 px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none transition focus:border-glass-500 focus:ring-2 focus:ring-glass-500/20"
      />
      <button
        onClick={submit}
        disabled={busy || label.trim().length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg bg-glass-600 px-3 py-2 text-[12.5px] font-medium text-white transition hover:bg-glass-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {busy ? "Scoring" : "Save"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="rounded-lg px-2 py-2 text-[12.5px] font-medium text-ink-600 transition hover:text-ink-900"
      >
        Cancel
      </button>
      {error ? (
        <span className="text-[12px] text-rose-700">{error}</span>
      ) : null}
    </div>
  );
}
