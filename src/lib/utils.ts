import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Benefit level presentation, matching the formulary's own vocabulary. */
export const LEVEL_META: Record<
  string,
  { label: string; short: string; className: string }
> = {
  "1": {
    label: "Level 1",
    short: "L1",
    className: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  },
  "2": {
    label: "Level 2",
    short: "L2",
    className: "bg-sky-50 text-sky-800 ring-sky-600/20",
  },
  "3": {
    label: "Level 3",
    short: "L3",
    className: "bg-amber-50 text-amber-900 ring-amber-600/25",
  },
  "4": {
    label: "Level 4 specialty",
    short: "L4",
    className: "bg-violet-50 text-violet-800 ring-violet-600/20",
  },
  $0: {
    label: "Preventive",
    short: "$0",
    className: "bg-teal-50 text-teal-800 ring-teal-600/20",
  },
  NC: {
    label: "Not covered",
    short: "NC",
    className: "bg-ink-100 text-ink-700 ring-ink-400/25",
  },
  EXC: {
    label: "Plan exclusion",
    short: "EXC",
    className: "bg-rose-50 text-rose-800 ring-rose-600/20",
  },
};

export function levelMeta(level: string | null | undefined) {
  if (!level) return LEVEL_META.NC;
  return (
    LEVEL_META[level] ?? {
      label: `Level ${level}`,
      short: level,
      className: "bg-ink-100 text-ink-700 ring-ink-400/25",
    }
  );
}

export const CHANNEL_LABEL: Record<string, string> = {
  Retail: "Retail",
  Retail90: "Retail 90",
  Mail: "Mail order",
  Specialty: "Specialty",
};
