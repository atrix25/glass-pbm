import { ArrowRight } from "lucide-react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { getClinicalOverview, listTopAlerts } from "@/lib/queries/clinical";
import { MME_THRESHOLDS } from "@/lib/clinical/opioids";
import { getClock } from "@/lib/session";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ClinicalPage() {
  const clock = await getClock();
  const [overview, alerts] = await Promise.all([
    getClinicalOverview(clock),
    listTopAlerts(clock, 20),
  ]);

  const fired = overview.interactions.filter((r) => r.alerts > 0);
  const silent = overview.interactions.filter((r) => r.alerts === 0);

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`Every paid fill screened against the member's active therapy: interactions, duplicate therapy, and cumulative opioid dose. ${formatNumber(overview.claimsScreened)} claims screened, ${formatNumber(overview.totalAlerts)} conflicts raised across ${formatNumber(overview.membersAffected)} members.`}
        action={
          <Link
            href="/pos"
            className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
          >
            Point of sale
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        Clinical safety
      </SectionTitle>

      <Card>
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Major conflicts"
            value={formatNumber(overview.majorAlerts)}
            tone="negative"
            sub="NCPDP severity index 1: the ones a pharmacist must resolve before dispensing"
          />
          <Stat
            label="Members affected"
            value={formatNumber(overview.membersAffected)}
            sub={`${((overview.membersAffected / Math.max(1, overview.membersScreened)) * 100).toFixed(1)}% of members with a paid claim`}
          />
          <Stat
            label={`At or above ${MME_THRESHOLDS.avoidOrJustify} MME`}
            value={formatNumber(overview.dose.atCeiling)}
            tone={overview.dose.atCeiling > 0 ? "negative" : "positive"}
            sub="Fills where the member's total daily opioid dose reached the CDC ceiling"
          />
          <Stat
            label="Peak daily dose"
            value={`${formatNumber(overview.dose.peakMme)} MME`}
            sub={`Highest total in the book, against a ${MME_THRESHOLDS.avoidOrJustify} MME guideline`}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Conflicts by NCPDP code"
          description="These are the conflict codes on the real DUR/PPS response segment, not private inventions, so a pharmacy system would understand every one of them without translation."
        />
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Conflict</Th>
              <Th align="right">Alerts</Th>
              <Th align="right">Members</Th>
            </tr>
          </thead>
          <tbody>
            {overview.byCode.map((c) => (
              <tr key={c.code}>
                <Td>
                  <Badge tone="neutral">{c.code}</Badge>
                </Td>
                <Td>
                  <span className="text-[13px] text-ink-800">{c.label}</span>
                </Td>
                <Td align="right" className="tnum">
                  {formatNumber(c.alerts)}
                </Td>
                <Td align="right" className="tnum">
                  {formatNumber(c.members)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="Interaction rules that fired"
          description="Each rule names the published document behind it. Screening is on therapeutic class or ingredient, and the ingredient match runs against a product name transcribed from a PDF, which is the weakest link in the chain."
        />
        {fired.length === 0 ? (
          <EmptyState title="No interactions found" />
        ) : (
          <div className="divide-y divide-ink-200/70">
            {fired
              .sort((a, b) => b.alerts - a.alerts)
              .map((r) => (
                <div key={r.rule.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[13.5px] font-semibold text-ink-900">
                      {r.rule.a.label} with {r.rule.b.label.toLowerCase()}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={r.rule.severity === "Major" ? "negative" : "warn"}
                      >
                        {r.rule.severity}
                      </Badge>
                      <span className="tnum whitespace-nowrap text-[12.5px] text-ink-600">
                        {formatNumber(r.alerts)} alerts, {formatNumber(r.members)}{" "}
                        members
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 max-w-4xl text-[13px] leading-relaxed text-ink-700">
                    {r.rule.effect}
                  </p>
                  <p className="mt-1 max-w-4xl text-[12.5px] leading-relaxed text-ink-500">
                    {r.rule.mechanism}
                  </p>
                  <p className="mt-1.5 max-w-4xl text-[12.5px] leading-relaxed text-glass-800">
                    {r.rule.citation}
                  </p>
                </div>
              ))}
          </div>
        )}
      </Card>

      {silent.length > 0 ? (
        <Card>
          <CardHeader
            title="Rules that found nothing"
            description="Worth showing rather than hiding. A rule that screened tens of thousands of fills and found no conflict is a result; a rule whose drugs nobody in this population filled is not, and the fill counts tell you which is which."
          />
          <Table>
            <thead>
              <tr>
                <Th>Rule</Th>
                <Th align="right">Fills on one side</Th>
                <Th align="right">Fills on the other</Th>
                <Th>Why nothing fired</Th>
              </tr>
            </thead>
            <tbody>
              {silent.map((r) => {
                const nothingToScreen = r.sideAFills === 0 || r.sideBFills === 0;
                return (
                  <tr key={r.rule.id}>
                    <Td>
                      <span className="block max-w-[18rem] text-[13px] text-ink-800">
                        {r.rule.a.label} with {r.rule.b.label.toLowerCase()}
                      </span>
                    </Td>
                    <Td align="right" className="tnum">
                      {formatNumber(r.sideAFills)}
                    </Td>
                    <Td align="right" className="tnum">
                      {formatNumber(r.sideBFills)}
                    </Td>
                    <Td>
                      <span className="text-[12.5px] text-ink-500">
                        {nothingToScreen
                          ? "Nothing to screen: no paid fills on one side."
                          : "Screened in full; no member held both concurrently."}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Opioid dose"
          description={`Daily morphine milligram equivalents, summed across every opioid a member holds at once. Strength comes from the NDC description in the CMS NADAC file and the conversion factors are the CDC's, so the arithmetic is checkable end to end.`}
        />
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={`${MME_THRESHOLDS.reassess} to ${MME_THRESHOLDS.avoidOrJustify} MME`}
            value={formatNumber(overview.dose.atReassess)}
            sub="The CDC advises reassessing benefits and risks in this range"
          />
          <Stat
            label={`${MME_THRESHOLDS.avoidOrJustify} MME and above`}
            value={formatNumber(overview.dose.atCeiling)}
            tone="negative"
            sub="The CDC advises against going higher without careful justification"
          />
          <Stat
            label="Members"
            value={formatNumber(overview.dose.members)}
            sub="Distinct members reaching either threshold at some point in the year"
          />
          <Stat
            label="Products converted"
            value={`${overview.dose.convertibleProducts} of ${overview.dose.convertibleProducts + overview.dose.excludedProducts}`}
            sub="Buprenorphine is excluded from the dose total rather than guessed at, on the CDC's own advice"
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Highest-risk open conflicts"
          description="Major-severity alerts, ranked by dose. Each one names a real member and a real claim, because an alert that cannot be traced to a fill cannot be worked."
        />
        {alerts.length === 0 ? (
          <EmptyState title="No major conflicts" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Filled</Th>
                <Th>Conflict</Th>
                <Th align="right">Dose</Th>
                <Th>Finding</Th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link
                      href={`/members/${a.memberId}`}
                      className="whitespace-nowrap text-[13px] font-medium text-glass-700 hover:text-glass-900"
                    >
                      {a.memberName}
                    </Link>
                    <div className="whitespace-nowrap text-[12px] text-ink-500">
                      {formatDate(a.dateOfService)}
                    </div>
                  </Td>
                  <Td>
                    <Link
                      href={`/claims/${a.claimId}`}
                      className="block max-w-[13rem] truncate text-[12.5px] text-glass-700 hover:text-glass-900"
                    >
                      {a.drugName}
                    </Link>
                    {a.relatedDrugName ? (
                      <div className="block max-w-[13rem] truncate text-[12px] text-ink-500">
                        with {a.relatedDrugName}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone="negative">{a.reasonCode}</Badge>
                  </Td>
                  <Td align="right" className="tnum">
                    {a.observedMme ? (
                      `${Math.round(a.observedMme)} MME`
                    ) : a.overlapDays > 0 ? (
                      <span className="text-ink-500">{a.overlapDays}d overlap</span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </Td>
                  <Td>
                    <span className="block max-w-[26rem] text-[12.5px] leading-snug text-ink-600">
                      {a.message}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="What this is, and what it is not" />
        <div className="space-y-3 px-5 py-4 text-[13px] leading-relaxed text-ink-600">
          <p>
            Commercial adjudication screens against a licensed clinical database
            — First Databank or Medi-Span — carrying hundreds of thousands of
            pairs maintained by a clinical staff. That is a genuine asset and
            this is not a substitute for it. What is here is a hand-encoded set
            of the interactions that matter most in a commercial book, every one
            traceable to FDA labelling or a safety communication rather than to
            anybody&rsquo;s judgement.
          </p>
          <p>
            The claim being made is narrower than &ldquo;we replicated Medi-Span
            &rdquo; and more uncomfortable than it sounds. The machinery around
            the database — screening every fill against active therapy, scoring
            severity, returning a conflict code the pharmacy can act on,
            surfacing the backlog to a clinical team — is a join and a rule
            table. Licensing the pairs costs money. Building everything else
            took an afternoon.
          </p>
          <p>
            The dose arithmetic has no such caveat. Strength is parsed from the
            NDC description in the CMS NADAC file in this repository, quantity
            and days supply come off the claim, and the conversion factors are
            the CDC&rsquo;s published table. Every input is public and the
            output is checkable by hand.
          </p>
        </div>
      </Card>
    </div>
  );
}
