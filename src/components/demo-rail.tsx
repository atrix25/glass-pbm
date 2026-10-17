"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Presentation, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The order to walk leadership through the system in. Each stop answers one
 * objection, so the sequence matters more than the page list.
 */
export const DEMO_STEPS = [
  {href:"/gemma",label:"Sapphire",claim:"Signals, actions and verified simulated outcomes."},
  { href: "/offering", label: "Choose", claim: "Compare pricing and benefit assumptions." },
  { href: "/sponsor", label: "Employer value", claim: "Plan costs and member tradeoffs." },
  { href: "/savings", label: "Find savings", claim: "Savings, member disruption, and modeled NPS." },
  { href: "/business", label: "Economics", claim: "Cost to serve and account contribution." },
  { href: "/agents", label: "Agents", claim: "Recorded work on the reference book." },
  { href: "/assistant", label: "Member service", claim: "Grounded answers from reference benefits." },
  { href: "/benefit-changes", label: "Benefit changes", claim: "Propose, test, deploy and monitor a sandbox benefit." },
];

export function DemoRail() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const offeringPages = ["/sponsor", "/offering", "/business"];
  const preserve = (href: string) => query && offeringPages.includes(pathname) && offeringPages.includes(href) ? `${href}?${query}` : href;
  const [dismissed, setDismissed] = useState(false);

  const index = DEMO_STEPS.findIndex(
    (s) => pathname === s.href || pathname.startsWith(`${s.href}/`),
  );

  if (dismissed) {
    return (
      <div className="flex justify-end border-b border-ink-200/70 bg-white/60 px-4 sm:px-6 lg:px-8">
        <button
          onClick={() => setDismissed(false)}
          className="inline-flex items-center gap-1.5 py-2 text-[12px] text-ink-500 transition hover:text-ink-800 sm:py-1.5"
        >
          <Presentation className="h-3.5 w-3.5" />
          Show guided demo
        </button>
      </div>
    );
  }

  const prev = index > 0 ? DEMO_STEPS[index - 1] : null;
  const next =
    index >= 0 && index < DEMO_STEPS.length - 1 ? DEMO_STEPS[index + 1] : null;

  return (
    <div className="border-b border-ink-200/70 bg-white/80 backdrop-blur">
      <div className="flex items-center gap-2 px-4 py-1.5 sm:gap-4 sm:px-6 sm:py-2 lg:px-8">
        <Link
          href="/pitch"
          title="Interactive plan sponsor pitch with recorded experiences"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 sm:py-1"
        >
          <Presentation className="h-3.5 w-3.5 text-glass-600" />
          Guided demo
        </Link>

        <ol className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {DEMO_STEPS.map((step, i) => {
            const active = i === index;
            const done = index >= 0 && i < index;
            return (
              <li key={step.href} className="shrink-0">
                <Link
                  href={preserve(step.href)}
                  title={step.claim}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[12px] transition sm:py-1",
                    active
                      ? "bg-glass-600 font-medium text-white"
                      : done
                        ? "text-ink-500 hover:bg-ink-100"
                        : "text-ink-500 hover:bg-ink-100",
                  )}
                >
                  <span
                    className={cn(
                      "tnum flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold",
                      active
                        ? "bg-white/25 text-white"
                        : done
                          ? "bg-glass-100 text-glass-700"
                          : "bg-ink-200/70 text-ink-600",
                    )}
                  >
                    {i + 1}
                  </span>
                  {step.label}
                </Link>
              </li>
            );
          })}
        </ol>

        <div className="flex shrink-0 items-center gap-1">
          {prev ? (
            <Link
              href={preserve(prev.href)}
              className="rounded-md p-2.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 sm:p-1"
              title={`Back: ${prev.label}`}
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
          ) : null}
          {next ? (
            <Link
              href={preserve(next.href)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-[12px] font-medium text-glass-700 transition hover:bg-glass-50 sm:py-1"
              title={next.claim}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
          <button
            onClick={() => setDismissed(true)}
            className="rounded-md p-2.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 sm:p-1"
            title="Hide"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
