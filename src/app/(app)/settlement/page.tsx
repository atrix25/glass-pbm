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
  getInvoiceOverview,
  getRebateLedger,
  getSettlementOverview,
} from "@/lib/queries/settlement";
import { getClock } from "@/lib/session";
import {
  formatBpsAsPercent,
  formatCents,
  formatCentsCompact,
  formatCentsWhole,
} from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SettlementPage() {
  const clock = await getClock();
  const [settle, invoices, rebates] = await Promise.all([
    getSettlementOverview(clock),
    getInvoiceOverview(clock),
    getRebateLedger(clock),
  ]);

  const agingMax = Math.max(1, ...rebates.aging.map((a) => a.cents));

  return (
    <div className="space-y-6">
      <SectionTitle description="A PBM is a payments company wearing a clinical hat. It collects from the plan monthly, pays the network twice a month, and chases manufacturers for money it booked two quarters ago. Under pass-through the first two are equal by construction. The third is where the industry makes its money.">
        Settlement
      </SectionTitle>

      <IncumbentNote>
        The administrative fee in Contract ETG0013 is $2.10 per member per
        month, plus $0.40 taken out of rebates. Across{" "}
        {formatCentsCompact(invoices.billedToDateCents)} billed to the sponsor
        so far this year, that fee is{" "}
        {formatCentsCompact(invoices.adminFeeToDateCents)}, or{" "}
        {formatBpsAsPercent(invoices.adminFeeShareBps, 2)} of the invoice. A
        traditional contract does not charge more; it charges the same and keeps
        the difference between what the plan is billed and what the pharmacy is
        paid, plus the {formatCentsCompact(rebates.outstandingCents)} of rebate
        money sitting in its account right now. That is the entire argument, and
        it is visible on this page rather than asserted.
      </IncumbentNote>

      {/* ------------------------------------------------------------------ */}
      {/* Rebate receivables                                                 */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Rebate receivables"
          description="Earned on the fill, invoiced after the quarter closes, collected on terms. Most of what the book has earned this year has not arrived, and whoever holds it in the meantime earns on it."
        />
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Earned to date"
            value={formatCentsCompact(rebates.accruedCents)}
            sub="Accrued on paid brand fills"
          />
          <Stat
            label="Collected"
            value={formatCentsCompact(rebates.collectedCents)}
            tone="positive"
            sub="Cash actually received"
          />
          <Stat
            label="Outstanding"
            value={formatCentsCompact(rebates.outstandingCents)}
            tone="negative"
            sub={`${formatCentsCompact(rebates.disputedCents)} of it disputed`}
          />
          <Stat
            label="Fill to cash"
            value={`${rebates.meanDaysToCash} days`}
            sub="Dollar-weighted average"
          />
        </div>

        <div className="grid grid-cols-1 divide-y divide-ink-200/70 lg:grid-cols-[1fr_1fr] lg:divide-x lg:divide-y-0">
          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Receivable aging
            </div>
            <div className="mt-3 space-y-3">
              {rebates.aging.map((a) => (
                <div key={a.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-ink-800">{a.label}</span>
                    <span className="tnum shrink-0 text-[12.5px] text-ink-600">
                      {formatCentsCompact(a.cents)}
                      <span className="ml-2 text-ink-400">
                        {a.invoices} inv
                      </span>
                    </span>
                  </div>
                  <ProportionBar
                    className="mt-1.5"
                    segments={[
                      {
                        label: a.label,
                        value: a.cents,
                        className:
                          a.label === "Over 90 days"
                            ? "bg-rose-500"
                            : a.label === "61 to 90 days"
                              ? "bg-amber-500"
                              : "bg-glass-500",
                      },
                      {
                        label: "rest",
                        value: agingMax - a.cents,
                        className: "bg-transparent",
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-ink-500">
              ETG0013 fixes the rebate amount and the $0.40 administrative fee
              taken out of it, but the extracted terms say nothing about when
              the money moves. The 45-day invoicing lag and 60-day payment terms
              modeled here are customary practice, not contract text.
            </p>
          </div>

          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              The float
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-700">
              {formatCentsWhole(rebates.outstandingCents)}{" "}
              of the plan&rsquo;s money is in somebody else&rsquo;s account, and
              takes an average of{" "}
              {rebates.meanDaysToCash} days from the fill to arrive. At{" "}
              {formatBpsAsPercent(rebates.floatRateBps, 2)} short-term, holding
              that balance for that long is worth{" "}
              <span className="font-semibold text-ink-900">
                {formatCentsWhole(rebates.floatValueCents)}
              </span>{" "}
              a year.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-700">
              Under a pass-through contract the plan is credited on collection
              and the float is a timing question. Under a traditional contract
              the PBM guarantees a fixed rebate per claim, keeps whatever it
              actually collects, and keeps the interest on the way through. The
              guarantee is the product; the spread and the float are the
              business.
            </p>
            <div className="mt-4 border-t border-ink-200/70 pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                Owed the most, longest
              </div>
              <div className="mt-2 space-y-1.5">
                {rebates.topDebtors.map((d) => (
                  <div
                    key={d.manufacturer}
                    className="flex items-baseline justify-between gap-3 text-[13px]"
                  >
                    <span className="truncate text-ink-800">
                      {d.manufacturer}
                    </span>
                    <span className="tnum shrink-0 text-ink-600">
                      {formatCentsCompact(d.outstandingCents)}
                      <span className="ml-2 text-ink-400">
                        {d.oldestDays}d
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <Table className="border-t border-ink-200/70">
          <thead>
            <tr>
              <Th>Quarter</Th>
              <Th>Status</Th>
              <Th align="right">Manufacturers</Th>
              <Th align="right">Claims</Th>
              <Th align="right">Invoiced</Th>
              <Th align="right">Collected</Th>
              <Th align="right">Disputed</Th>
              <Th align="right">Outstanding</Th>
              <Th align="right">Due</Th>
            </tr>
          </thead>
          <tbody>
            {rebates.quarters.map((q) => (
              <tr key={q.quarter} className="hover:bg-ink-50/60">
                <Td className="font-medium">{q.quarter}</Td>
                <Td>
                  <Badge
                    tone={
                      q.status === "Collected"
                        ? "positive"
                        : q.status === "Overdue"
                          ? "negative"
                          : q.status === "Invoiced"
                            ? "warn"
                            : "neutral"
                    }
                  >
                    {q.status}
                    {q.status === "Overdue" ? ` ${q.daysLate}d` : ""}
                  </Badge>
                </Td>
                <Td align="right" className="text-ink-600">
                  {q.manufacturers}
                </Td>
                <Td align="right" className="text-ink-600">
                  {formatNumber(q.claimCount)}
                </Td>
                <Td align="right">{formatCentsWhole(q.invoicedCents)}</Td>
                <Td align="right" className="text-emerald-700">
                  {formatCentsWhole(q.collectedCents)}
                </Td>
                <Td align="right" className="text-amber-700">
                  {q.disputedCents > 0
                    ? formatCentsWhole(q.disputedCents)
                    : "—"}
                </Td>
                <Td align="right" className="font-medium">
                  {formatCentsWhole(q.outstandingCents)}
                </Td>
                <Td align="right" className="text-ink-500">
                  {formatDate(q.dueAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Pharmacy remittance                                                */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Pharmacy remittance"
          description="Twice a month, net of reversals, to every pharmacy that dispensed in the cycle. Under pass-through this total is the same number the sponsor is billed."
        />
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Paid to the network"
            value={formatCentsCompact(settle.paidToDateCents)}
            sub={`${settle.cycles.filter((c) => c.status === "Paid").length} cycles settled`}
          />
          <Stat
            label="Scheduled"
            value={formatCentsCompact(settle.scheduledCents)}
            sub="Adjudicated, not yet paid"
          />
          <Stat
            label="Recovered on reversals"
            value={formatCentsCompact(settle.recoveredFromNetworkCents)}
            tone="positive"
            sub="Netted out of remittance"
          />
          <Stat
            label="Cycle in flight"
            value={
              settle.inFlight
                ? formatCentsCompact(settle.inFlight.netCents)
                : "—"
            }
            sub={
              settle.inFlight
                ? `Pays ${formatDate(settle.inFlight.paidAt)}`
                : "No open cycle"
            }
          />
        </div>

        <Table>
          <thead>
            <tr>
              <Th>Cycle</Th>
              <Th>Status</Th>
              <Th align="right">Pays</Th>
              <Th align="right">Pharmacies</Th>
              <Th align="right">Claims</Th>
              <Th align="right">Reversals</Th>
              <Th align="right">Gross</Th>
              <Th align="right">Reversed</Th>
              <Th align="right">Net</Th>
            </tr>
          </thead>
          <tbody>
            {(settle.inFlight ? [settle.inFlight] : [])
              .concat(settle.cycles.slice(0, 8))
              .map((c) => (
                <tr key={c.id} className="hover:bg-ink-50/60">
                  <Td className="whitespace-nowrap">
                    {formatDate(c.cycleStart)} – {formatDate(c.cycleEnd)}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        c.status === "Paid"
                          ? "positive"
                          : c.status === "In flight"
                            ? "accent"
                            : "neutral"
                      }
                    >
                      {c.status}
                    </Badge>
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(c.paidAt)}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {c.pharmacyCount}
                  </Td>
                  <Td align="right">{formatNumber(c.claimCount)}</Td>
                  <Td align="right" className="text-ink-600">
                    {formatNumber(c.reversalCount)}
                  </Td>
                  <Td align="right">{formatCentsWhole(c.grossCents)}</Td>
                  <Td align="right" className="text-emerald-700">
                    {c.reversalCents !== 0
                      ? formatCentsWhole(c.reversalCents)
                      : "—"}
                  </Td>
                  <Td align="right" className="font-medium">
                    {formatCentsWhole(c.netCents)}
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
      </Card>

      {settle.lastPaid ? (
        <Card>
          <CardHeader
            title={`Remittance advice — cycle ending ${formatDate(settle.lastPaid.cycle.cycleEnd)}`}
            description={`Paid ${formatDate(settle.lastPaid.cycle.paidAt)}. What each pharmacy in the network received, net of the fills that came back.`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Pharmacy</Th>
                <Th>Chain</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Reversals</Th>
                <Th align="right">Gross</Th>
                <Th align="right">Reversed</Th>
                <Th align="right">Net paid</Th>
              </tr>
            </thead>
            <tbody>
              {settle.lastPaid.lines.map((l) => (
                <tr key={l.pharmacyId} className="hover:bg-ink-50/60">
                  <Td className="max-w-[260px] truncate" title={l.name}>
                    {l.name}
                  </Td>
                  <Td className="text-ink-500">{l.chain ?? "Independent"}</Td>
                  <Td align="right">{formatNumber(l.claimCount)}</Td>
                  <Td align="right" className="text-ink-600">
                    {formatNumber(l.reversalCount)}
                  </Td>
                  <Td align="right">{formatCentsWhole(l.grossCents)}</Td>
                  <Td align="right" className="text-emerald-700">
                    {l.reversalCents !== 0
                      ? formatCentsWhole(l.reversalCents)
                      : "—"}
                  </Td>
                  <Td align="right" className="font-medium">
                    {formatCentsWhole(l.netCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Sponsor invoicing                                                  */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Sponsor invoicing"
          description="Monthly, in arrears. Drug cost at exactly what the network was paid, plus the administrative fee on covered lives, less rebates actually collected in the month."
        />
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Billed to the sponsor"
            value={formatCentsCompact(invoices.billedToDateCents)}
            sub={`${invoices.bills.filter((b) => b.status !== "Accruing").length} invoices issued`}
          />
          <Stat
            label="Administrative fee"
            value={formatCentsCompact(invoices.adminFeeToDateCents)}
            sub={`$${(invoices.adminFeePmpmCents / 100).toFixed(2)} PMPM, all in`}
          />
          <Stat
            label="Fee as a share of the invoice"
            value={formatBpsAsPercent(invoices.adminFeeShareBps, 2)}
            tone="accent"
            sub="The PBM's entire revenue on this book"
          />
          <Stat
            label="Spread retained"
            value={formatCents(0)}
            tone="positive"
            sub="Pass-through, checked as an invariant"
          />
        </div>

        {invoices.bills.length === 0 ? (
          <EmptyState title="No invoices issued yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Reversals</Th>
                <Th align="right">Drug cost</Th>
                <Th align="right">Member months</Th>
                <Th align="right">Admin fee</Th>
                <Th align="right">Rebate credit</Th>
                <Th align="right">Total due</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.bills.map((b) => (
                <tr key={b.id} className="hover:bg-ink-50/60">
                  <Td className="whitespace-nowrap font-medium">
                    {b.periodStart.toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        b.status === "Paid"
                          ? "positive"
                          : b.status === "Accruing"
                            ? "accent"
                            : "warn"
                      }
                    >
                      {b.status}
                    </Badge>
                  </Td>
                  <Td align="right">{formatNumber(b.claimCount)}</Td>
                  <Td align="right" className="text-ink-600">
                    {formatNumber(b.reversalCount)}
                  </Td>
                  <Td align="right">{formatCentsWhole(b.drugCostCents)}</Td>
                  <Td align="right" className="text-ink-600">
                    {formatNumber(b.memberMonths)}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatCentsWhole(b.adminFeeCents)}
                  </Td>
                  <Td align="right" className="text-emerald-700">
                    {b.rebateCreditCents > 0
                      ? `(${formatCentsWhole(b.rebateCreditCents)})`
                      : "—"}
                  </Td>
                  <Td align="right" className="font-medium">
                    {formatCentsWhole(b.totalDueCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-ink-200/70 px-5 py-4 text-[12.5px] leading-relaxed text-ink-500">
          Rebate credit lags drug cost by two quarters, which is why the early
          months of a plan year always look expensive and the later ones do not.
          A traditional contract smooths this by guaranteeing a fixed rebate per
          claim and crediting it monthly, which reads better on an invoice and
          costs the plan the difference between the guarantee and what was
          actually collected.
        </div>
      </Card>
    </div>
  );
}
