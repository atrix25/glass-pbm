import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  SectionTitle,
  SimulatedBadge,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { SensitivityChart, WaterfallChart } from "@/components/charts";
import {
  getAwpSensitivity,
  getGuaranteeReconciliation,
  getRebateWaterfall,
  getSpreadComparison,
} from "@/lib/queries/reports";
import { getBookTotals } from "@/lib/queries/sponsor";
import { getClock } from "@/lib/session";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatNumber, formatPercent } from "@/lib/utils";
import { WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";

export const dynamic = "force-dynamic";

const bps = (n: number) => `${(n / 100).toFixed(2)}%`;

export default async function ReportsPage() {
  const clock = await getClock();
  const [guarantees, rebates, spread, awp, totals] = await Promise.all([
    getGuaranteeReconciliation(clock),
    getRebateWaterfall(clock),
    getSpreadComparison(clock),
    getAwpSensitivity(clock),
    getBookTotals(clock),
  ]);

  const missed = guarantees.filter((g) => g.met === false);
  // Administrative fees accrue per member per month, so only the months that
  // have elapsed have been billed.
  const monthsElapsed = Math.max(1, clock.yearElapsed * 12);
  const adminFeeCents = Math.round(
    totals.members *
      monthsElapsed *
      WISCONSIN_CONTRACT.adminFeePmpmCommercialCents,
  );

  return (
    <div className="space-y-6">
      <SectionTitle description={"Contract performance, rebate estimates and plan spending."}>
        Contract reporting
      </SectionTitle>

      {/* 1. Guarantees */}
      <Card>
        <CardHeader
          title="Pricing guarantee reconciliation"
          description="Exhibit C promises an aggregate discount off AWP by channel and drug class. This sums the ingredient cost actually billed against the AWP those claims carried, and divides once."
          action={
            missed.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All categories met
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-rose-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {missed.length} short of guarantee
              </span>
            )
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Category</Th>
              <Th align="right">Claims</Th>
              <Th align="right">AWP</Th>
              <Th align="right">Billed</Th>
              <Th align="right">Guaranteed</Th>
              <Th align="right">Actual</Th>
              <Th align="right">Variance</Th>
              <Th align="right">In dollars</Th>
            </tr>
          </thead>
          <tbody>
            {guarantees.map((g) => (
              <tr key={`${g.channel}-${g.scope}`}>
                <Td>
                  <span className="font-medium text-ink-900">{g.channel}</span>
                  <span className="ml-1.5 text-ink-500">
                    {g.scope === "All" ? "brand and generic" : g.scope}
                  </span>
                  {g.belowMinimumVolume ? (
                    <div className="mt-0.5">
                      <Badge tone="neutral">below 1,000 claim minimum</Badge>
                    </div>
                  ) : null}
                </Td>
                <Td align="right">{formatNumber(g.claims)}</Td>
                <Td align="right" className="text-ink-500">
                  {formatCentsCompact(g.awpCents)}
                </Td>
                <Td align="right">{formatCentsCompact(g.billedCents)}</Td>
                <Td align="right" className="text-ink-600">
                  {g.guaranteedBps != null ? bps(g.guaranteedBps) : "—"}
                </Td>
                <Td align="right" className="font-medium">
                  {bps(g.actualDiscountBps)}
                </Td>
                <Td
                  align="right"
                  className={
                    g.met === false ? "text-rose-700" : "text-emerald-700"
                  }
                >
                  {g.discountVarianceBps != null
                    ? `${g.discountVarianceBps >= 0 ? "+" : ""}${(g.discountVarianceBps / 100).toFixed(2)} pts`
                    : "—"}
                </Td>
                <Td
                  align="right"
                  className={
                    (g.dollarVarianceCents ?? 0) >= 0
                      ? "text-emerald-700"
                      : "text-rose-700"
                  }
                >
                  {g.dollarVarianceCents != null
                    ? formatCents(g.dollarVarianceCents)
                    : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="space-y-1.5 border-t border-ink-100 px-5 py-3.5 text-[12px] leading-relaxed text-ink-500">
          <p>
            Specialty is reconciled as a single category because Exhibit C
            defines that guarantee as aggregate across brand and generic.
            Splitting it would measure a specialty generic against a rate the
            contract never applied to it.
          </p>
          <p>
            Every figure in the AWP and variance columns inherits the AWP
            benchmark. <SimulatedBadge /> The next panel shows how far these
            conclusions move when that assumption is wrong.
          </p>
        </div>
      </Card>

      {/* 2. AWP sensitivity */}
      <div
        id="awp-sensitivity"
        className="grid scroll-mt-24 gap-6 lg:grid-cols-[1fr_1.15fr]"
      >
        <Card>
          <CardHeader
            title="Exposure to an unverifiable benchmark"
            description="AWP is proprietary to Medi-Span and unpublished. Exhibit C makes it the sole pricing source, so the plan cannot audit the input its own guarantees are measured against."
          />
          <div className="space-y-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
                  Priced off AWP
                </div>
                <div className="tnum mt-1 text-[20px] font-semibold text-ink-900">
                  {formatPercent(awp.awpShare)}
                </div>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {formatCentsCompact(awp.awpPricedCents)} of plan cost
                </p>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
                  Independently checkable
                </div>
                <div className="tnum mt-1 text-[20px] font-semibold text-emerald-700">
                  {formatPercent(1 - awp.awpShare)}
                </div>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {formatCentsCompact(awp.verifiableCents)}{" "}
                  priced off MAC or the pharmacy&apos;s own cash price
                </p>
              </div>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-600">
              A 10% move in the AWP file, with no change to any drug, any
              contract term, or any member&apos;s behaviour, moves plan cost by{" "}
              <span className="font-medium text-ink-900">
                {formatCents(Math.abs(awp.shifts[0].deltaCents))}
              </span>
              . That is the number to argue about, not the guarantee percentages
              above.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Plan cost against a shift in the AWP file"
            description="Everything else held constant: same drugs, same members, same utilisation."
          />
          <div className="px-3 py-4">
            <SensitivityChart data={awp.shifts} />
          </div>
          <div className="border-t border-ink-100 px-5 py-3 text-[12px] leading-relaxed text-ink-500">
            The pass-through line is flatter because only{" "}
            {formatPercent(awp.awpShare)}{" "}
            of this book is priced off AWP; the
            MAC ceiling and the pharmacy&apos;s cash price cap the rest. Under a
            spread schedule every claim tracks the file. The gap between the
            slopes is the exposure the contract removes.
          </div>
        </Card>
      </div>

      {/* 3. Rebates */}
      <Card>
        <CardHeader
          title="Rebate waterfall"
          description="Amendment 7 passes 100% of rebates to the plan. Amendment 5A takes $0.40 per member per month out of them first."
        />
        <div className="grid gap-px bg-ink-200/60 lg:grid-cols-[1.1fr_1fr]">
          <div className="bg-white px-3 py-4">
            <WaterfallChart
              data={[
                {
                  label: "Gross rebates",
                  value: rebates.grossRebateCents,
                  base: 0,
                  kind: "in",
                },
                {
                  label: "Rebate admin fee",
                  value: rebates.rebateAdminFeeCents,
                  base: rebates.netToPlanCents,
                  kind: "out",
                },
                {
                  label: "Net to plan",
                  value: rebates.netToPlanCents,
                  base: 0,
                  kind: "total",
                },
              ]}
            />
          </div>
          <div className="space-y-3 bg-white px-5 py-4">
            <Line
              label="Gross rebates earned"
              value={formatCents(rebates.grossRebateCents)}
              note={`${formatNumber(rebates.brandClaims)} brand claims, ${formatCents(rebates.perBrandClaimCents)} each on average`}
            />
            <Line
              label="Rebate administration fee"
              value={`− ${formatCents(rebates.rebateAdminFeeCents)}`}
              note={`$0.40 per member per month across ${formatNumber(rebates.memberMonths)} member months`}
            />
            <div className="border-t border-ink-200 pt-3">
              <Line
                label="Net passed to the plan"
                value={formatCents(rebates.netToPlanCents)}
                note={`${formatPercent(rebates.netToPlanCents / rebates.grossRebateCents)} of gross`}
                strong
              />
            </div>
            <div className="rounded-lg bg-ink-50 px-3.5 py-3">
              <div className="flex items-center gap-2">
                {rebates.guaranteeMet ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-rose-700" />
                )}
                <span className="text-[12.5px] font-medium text-ink-900">
                  Minimum guarantee{" "}
                  {rebates.guaranteeMet ? "cleared" : "not met"}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
                Exhibit C guarantees at least{" "}
                {formatCents(rebates.minPerBrandClaimCents)} per retail brand
                claim, a floor of {formatCents(rebates.minGuaranteeCents)} on
                this volume. Actual collections were{" "}
                {formatCents(rebates.grossRebateCents)}. Under this contract the
                plan keeps the higher of the two rather than the guarantee
                alone.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* 4. Against a spread contract */}
      <Card>
        <CardHeader
          title="The same claims under a spread contract"
          description="Not a projection about a competitor. This applies a published rate schedule from another state's PBM contract to this plan's own utilisation, so the only thing that differs is the contract."
        />
        <Table>
          <thead>
            <tr>
              <Th>Drug class</Th>
              <Th align="right">Claims</Th>
              <Th align="right">This contract</Th>
              <Th align="right">Spread schedule</Th>
              <Th align="right">Difference</Th>
            </tr>
          </thead>
          <tbody>
            {spread.byClass.map((c) => (
              <tr key={c.brandGeneric}>
                <Td>
                  {c.brandGeneric}
                  <span className="ml-1.5 text-[11.5px] text-ink-500">
                    AWP − {bps(c.spreadDiscountBps)} under the comparison
                  </span>
                </Td>
                <Td align="right">{formatNumber(c.claims)}</Td>
                <Td align="right">{formatCents(c.passThroughCents)}</Td>
                <Td align="right" className="text-ink-600">
                  {formatCents(c.spreadCents)}
                </Td>
                <Td align="right" className="font-medium text-emerald-700">
                  {formatCents(c.deltaCents)}
                </Td>
              </tr>
            ))}
            <tr className="bg-ink-50/70 font-medium">
              <Td>Total</Td>
              <Td align="right">
                {formatNumber(spread.byClass.reduce((s, c) => s + c.claims, 0))}
              </Td>
              <Td align="right">{formatCents(spread.passThroughCents)}</Td>
              <Td align="right">{formatCents(spread.spreadCents)}</Td>
              <Td align="right" className="text-emerald-700">
                {formatCents(spread.deltaCents)}
              </Td>
            </tr>
          </tbody>
        </Table>
        <div className="border-t border-ink-100 px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-500">
          The gap is concentrated in generics, which is where spread lives. A
          spread PBM buys the generic at MAC and bills the plan at a fixed
          discount off a list price that has no relationship to acquisition
          cost, and keeps the difference. The plan cannot see the split because
          the two rate tables are different documents.{" "}
          <Link
            href="/methodology#spread"
            className="font-medium text-glass-700 hover:underline"
          >
            How this comparison is constructed
          </Link>
          .
        </div>
      </Card>

      {/* Bottom line */}
      <Card>
        <CardHeader
          title="PBM compensation"
          description="The complete answer, which under a spread contract cannot be produced at all."
        />
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-3">
          <Stat
            label="Administrative fees"
            value={formatCents(adminFeeCents)}
            sub={`${formatCents(WISCONSIN_CONTRACT.adminFeePmpmCommercialCents)} per member per month, invoiced separately`}
          />
          <Stat
            label="Rebate administration"
            value={formatCents(rebates.rebateAdminFeeCents)}
            sub="$0.40 per member per month, withheld from rebates"
          />
          <Stat
            label="Spread on claims"
            value={formatCents(totals.spreadCents)}
            tone={totals.spreadCents === 0 ? "positive" : "negative"}
            sub="Structurally zero: one rate row prices both sides"
          />
        </div>
        <div className="border-t border-ink-100 px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-600">
          Total PBM compensation on this book is{" "}
          <span className="font-medium text-ink-900">
            {formatCents(adminFeeCents + rebates.rebateAdminFeeCents)}
          </span>
          , or{" "}
          {formatPercent(
            (adminFeeCents + rebates.rebateAdminFeeCents) /
              totals.totalBilledCents,
          )}{" "}
          of drug spend. It is a single number because there is only one place
          the PBM earns.
        </div>
      </Card>
    </div>
  );
}

function Line({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={
            strong
              ? "text-[13.5px] font-medium text-ink-900"
              : "text-[13px] text-ink-700"
          }
        >
          {label}
        </span>
        <span
          className={
            strong
              ? "tnum text-[15px] font-semibold text-ink-900"
              : "tnum text-[13.5px] font-medium text-ink-900"
          }
        >
          {value}
        </span>
      </div>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">{note}</p>
    </div>
  );
}
