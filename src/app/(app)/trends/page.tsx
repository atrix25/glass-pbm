import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  DivergingBar,
  EmptyState,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { PmpmTrendChart } from "@/components/charts";
import {
  getClassDrivers,
  getCostConcentration,
  getDrugDrivers,
  getMonthlyTrendLine,
  getRelationshipTrend,
  getTrendOverview,
  type DriverRow,
  type TrendWindow,
} from "@/lib/queries/trends";
import { getClock } from "@/lib/session";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** How many driver rows to show in each direction. */
const TOP_N = 8;

export default async function TrendsPage() {
  const clock = await getClock();
  const overview = await getTrendOverview(clock);

  if (!overview) {
    return (
      <div className="space-y-6">
        <SectionTitle description="Cost and utilization across comparable periods.">
          Trend management
        </SectionTitle>
        <Card>
          <EmptyState
            title="Too little of the plan year has run"
            description="This page compares the most recent complete stretch of the year against the equally long stretch before it. Advance the simulation clock by a few weeks and the comparison becomes available."
          />
        </Card>
      </div>
    );
  }

  const [classes, drugs, relationships, concentration, months] =
    await Promise.all([
      getClassDrivers(overview),
      getDrugDrivers(overview),
      getRelationshipTrend(overview),
      getCostConcentration(overview),
      getMonthlyTrendLine(clock),
    ]);

  const { current, prior, periods, drivers, netChangeCents, netChangePct } =
    overview;
  const rising = netChangeCents > 0;

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`${formatNumber(overview.members)} covered lives · ${describe(periods.current)} vs. ${describe(periods.prior)}. Costs per member per month.`}
        action={
          <Link
            href="/sponsor"
            className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
          >
            Book of business
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        Trend management
      </SectionTitle>

      <Card>
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Net plan cost PMPM"
            value={formatCents(current.netPmpmCents)}
            tone={rising ? "negative" : "positive"}
            sub={`${signedPct(netChangePct)} against ${formatCents(prior.netPmpmCents)} in the prior period`}
          />
          <Stat
            label="Utilisation"
            value={`${current.scriptsPerMemberYear.toFixed(2)} scripts`}
            sub={`Per member per year, annualised. ${signedPct(pctChange(prior.scriptsPerMemberYear, current.scriptsPerMemberYear))} against ${prior.scriptsPerMemberYear.toFixed(2)}`}
          />
          <Stat
            label="Cost per script"
            value={formatCents(current.costPerScriptCents)}
            sub={`Billed to the plan before rebates. ${signedPct(pctChange(prior.costPerScriptCents, current.costPerScriptCents))} against ${formatCents(prior.costPerScriptCents)}`}
          />
          <Stat
            label="Generic dispensing rate"
            value={formatPercent(current.genericRate)}
            sub={`${signedPoints((current.genericRate - prior.genericRate) * 100)} against ${formatPercent(prior.genericRate)}`}
          />
        </div>
      </Card>

      {/* 1. The bridge. */}
      <Card>
        <CardHeader
          title="Cost drivers"
          description="Net plan cost per member per month is utilisation times price per script, less what members paid at the counter and less rebates. Each row below is the change in one of those terms holding the others still, so the five add to the whole move with nothing left over."
        />
        <Table>
          <thead>
            <tr>
              <Th>Driver</Th>
              <Th align="right">PMPM effect</Th>
              <Th className="w-[220px]">Direction</Th>
              <Th>What it means</Th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.key}>
                <Td className="whitespace-nowrap font-medium text-ink-900">
                  {d.label}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  <span className={amountClass(d.cents)}>
                    {signedCents(d.cents)}
                  </span>
                </Td>
                <Td>
                  <DivergingBar
                    value={d.cents}
                    max={Math.max(...drivers.map((x) => Math.abs(x.cents)))}
                  />
                </Td>
                <Td className="text-[12px] text-ink-500">{d.note}</Td>
              </tr>
            ))}
            <tr className="bg-ink-50/70">
              <Td className="font-semibold text-ink-900">
                Net change in plan cost PMPM
              </Td>
              <Td align="right" className="whitespace-nowrap">
                <span className={`font-semibold ${amountClass(netChangeCents)}`}>
                  {signedCents(netChangeCents)}
                </span>
              </Td>
              <Td />
              <Td className="text-[12px] text-ink-500">
                {formatCents(prior.netPmpmCents)} to{" "}
                {formatCents(current.netPmpmCents)}, or{" "}
                {signedPct(netChangePct)} over the period
              </Td>
            </tr>
          </tbody>
        </Table>
        <div className="flex items-start gap-2 border-t border-ink-100 px-5 py-3 text-[12px] leading-relaxed text-ink-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
          <p>
            Enrolment is fixed across this plan year, so none of the movement is
            membership growth. The cross term is reported on its own line rather
            than folded into utilisation or price: when both move, the extra
            scripts are not priced like the old ones, and charging that to
            either term alone would overstate it.
          </p>
        </div>
      </Card>

      {/* 2. Trajectory. */}
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Net plan cost by month"
            description="The whole year to date, so the two comparison windows can be read in context. The open point is the current month, which is still filling in."
          />
          <div className="px-3 py-4">
            <PmpmTrendChart data={months} />
          </div>
          <div className="border-t border-ink-100 px-5 py-3 text-[12px] leading-relaxed text-ink-500">
            January runs high in every plan year and this one is no exception:
            members already on maintenance therapy when the year opens all take
            their first fill in the same few weeks. It is a refill calendar, not
            a trend, which is why the comparison windows above exclude it.
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Cost by relationship"
            description="The same net cost, per covered life within each group."
          />
          <Table>
            <thead>
              <tr>
                <Th>Group</Th>
                <Th align="right">Lives</Th>
                <Th align="right">PMPM</Th>
                <Th align="right">Change</Th>
              </tr>
            </thead>
            <tbody>
              {relationships.map((r) => (
                <tr key={r.code}>
                  <Td className="whitespace-nowrap font-medium text-ink-900">
                    {r.label}
                  </Td>
                  <Td align="right">{formatNumber(r.lives)}</Td>
                  <Td align="right">{formatCents(r.currentPmpmCents)}</Td>
                  <Td align="right" className="whitespace-nowrap">
                    <span className={amountClass(r.changePct)}>
                      {signedPct(r.changePct)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-ink-100 px-5 py-3 text-[12px] leading-relaxed text-ink-500">
            Each rate is per life in that group, so they do not add to the plan
            figure above; they weight to it. Dependants are more than half of
            the covered population and a little over half of the cost.
          </div>
        </Card>
      </div>

      {/* 3. Therapeutic class. */}
      <Card>
        <CardHeader
          title="Therapeutic class drivers"
          description="Each class measured against the whole covered population rather than against the members who used it, so the rows are additive: every class on the book sums to the net change above."
          action={
            <Badge tone="neutral">{classes.length} classes on the book</Badge>
          }
        />
        <DriverTable
          rows={classes}
          maxRows={TOP_N}
          noun="class"
          nounPlural="classes"
          heading="Therapeutic class"
        />
      </Card>

      {/* 4. Drug level. */}
      <Card>
        <CardHeader
          title="Drug cost drivers"
          description="The same cut one level down. A class can look quiet while two drugs inside it move in opposite directions."
        />
        <DriverTable
          rows={drugs}
          maxRows={TOP_N}
          noun="drug"
          nounPlural="drugs"
          heading="Drug"
        />
      </Card>

      {/* 5. Concentration. */}
      <Card>
        <CardHeader
          title="Spend concentration"
          description="Members banded by what the plan paid for them, net of rebates, over the current period. A trend carried by a handful of members is managed differently from one spread across the population."
        />
        <Table>
          <thead>
            <tr>
              <Th>Band</Th>
              <Th align="right">Members</Th>
              <Th align="right">Share of population</Th>
              <Th align="right">Net plan cost</Th>
              <Th align="right">Share of plan cost</Th>
              <Th align="right">Members prior</Th>
            </tr>
          </thead>
          <tbody>
            {concentration.map((b) => (
              <tr key={b.label}>
                <Td className="whitespace-nowrap font-medium text-ink-900">
                  {b.label}
                </Td>
                <Td align="right">{formatNumber(b.currentMembers)}</Td>
                <Td align="right" className="text-ink-500">
                  {formatPercent(b.currentMembers / overview.members, 2)}
                </Td>
                <Td align="right">
                  {formatCentsCompact(b.currentPlanCents)}
                </Td>
                <Td align="right" className="font-medium">
                  {formatPercent(b.currentShareOfSpend)}
                </Td>
                <Td align="right" className="text-ink-500">
                  {formatNumber(b.priorMembers)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="border-t border-ink-100 px-5 py-3 text-[12px] leading-relaxed text-ink-500">
          Read against the class table: when a small band carries a large share,
          the classes that move are the ones those members are on, and the lever
          is case management rather than formulary design.
        </div>
      </Card>
    </div>
  );
}

/**
 * Drivers ranked by how far they moved, in both directions.
 *
 * Showing only the top of the list would show only the increases, and a
 * category that took cost out of the plan is as much of a finding as one that
 * put cost in. The two ends are shown and the quiet middle is collapsed.
 */
function DriverTable({
  rows,
  maxRows,
  noun,
  nounPlural,
  heading,
}: {
  rows: DriverRow[];
  maxRows: number;
  noun: string;
  nounPlural: string;
  heading: string;
}) {
  const up = rows.filter((r) => r.changeCents > 0).slice(0, maxRows);
  const down = rows
    .filter((r) => r.changeCents < 0)
    .slice(0, maxRows)
    .reverse();
  const shown = [...up, ...down];
  const max = Math.max(...rows.map((r) => Math.abs(r.changeCents)), 0);
  const hidden = rows.length - shown.length;

  if (shown.length === 0) {
    return (
      <EmptyState
        title="Nothing moved"
        description={`No ${noun} changed the plan's cost between the two periods.`}
      />
    );
  }

  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>{heading}</Th>
            <Th align="right">Scripts</Th>
            <Th align="right">Cost per script</Th>
            <Th align="right">PMPM then</Th>
            <Th align="right">PMPM now</Th>
            <Th align="right">Effect</Th>
            <Th className="w-[150px]">Direction</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key}>
              <Td>
                <span className="block max-w-[22rem] truncate font-medium text-ink-900">
                  {titleCase(r.label)}
                </span>
                {r.sublabel ? (
                  <span className="block max-w-[22rem] truncate text-[11.5px] text-ink-500">
                    {titleCase(r.sublabel)}
                  </span>
                ) : null}
              </Td>
              <Td align="right" className="whitespace-nowrap text-ink-600">
                {formatNumber(r.currentScripts)}
                <span className="ml-1 text-[11.5px] text-ink-400">
                  {signedPct(pctChange(r.priorScripts, r.currentScripts), 0)}
                </span>
              </Td>
              <Td align="right">
                {formatCents(r.currentCostPerScriptCents)}
              </Td>
              <Td align="right" className="text-ink-500">
                {formatCents(r.priorPmpmCents)}
              </Td>
              <Td align="right">{formatCents(r.currentPmpmCents)}</Td>
              <Td align="right" className="whitespace-nowrap">
                <span className={amountClass(r.changeCents)}>
                  {signedCents(r.changeCents)}
                </span>
              </Td>
              <Td>
                <DivergingBar value={r.changeCents} max={max} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {hidden > 0 ? (
        <div className="border-t border-ink-100 px-5 py-3 text-[12px] text-ink-500">
          {formatNumber(hidden)}{" "}
          {hidden === 1 ? `further ${noun}` : `further ${nounPlural}`} moved the
          plan by less than{" "}
          {formatCents(Math.min(...shown.map((r) => Math.abs(r.changeCents))))}{" "}
          per member per month.
        </div>
      ) : null}
    </>
  );
}

function describe(w: TrendWindow): string {
  return `${formatDate(w.start)} to ${formatDate(w.end)}`;
}

function pctChange(from: number, to: number): number {
  return from === 0 ? 0 : (to - from) / from;
}

function signedPct(value: number, decimals = 1): string {
  const s = formatPercent(Math.abs(value), decimals);
  return `${value >= 0 ? "+" : "−"}${s}`;
}

function signedPoints(points: number): string {
  return `${points >= 0 ? "+" : "−"}${Math.abs(points).toFixed(2)} pts`;
}

function signedCents(cents: number): string {
  return `${cents >= 0 ? "+" : "−"}${formatCents(Math.abs(cents))}`;
}

/** Rising plan cost reads as a problem, falling plan cost as a win. */
function amountClass(value: number): string {
  if (value > 0) return "text-rose-700";
  if (value < 0) return "text-emerald-700";
  return "text-ink-500";
}

const MINOR_WORD = /^(and|or|the|for|of|in|with)$/i;

/**
 * Formulary categories arrive shouted, as they are printed in the PDF.
 * Left as-is they overwhelm a table that is mostly numbers.
 */
function titleCase(value: string): string {
  return value.replace(/[A-Za-z]+/g, (word, offset: number) =>
    offset > 0 && MINOR_WORD.test(word)
      ? word.toLowerCase()
      : word[0].toUpperCase() + word.slice(1).toLowerCase(),
  );
}
