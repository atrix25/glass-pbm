import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag
      className={cn(
        "rounded-xl border border-ink-200/80 bg-white shadow-[0_1px_2px_rgba(18,22,31,0.04),0_8px_24px_-16px_rgba(18,22,31,0.18)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-ink-200/70 px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-ink-900">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "positive" | "negative" | "accent";
  className?: string;
}) {
  const toneClass = {
    default: "text-ink-900",
    positive: "text-emerald-700",
    negative: "text-rose-700",
    accent: "text-glass-700",
  }[tone];

  return (
    <div className={cn("px-5 py-4", className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
        {label}
      </div>
      <div className={cn("tnum mt-1.5 text-2xl font-semibold tracking-tight", toneClass)}>
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[12.5px] leading-snug text-ink-500">{sub}</div>
      ) : null}
    </div>
  );
}

export function Badge({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "positive" | "negative" | "warn" | "accent";
}) {
  const toneClass = tone
    ? {
        neutral: "bg-ink-100 text-ink-700 ring-ink-400/25",
        positive: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
        negative: "bg-rose-50 text-rose-800 ring-rose-600/20",
        warn: "bg-amber-50 text-amber-900 ring-amber-600/25",
        accent: "bg-glass-50 text-glass-800 ring-glass-600/20",
      }[tone]
    : "";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap",
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Marks any figure that depends on the simulated AWP benchmark.
 *
 * This is deliberately visually loud. A plan sponsor should be able to see, at
 * a glance, exactly which numbers rest on a benchmark nobody outside Medi-Span
 * can verify.
 */
export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <Link
      href="/methodology#awp"
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-900 ring-1 ring-inset ring-amber-600/25 transition hover:bg-amber-100",
        className,
      )}
      title="This figure depends on AWP, a proprietary benchmark that is not published. Click to read how it is modeled here."
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-600"
      />
      simulated AWP
    </Link>
  );
}

export function VerifiedBadge({
  href,
  label = "verifiable",
  className,
}: {
  href?: string;
  label?: string;
  className?: string;
}) {
  const content = (
    <>
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600"
      />
      {label}
    </>
  );
  const cls = cn(
    "inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20",
    href && "transition hover:bg-emerald-100",
    className,
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {content}
      </a>
    );
  }
  return <span className={cls}>{content}</span>;
}

export function Table({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto scroll-thin", className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 border-b border-ink-200 bg-ink-50/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-600 backdrop-blur",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      className={cn(
        "border-b border-ink-100 px-3 py-2 align-middle text-ink-800",
        align === "right" && "text-right tnum",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-500">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** A citation chip that links to the underlying published document. */
export function SourceLink({
  url,
  children,
  className,
}: {
  url?: string | null;
  children: ReactNode;
  className?: string;
}) {
  if (!url) {
    return <span className={cn("text-[12px] text-ink-500", className)}>{children}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "text-[12px] text-glass-700 underline decoration-glass-300 underline-offset-2 transition hover:text-glass-900 hover:decoration-glass-500",
        className,
      )}
    >
      {children}
    </a>
  );
}

export function SectionTitle({
  children,
  description,
  action,
}: {
  children: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          {children}
        </h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-ink-600">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Horizontal proportion bar used in the cost breakdown views. */
export function ProportionBar({
  segments,
  className,
}: {
  segments: { label: string; value: number; className: string }[];
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div
      className={cn(
        "flex h-2 w-full overflow-hidden rounded-full bg-ink-100",
        className,
      )}
    >
      {segments.map((s, i) => (
        <div
          key={i}
          className={s.className}
          style={{ width: `${(Math.max(0, s.value) / total) * 100}%` }}
          title={`${s.label}: ${((Math.max(0, s.value) / total) * 100).toFixed(1)}%`}
        />
      ))}
    </div>
  );
}
