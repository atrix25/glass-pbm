import { Card, SectionTitle } from "@/components/ui";
import { PosTerminal } from "@/components/pos-terminal";
import type { TraceSource } from "@/components/trace-viewer";
import { getPosPickers } from "@/lib/queries/pos";
import { getClock } from "@/lib/session";
import { SOURCES } from "@/lib/sources";

export const dynamic = "force-dynamic";

const SOURCE_MAP: Record<string, TraceSource> = Object.fromEntries(
  SOURCES.map((s) => [
    s.id,
    { id: s.id, title: s.title, publisher: s.publisher, url: s.url },
  ]),
);

export default async function PosPage() {
  const clock = await getClock();
  const { members, drugs, pharmacies, prescribers, scenarios, defaultDate } =
    await getPosPickers(clock.now);

  return (
    <div className="space-y-5">
      <SectionTitle description="A pharmacy transmits a claim and gets an answer back in under a second, and the member finds out what they owe when the pharmacist says a number out loud. This is that transaction, run live against the real engine, with the derivation attached.">
        Pharmacy point of sale
      </SectionTitle>

      <Card className="border-glass-600/25 bg-glass-50/40">
        <p className="px-5 py-3.5 text-[13px] leading-relaxed text-ink-700">
          Try transmitting a specialty drug for a member with no authorization
          on file, or the same fill twice in a week, or a brand with DAW 1 when
          a generic exists. Each produces a different NCPDP reject with the rule
          that caused it. That is the difference between a benefit that can be
          explained and one that can only be appealed. Clinical screening runs
          on the same transmission and comes back in the DUR/PPS segment, which
          advises the pharmacist without changing what the claim pays.
        </p>
      </Card>

      <PosTerminal
        members={members}
        drugs={drugs}
        pharmacies={pharmacies}
        prescribers={prescribers}
        scenarios={scenarios}
        sources={SOURCE_MAP}
        defaultDate={defaultDate}
      />
    </div>
  );
}
