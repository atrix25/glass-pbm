import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  IncumbentNote,
  ProportionBar,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  getRecoveryOverview,
  getReversalOverview,
} from "@/lib/queries/reversals";
import { getClock } from "@/lib/session";
import { formatCentsWhole, formatCentsCompact } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReversalsPage() {
  const clock = await getClock();
  const [rev, rec] = await Promise.all([
    getReversalOverview(clock),
    getRecoveryOverview(clock),
  ]);

  const maxReason = Math.max(1, ...rev.reasons.map((r) => r.count));

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`A fill that never left the counter is not a fill. ${formatNumber(rev.reversals)} reversals have come back so far this year, and ${formatNumber(rec.claims)} more claims were paid for people whose employer had not yet told anyone they had left.`}
        action={
          <Link
            href="/claims"
            className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
          >
            Claim detail
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        Reversals and recoveries
      </SectionTitle>

      <IncumbentNote>
        Every demo shows the happy path. The gap between a demo and a processor
        is what happens when the fill does not happen: the pharmacy&rsquo;s
        remittance has to shrink, the plan&rsquo;s invoice has to shrink, and
        the member&rsquo;s deductible has to give the money back. A system that
        cannot unwind a claim exactly will overstate spend by roughly two per
        cent forever, which on this book is{" "}
        {formatCentsCompact(Math.abs(rev.planPaidCents))} the plan would be
        billed for prescriptions nobody collected. Contract ETG0013 charges
        nothing extra to get this right, and no incumbent has ever put it on a
        line item, because it is table stakes rather than a feature.
      </IncumbentNote>

      {/* ------------------------------------------------------------------ */}
      {/* Reversals                                                          */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="B2 reversals"
          description="The pharmacy tells the processor a fill it already adjudicated did not happen. The reversal carries the original date of service, so the money backs out of the day it was booked to rather than the day it came back."
        />
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Reversals to date"
            value={formatNumber(rev.reversals)}
            sub={`${(rev.reversalRateBps / 100).toFixed(2)}% of paid fills`}
          />
          <Stat
            label="Backed out of plan cost"
            value={formatCentsCompact(Math.abs(rev.planPaidCents))}
            tone="positive"
            sub="Never billed to the sponsor"
          />
          <Stat
            label="Returned to members"
            value={formatCentsCompact(Math.abs(rev.patientPayCents))}
            tone="positive"
            sub="Copays credited back to accumulators"
          />
          <Stat
            label="Median time to reverse"
            value={`${rev.medianLagDays} days`}
            sub={`${rev.withinFourteenDaysPct}% inside fourteen days`}
          />
        </div>

        <div className="grid grid-cols-1 divide-y divide-ink-200/70 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Why they came back
            </div>
            <div className="mt-3 space-y-3">
              {rev.reasons.map((r) => (
                <div key={r.reason}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-ink-800">{r.reason}</span>
                    <span className="tnum shrink-0 text-[12.5px] text-ink-500">
                      {formatNumber(r.count)}
                      <span className="ml-2 text-ink-400">
                        {formatCentsCompact(Math.abs(r.planPaidCents))}
                      </span>
                    </span>
                  </div>
                  <ProportionBar
                    className="mt-1.5"
                    segments={[
                      {
                        label: r.reason,
                        value: r.count,
                        className: "bg-glass-500",
                      },
                      {
                        label: "rest",
                        value: maxReason - r.count,
                        className: "bg-transparent",
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-ink-500">
              Reversal reasons are modeled against customary NCPDP practice. The
              distribution is illustrative; the accounting behind each one is
              not.
            </p>
          </div>

          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              What a reversal has to unwind
            </div>
            <dl className="mt-3 space-y-2.5 text-[13px] leading-relaxed">
              {[
                [
                  "Pharmacy remittance",
                  "The negative lands in the same semi-monthly cycle the original was paid in, or the next one if that cycle has closed.",
                ],
                [
                  "Sponsor invoice",
                  "Plan paid reverses at the original amount. Pass-through means one number moves on both sides.",
                ],
                [
                  "Member accumulators",
                  "Deductible and out-of-pocket credit is withdrawn, which can move a member back across a phase boundary.",
                ],
                [
                  "Rebate accrual",
                  "The estimated rebate reverses too, so the receivable does not include a fill that never happened.",
                ],
                [
                  "Daily rollup",
                  "Carried in its own columns rather than netted, so a day's paid total stays a paid total.",
                ],
              ].map(([term, def]) => (
                <div key={term}>
                  <dt className="font-medium text-ink-900">{term}</dt>
                  <dd className="text-ink-600">{def}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Most recent reversals"
          description="Each row points back at the original claim, which is still in the book and still reproducible."
        />
        {rev.recent.length === 0 ? (
          <EmptyState title="No reversals yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reversal</Th>
                <Th>Original</Th>
                <Th>Drug</Th>
                <Th>Pharmacy</Th>
                <Th align="right">Filled</Th>
                <Th align="right">Reversed</Th>
                <Th align="right">Lag</Th>
                <Th align="right">Plan</Th>
                <Th align="right">Member</Th>
              </tr>
            </thead>
            <tbody>
              {rev.recent.map((r) => (
                <tr key={r.claimNumber} className="hover:bg-ink-50/60">
                  <Td className="font-mono text-[12px]">{r.claimNumber}</Td>
                  <Td className="font-mono text-[12px]">
                    {r.originalClaimNumber ? (
                      <Link
                        href={`/claims/${r.originalClaimNumber}`}
                        className="text-glass-700 hover:text-glass-900"
                      >
                        {r.originalClaimNumber}
                      </Link>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </Td>
                  <Td className="max-w-[220px] truncate" title={r.drugName}>
                    {r.drugName}
                  </Td>
                  <Td
                    className="max-w-[180px] truncate text-ink-600"
                    title={r.pharmacyName}
                  >
                    {r.pharmacyName}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(r.dateOfService)}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(r.reversedAt)}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {r.lagDays}d
                  </Td>
                  <Td align="right" className="text-emerald-700">
                    {formatCentsWhole(r.planPaidCents)}
                  </Td>
                  <Td align="right" className="text-emerald-700">
                    {formatCentsWhole(r.patientPayCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Retroactive terminations                                           */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Retroactive terminations"
          description="An employer reports a leaver weeks after they left. Nothing about the claims paid in between was wrong when they adjudicated — they were correct against eligibility as it stood. They are recoverable because eligibility changed underneath them."
        />
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Members reported late"
            value={formatNumber(rec.membersAffected)}
            sub="With claims after the termination date"
          />
          <Stat
            label="Claims outside coverage"
            value={formatNumber(rec.claims)}
            sub="Paid before the file arrived"
          />
          <Stat
            label="Recoverable from the network"
            value={formatCentsWhole(rec.planPaidCents)}
            tone="negative"
            sub="Plan paid on terminated coverage"
          />
          <Stat
            label="Median reporting lag"
            value={`${rec.medianLagDays} days`}
            sub="Termination date to eligibility file"
          />
        </div>

        {rec.worst.length === 0 ? (
          <EmptyState
            title="No retroactive terminations reported yet"
            description="The clock has not reached the date any of the late eligibility files arrived."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th align="right">Terminated</Th>
                <Th align="right">Reported</Th>
                <Th align="right">Lag</Th>
                <Th align="right">Last fill</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Recoverable</Th>
              </tr>
            </thead>
            <tbody>
              {rec.worst.map((r) => (
                <tr key={r.memberId} className="hover:bg-ink-50/60">
                  <Td>
                    <Link
                      href={`/members/${r.memberId}`}
                      className="text-glass-700 hover:text-glass-900"
                    >
                      {r.memberName}
                    </Link>
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(r.terminationDate)}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(r.reportedAt)}
                  </Td>
                  <Td align="right">
                    <Badge tone={r.reportingLagDays > 60 ? "negative" : "warn"}>
                      {r.reportingLagDays}d
                    </Badge>
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(r.lastFill)}
                  </Td>
                  <Td align="right">{r.claims}</Td>
                  <Td align="right" className="font-medium text-rose-700">
                    {formatCentsWhole(r.planPaidCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-ink-200/70 px-5 py-4 text-[12.5px] leading-relaxed text-ink-500">
          The recovery worklist is a query, not a correction. No claim in the
          book has been altered: each one is still exactly what the engine
          decided on the day, and still reproduces step for step. What changed
          is the eligibility span underneath it, which is why this list can only
          ever be produced after the fact, and why running it is the difference
          between {formatCentsWhole(rec.planPaidCents)} recovered and{" "}
          {formatCentsWhole(rec.planPaidCents)} written off.
        </div>
      </Card>
    </div>
  );
}
