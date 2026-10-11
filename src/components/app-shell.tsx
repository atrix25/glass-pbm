"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The frame: a permanent rail on a laptop, a drawer on a phone.
 *
 * The navigation is 236px wide, which is a quarter of a desktop window and
 * three fifths of a phone. Left as it was, every page below the fold rendered
 * into about 150px of usable width and wrapped headings one word per line, so
 * the rail has to get out of the way under `lg` and come back unchanged above
 * it.
 *
 * Closing on navigation is done by watching for a click on a link inside the
 * drawer rather than by reacting to the pathname changing. Both work, but the
 * click fires before the new route renders, so the drawer is already sliding
 * away while the page loads instead of blinking shut afterwards.
 */
export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);

    // The drawer covers the page, so the page behind it should not scroll.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div className="flex min-h-screen bg-ink-50/70">
      {/* Tapping beside the drawer closes it. Hidden from assistive tech on
          purpose: it duplicates the close button and Escape, and announcing a
          third nameless control would only be noise. */}
      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[264px] max-w-[85vw] flex-col border-r border-ink-200/80 bg-ink-50 transition-transform duration-200 ease-out",
          "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[236px] lg:max-w-none lg:translate-x-0 lg:bg-ink-100/40 lg:shadow-none lg:transition-none",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        )}
        // Any link in here is a navigation, and a drawer that stays open over
        // the page it just opened is the most common way to get this wrong.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="absolute right-1.5 top-1.5 rounded-md p-2.5 text-ink-500 transition hover:bg-ink-200/60 hover:text-ink-800 lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-ink-200/70 bg-white/90 px-4 py-2 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            className="-ml-1 rounded-md p-2 text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="relative flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-glass-400 to-glass-700">
            <span className="h-2.5 w-2.5 rounded-[2px] border-[1.5px] border-white/90" />
          </span>
          <span className="text-[14px] font-semibold tracking-tight text-ink-900">
            Glass
          </span>
          <span className="ml-auto rounded bg-ink-200/70 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
            ETG0013
          </span>
        </div>

        {children}
      </div>
    </div>
  );
}
