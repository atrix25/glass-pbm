"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

export function NcpdpPanel({
  claim,
}: {
  claim: {
    request: Record<string, string>;
    response: Record<string, string>;
  };
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-ink-900">
            NCPDP D.0 transaction
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-500">
            The wire-level request and response, in the standard the pharmacy
            actually spoke.
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-ink-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="animate-fade-up grid gap-px border-t border-ink-200/70 bg-ink-200/60 lg:grid-cols-2">
          <Fields title="B1 Billing request" data={claim.request} />
          <Fields title="Response" data={claim.response} />
        </div>
      ) : null}
    </Card>
  );
}

function Fields({
  title,
  data,
}: {
  title: string;
  data: Record<string, string>;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        {title}
      </div>
      <dl className="space-y-[3px]">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-[10.5px] text-ink-500">{k}</dt>
            <dd className="tnum shrink-0 font-mono text-[11px] text-ink-900">
              {v || "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
