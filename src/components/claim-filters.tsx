"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS = [
  { value: "all", label: "All fills" },
  { value: "P", label: "Paid" },
  { value: "R", label: "Rejected" },
  { value: "B2", label: "Reversals" },
];

const CHANNELS = ["all", "Retail", "Retail90", "Mail", "Specialty"];
const LEVELS = ["all", "1", "2", "3", "4", "$0"];

export function ClaimFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    startTransition(() => router.push(`/claims?${next.toString()}`));
  };

  const active = ["drug", "member", "reject", "scenario", "basis"].filter((k) =>
    params.get(k),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update({ q });
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Member, drug, claim number, pharmacy"
          className="w-[290px] rounded-lg border border-ink-200 bg-white py-[7px] pl-8 pr-3 text-[13px] text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-glass-400 focus:ring-2 focus:ring-glass-100"
        />
      </form>

      <Select
        value={params.get("status") ?? "all"}
        onChange={(v) => update({ status: v })}
        options={STATUS}
      />
      <Select
        value={params.get("channel") ?? "all"}
        onChange={(v) => update({ channel: v })}
        options={CHANNELS.map((c) => ({
          value: c,
          label: c === "all" ? "All channels" : c,
        }))}
      />
      <Select
        value={params.get("level") ?? "all"}
        onChange={(v) => update({ level: v })}
        options={LEVELS.map((l) => ({
          value: l,
          label: l === "all" ? "All levels" : `Level ${l}`,
        }))}
      />

      {active.map((key) => (
        <button
          key={key}
          onClick={() => update({ [key]: null })}
          className="inline-flex items-center gap-1 rounded-lg bg-glass-50 px-2 py-[7px] text-[12.5px] font-medium text-glass-800 ring-1 ring-inset ring-glass-600/20 transition hover:bg-glass-100"
        >
          {key}: {params.get(key)}
          <X className="h-3 w-3" />
        </button>
      ))}

      {pending ? (
        <span className="text-[12px] text-ink-400">updating…</span>
      ) : null}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "cursor-pointer rounded-lg border border-ink-200 bg-white px-2.5 py-[7px] text-[13px] text-ink-800 outline-none transition hover:border-ink-300 focus:border-glass-400 focus:ring-2 focus:ring-glass-100",
        value !== "all" && "border-glass-300 bg-glass-50/60 text-glass-900",
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
