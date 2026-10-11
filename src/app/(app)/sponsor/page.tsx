import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  ProportionBar,
  SectionTitle,
  SimulatedBadge,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { ChannelBarChart, SpendTrendChart } from "@/components/charts";
import {
  getBasisMix,
  getBookTotals,
  getChannelMix,
  getLevelMix,
  getMonthlyTrend,
  getRejectMix,
  getTopDrugs,
} from "@/lib/queries/sponsor";
import { getClock } from "@/lib/session";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatNumber, formatPercent, levelMeta } from "@/lib/utils";
import { PRICING_ARM_LABEL } from "@/lib/engine/types";
import { WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";

export const dynamic = "force-dynamic";

const BASIS_TO_ARM: Record<string, keyof typeof PRICING_ARM_LABEL> = {
  "3": "AWP_MINUS",
  "7": "MAC",
  "20": "NADAC",
  "5": "UANDC",
  "1": "SUBMITTED",
};

export default async function SponsorDashboard() {
  const clock = await getClock();
  const [totals, channels, levels, trend, rejects, topDrugs, basis] =
    await Promise.all([
      getBookTotals(clock),
      getChannelMix(clock),
      getLevelMix(clock),
      getMonthlyTrend(clock),
      getRejectMix(clock),
      getTopDrugs(clock, 10),
      getBasisMix(clock),
    ]);

  const netPlanCostCents = totals.planPaidCents - totals.rebateCents;
  /*
   * Per member per month is a rate, so it has to divide by the months that
   * have actually elapsed rather than by twelve. Dividing a partial year by a
   * full one would understate the plan's true run rate by nearly half in
   * midsummer, which is the kind of error a sponsor notices.
   */
  const monthsElapsed = Math.max(1, clock.yearElapsed * 12);
  const pmpm = Math.round(netPlanCostCents / totals.members / monthsElapsed);
  const gdr =
    totals.genericClaims / Math.max(1, totals.genericClaims + totals.brandClaims);
  const specialtyShare =
    totals.specialtyBilledCents / Math.max(1, totals.totalBilledCents);
  const marginOverAcquisition =
    totals.totalBilledCents - totals.nadacTotalCents - totals.dispensingFeeCents;
  const adminFeeCents =
    totals.members * 12 * WISCONSIN_CONTRACT.adminFeePmpmCommercialCents;

  return (
    <div className="space-y-6">
      <SectionTitle
        description="Steel Potatoes LLC, self-insured commercial line of business, plan year 2026, priced on the published Navitus ETG0013 rate card. Every figure on this page is a sum over individual adjudicated claims, and any claim will show the derivation that produced it."
        action={
          <Link
            href="/claims"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-ink-800"
          >
            Open the claim ledger
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        Plan sponsor dashboard
      </SectionTitle>

      {/* Headline */}
      <Card>
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Net plan cost"
            value={formatCentsCompact(netPlanCostCents)}
            sub={`${formatCents(totals.planPaidCents)} paid less ${formatCents(totals.rebateCents)} in rebates`}
          />
          <Stat
            label="Per member per month"
            value={formatCents(pmpm)}
            sub={`${formatNumber(totals.members)} members, ${(totals.claimsPaid / totals.members).toFixed(1)} scripts each`}
          />
          <Stat
            label="Member out of pocket"
            value={formatCentsCompact(totals.memberPaidCents)}
            sub={`${formatPercent(totals.memberPaidCents / totals.totalBilledCents)} of total cost`}
          />
          <Stat
            label="Retained by PBM"
            value={formatCents(totals.spreadCents)}
            tone={totals.spreadCents === 0 ? "positive" : "negative"}
            sub="Billed to the plan minus paid to the pharmacy, summed over every claim"
          />
        </div>
      </Card>

      {/* The pass-through claim, stated as a checkable identity */}
      <Card className="border-emerald-600/25 bg-emerald-50/40">
        <div className="flex items-start gap-3.5 px-5 py-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold text-emerald-900">
              Pass-through holds on all {formatNumber(totals.claimsPaid)} paid claims
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-emerald-900/75">
              The amount billed to the plan equals the amount remitted to the
              pharmacy on every single claim, so the sum of the differences is
              exactly {formatCents(totals.spreadCents)}. This is not a
              reconciliation performed after the fact. The engine reads one rate
              row for both sides, which makes spread structurally impossible
              rather than contractually discouraged.{" "}
              <Link
                href="/proof#invariants"
                className="font-medium underline decoration-emerald-600/40 underline-offset-2 hover:decoration-emerald-700"
              >
                See the invariant test
              </Link>
              .
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Monthly spend"
            description="Plan paid and member paid, by month of service."
          />
          <div className="px-3 py-4">
            <SpendTrendChart data={trend} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Where the money goes"
            description="Decomposition of every dollar billed to the plan."
          />
          <div className="space-y-4 px-5 py-4">
            <ProportionBar
              segments={[
                {
                  label: "Pharmacy acquisition cost",
                  value: totals.nadacTotalCents,
                  className: "bg-glass-600",
                },
                {
                  label: "Dispensing fees",
                  value: totals.dispensingFeeCents,
                  className: "bg-glass-300",
                },
                {
                  label: "Pharmacy margin over acquisition",
                  value: Math.max(0, marginOverAcquisition),
                  className: "bg-amber-400",
                },
              ]}
            />
            <dl className="space-y-2.5 text-[13px]">
              <Split
                swatch="bg-glass-600"
                label="Pharmacy acquisition cost (NADAC)"
                value={formatCents(totals.nadacTotalCents)}
                note="Published CMS survey of invoice prices"
              />
              <Split
                swatch="bg-glass-300"
                label="Dispensing fees"
                value={formatCents(totals.dispensingFeeCents)}
                note="Exhibit C guaranteed fee, per fill"
              />
              <Split
                swatch="bg-amber-400"
                label="Pharmacy margin over acquisition"
                value={formatCents(marginOverAcquisition)}
                note="Kept by the dispensing pharmacy, not the PBM"
              />
              <Split
                swatch="bg-ink-900"
                label="PBM administrative fee"
                value={formatCents(adminFeeCents)}
                note={`${formatCents(WISCONSIN_CONTRACT.adminFeePmpmCommercialCents)} per member per month, invoiced separately from claims`}
              />
            </dl>
            <p className="text-[12px] leading-relaxed text-ink-500">
              The margin line is what the pharmacy earns above its acquisition
              cost. Under this contract the PBM takes none of it. Under a spread
              contract, some share of that band is the PBM&apos;s revenue and the
              plan cannot see the split.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Channel mix"
            description="Specialty is a rounding error in script count and the majority of the spend."
          />
          <div className="px-3 pt-3">
            <ChannelBarChart data={channels} />
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Channel</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Plan cost</Th>
                <Th align="right">Share</Th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel}>
                  <Td>{c.channel}</Td>
                  <Td align="right">{formatNumber(c.claims)}</Td>
                  <Td align="right">{formatCents(c.billedCents)}</Td>
                  <Td align="right" className="text-ink-500">
                    {formatPercent(c.billedCents / totals.totalBilledCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-ink-100 px-5 py-3 text-[12.5px] text-ink-500">
            {formatNumber(totals.specialtyClaims)} specialty claims,{" "}
            {formatPercent(totals.specialtyClaims / totals.claimsPaid)} of
            scripts, are {formatPercent(specialtyShare)} of plan cost.
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Which pricing arm won"
            description="Basis of reimbursement, NCPDP field 522-FM, counted across paid claims."
          />
          <Table>
            <thead>
              <tr>
                <Th>Winning arm</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Share</Th>
                <Th align="right">Plan cost</Th>
              </tr>
            </thead>
            <tbody>
              {basis.map((b) => {
                const arm = BASIS_TO_ARM[b.basis];
                return (
                  <tr key={b.basis}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span>{arm ? PRICING_ARM_LABEL[arm] : b.basis}</span>
                        {arm === "AWP_MINUS" ? <SimulatedBadge /> : null}
                        {arm === "NADAC" ? (
                          <Badge tone="positive">verifiable</Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td align="right">{formatNumber(b.claims)}</Td>
                    <Td align="right" className="text-ink-500">
                      {formatPercent(b.claims / totals.claimsPaid)}
                    </Td>
                    <Td align="right">{formatCents(b.billedCents)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="border-t border-ink-100 px-5 py-3 text-[12.5px] leading-relaxed text-ink-500">
            The lesser-of includes the NADAC acquisition benchmark and the
            pharmacy&apos;s own cash price. When either of those wins, the price
            the plan pays is checkable against a public file. The AWP arm is the
            only one that is not.
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader
            title="Highest cost drugs"
            description="Ranked by total amount billed to the plan."
            action={
              <Link
                href="/claims"
                className="text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
              >
                Filter the ledger
              </Link>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Drug</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Plan cost</Th>
                <Th align="right">Rebate</Th>
              </tr>
            </thead>
            <tbody>
              {topDrugs.map((d) => (
                <tr key={d.drugId}>
                  <Td>
                    <Link
                      href={`/claims?drug=${encodeURIComponent(d.drugId)}`}
                      className="font-medium text-ink-900 hover:text-glass-700"
                    >
                      {d.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {d.isSpecialty ? (
                        <Badge tone="accent">specialty</Badge>
                      ) : null}
                      <span className="truncate text-[11.5px] text-ink-500">
                        {d.therapeuticClass ?? "Unclassified"}
                      </span>
                    </div>
                  </Td>
                  <Td align="right">{formatNumber(d.claims)}</Td>
                  <Td align="right">{formatCents(d.billedCents)}</Td>
                  <Td align="right" className="text-emerald-700">
                    {d.rebateCents ? formatCents(d.rebateCents) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Benefit level mix"
              description="Level 1 and 2 cost share reaches the $600 prescription limit. Level 3 and 4 does not."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Level</Th>
                  <Th align="right">Claims</Th>
                  <Th align="right">Member paid</Th>
                </tr>
              </thead>
              <tbody>
                {levels.map((l) => {
                  const meta = levelMeta(l.level);
                  return (
                    <tr key={l.level}>
                      <Td>
                        <Badge className={meta.className}>{meta.label}</Badge>
                      </Td>
                      <Td align="right">{formatNumber(l.claims)}</Td>
                      <Td align="right">{formatCents(l.memberPaidCents)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader
              title="Rejected claims"
              description={`${formatNumber(totals.claimsRejected)} of ${formatNumber(totals.claimsSubmitted)} submissions rejected. Each one is a member standing at a counter.`}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Reject</Th>
                  <Th align="right">Claims</Th>
                  <Th align="right">Members</Th>
                </tr>
              </thead>
              <tbody>
                {rejects.map((r) => (
                  <tr key={r.code}>
                    <Td>
                      <Link
                        href={`/claims?status=R&reject=${r.code}`}
                        className="hover:text-glass-700"
                      >
                        <span className="tnum mr-1.5 rounded bg-rose-50 px-1 py-0.5 text-[11px] font-medium text-rose-800 ring-1 ring-inset ring-rose-600/20">
                          {r.code}
                        </span>
                        {r.message}
                      </Link>
                    </Td>
                    <Td align="right">{formatNumber(r.claims)}</Td>
                    <Td align="right">{formatNumber(r.members)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Contract at a glance"
          description="The terms this plan is priced on: contract ETG0013 between Wisconsin ETF and Navitus Health Solutions, as published. Steel Potatoes is an invented employer; these rates are not."
        />
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Pricing model"
            value="Pass-through"
            note="Client and pharmacy rate tables are the same row"
          />
          <Fact
            label="Administrative fee"
            value="$1.95 PMPM"
            note="Commercial line of business"
          />
          <Fact
            label="Rebate pass-through"
            value="100%"
            note="Less a $0.40 PMPM rebate administration fee, Amendment 5"
          />
          <Fact
            label="Generic dispensing rate"
            value={formatPercent(gdr)}
            note={`${formatNumber(totals.genericClaims)} generic of ${formatNumber(totals.genericClaims + totals.brandClaims)} paid claims`}
          />
        </div>
      </Card>
    </div>
  );
}

function Split({
  swatch,
  label,
  value,
  note,
}: {
  swatch: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-sm ${swatch}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ink-800">{label}</span>
          <span className="tnum shrink-0 font-medium text-ink-900">{value}</span>
        </div>
        <p className="text-[11.5px] text-ink-500">{note}</p>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="bg-white px-5 py-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
        {label}
      </div>
      <div className="mt-1 text-[17px] font-semibold tracking-tight text-ink-900">
        {value}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-ink-500">{note}</p>
    </div>
  );
}
