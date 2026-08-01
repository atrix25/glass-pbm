"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, LogOut } from "lucide-react";
import { ROLES, type Role } from "@/lib/roles";
import { switchRole, signOut } from "@/app/actions/session";
import { cn } from "@/lib/utils";

export function RoleSwitcher({ current }: { current: Role }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = ROLES.find((r) => r.id === current) ?? ROLES[0];

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
        className="flex w-full items-center gap-2.5 rounded-lg border border-ink-200/80 bg-white px-2.5 py-2 text-left transition hover:border-ink-300"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-glass-600 text-[11px] font-semibold text-white">
          {active.label
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-tight text-ink-900">
            {active.label}
          </span>
          <span className="block truncate text-[11px] leading-tight text-ink-500">
            {active.who}
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      </button>

      {open ? (
        <div className="animate-fade-up absolute bottom-full left-0 z-50 mb-2 w-[280px] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_16px_40px_-12px_rgba(18,22,31,0.28)]">
          <div className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-400">
            View the system as
          </div>
          {ROLES.map((role) => (
            <form key={role.id} action={switchRole}>
              <input type="hidden" name="role" value={role.id} />
              <button
                type="submit"
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-ink-50",
                  role.id === current && "bg-glass-50/60",
                )}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    role.id === current ? "text-glass-600" : "text-transparent",
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink-900">
                    {role.label}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-500">
                    {role.who}
                  </span>
                </span>
              </button>
            </form>
          ))}
          <form action={signOut} className="border-t border-ink-200">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink-600 transition hover:bg-ink-50"
            >
              <LogOut className="h-3.5 w-3.5 text-ink-400" />
              Back to sign in
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
