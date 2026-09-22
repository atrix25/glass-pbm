import { DataAgent } from "@/components/data-agent";
import { SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

const SUGGESTIONS = [
  "What step therapy and PA rules exist on our highest-cost drugs?",
  "How many drugs on the formulary require step therapy?",
  "What's in the prior auth queue?",
  "How are MAC appeals performing against the 21-day statute?",
  "What's our census NPS and top complaint driver?",
  "Which pricing guarantees missed?",
  "Write the year-end rebate briefing",
  "What drove PMPM last period?",
  "Show top claim reject codes",
  "Any high-severity integrity signals?",
];

export default function DataAgentPage() {
  return (
    <div className="space-y-4">
      <SectionTitle description={"Explore plan data and create report briefings."}>
        Data agent
      </SectionTitle>

      <p className="rounded-lg border border-ink-200 bg-ink-50/60 px-4 py-2.5 text-[12.5px] leading-relaxed text-ink-600">
        For benefits and finance. Read-only: it will not change benefits (that
        is the plan-design agent) and it will not answer member clinical
        questions (that is member service). Ask for totals, guarantees,
        rebates, trends, settlement, prior auth, MAC appeals, member NPS,
        program integrity, claim reject codes, eligibility feed, formulary step
        therapy and PA rules, or say “write the year-end report briefing.”
      </p>

      <DataAgent suggestions={SUGGESTIONS} />
    </div>
  );
}
