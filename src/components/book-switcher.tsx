"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { BOOKS, type BookDefinition } from "@/lib/book-context";
import { switchBook } from "@/app/actions/session";
import { cn } from "@/lib/utils";

export function BookSwitcher({ current }: { current: BookDefinition }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-ink-200/80 bg-white px-2.5 py-2 text-left transition hover:border-ink-300"
        aria-label="Switch live book"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-tight text-ink-900">
            {current.label}
          </span>
          <span className="block truncate text-[11px] leading-tight text-ink-500">
            {current.description}
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      </button>

      {open ? (
        <div className="animate-fade-up absolute bottom-full left-0 z-50 mb-2 w-[280px] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_16px_40px_-12px_rgba(18,22,31,0.28)]">
          <div className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-400">
            Live book
          </div>
          {BOOKS.map((book) => (
            <form key={book.id} action={switchBook}>
              <input type="hidden" name="book" value={book.id} />
              <input type="hidden" name="next" value="/sponsor" />
              <button
                type="submit"
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-ink-50",
                  book.id === current.id && "bg-glass-50/60",
                )}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    book.id === current.id ? "text-glass-600" : "text-transparent",
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink-900">
                    {book.label}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-500">
                    {book.description}
                  </span>
                </span>
              </button>
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}
