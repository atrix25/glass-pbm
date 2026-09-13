import {
  Badge,
  Card,
  CardHeader,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { AgentWorkPanel } from "@/components/agent-work-panel";
import {
  getIncidents,
  getRebateFloor,
  getScorecard,
  getSettlementPlan,
} from "@/lib/queries/reconciliation";
import { getGuaranteeReconciliation } from "@/lib/queries/reports";
import { NETTING_PERMITTED } from "@/lib/contracts/guarantees";
import { getClock } from "@/lib/session";
import { formatCentsCompact, formatCentsWhole } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const clock = await getClock();
  const [financial, rebate, scorecard, incidents] = await Promise.all([
    getGuaranteeReconciliation(clock),
    getRebateFloor(clock),
    getScorecard(clock),
    getIncidents(clock),
  ]);
  const settlement = await getSettlementPlan(clock, scorecard.totalCreditCents);

  const financialSurplus = financial.reduce(
    (s, r) => s + (r.dollarVarianceCents ?? 0),
    0,
  );
  const missedMeasures = scorecard.rows.filter((r) => r.missedPeriods > 0);

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`Every promise in the contract, measured against the records that prove it, with the money attached. ${scorecard.closedMonths} months of the plan year have closed. ${missedMeasures.length === 0 ? "Nothing has been missed." : `${missedMeasures.length} measures were missed and ${formatCentsWhole(scorecard.totalCreditCents)} is owed back to the sponsor.`}`}
      >
        Guarantee reconciliation
      </SectionTitle>

      <Card>
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Financial guarantees"
            value={`${financial.filter((r) => r.met !== false).length} of ${financial.length}`}
            tone="positive"
            sub="Met on the book to date"
          />
          <Stat
            label="Value above the guaranteed rate"
            value={formatCentsCompact(financialSurplus)}
            sub="What the contracted floor would have cost"
          />
          <Stat
            label="Operational measures missed"
            value={formatNumber(missedMeasures.length)}
            tone={missedMeasures.length > 0 ? "negative" : "positive"}
            sub={`Across ${scorecard.closedMonths} closed months`}
          />
          <Stat
            label="Credit owed to the sponsor"
            value={formatCentsWhole(scorecard.totalCreditCents)}
            tone={scorecard.totalCreditCents > 0 ? "negative" : "default"}
            sub={`${(settlement.creditAsShareOfFeesBps / 100).toFixed(2)}% of administrative fees billed`}
          />
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Financial                                                          */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Financial guarantees"
          description="Discount off average wholesale price by channel, measured across every claim the guarantee covers. These are hard to miss here for a structural reason worth stating: the discount is applied when the claim is priced, not trued up afterwards. A contract that charges the guaranteed rate on every fill has nothing to reconcile."
        />
        <Table>
          <thead>
            <tr>
              <Th>Channel</Th>
              <Th>Scope</Th>
              <Th align="right">Claims</Th>
              <Th align="right">Guaranteed</Th>
              <Th align="right">Delivered</Th>
              <Th align="right">Variance</Th>
              <Th align="right">Value against the floor</Th>
              <Th align="right">Result</Th>
            </tr>
          </thead>
          <tbody>
            {financial.map((r) => (
              <tr key={`${r.channel}-${r.scope}`} className="hover:bg-ink-50/60">
                <Td>{r.channel}</Td>
                <Td className="text-ink-600">{r.scope}</Td>
                <Td align="right">{formatNumber(r.claims)}</Td>
                <Td align="right" className="text-ink-600">
                  {r.guaranteedBps !== null
                    ? `${(r.guaranteedBps / 100).toFixed(2)}%`
                    : "—"}
                </Td>
                <Td align="right" className="font-medium">
                  {(r.actualDiscountBps / 100).toFixed(2)}%
                </Td>
                <Td
                  align="right"
                  className={
                    (r.discountVarianceBps ?? 0) >= 0
                      ? "text-emerald-700"
                      : "text-rose-700"
                  }
                >
                  {r.discountVarianceBps !== null
                    ? `${r.discountVarianceBps >= 0 ? "+" : ""}${r.discountVarianceBps} bps`
                    : "—"}
                </Td>
                <Td align="right">
                  {r.dollarVarianceCents !== null
                    ? formatCentsWhole(r.dollarVarianceCents)
                    : "—"}
                </Td>
                <Td align="right">
                  <Badge tone={r.met === false ? "negative" : "positive"}>
                    {r.met === false ? "missed" : "met"}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="border-t border-ink-200/70 px-5 py-4 text-[12.5px] leading-relaxed text-ink-600">
          <span className="font-medium text-ink-900">The rebate floor.</span>{" "}
          Exhibit C promises at least{" "}
          {formatCentsWhole(rebate.floorPerClaimCents)} of rebate for every
          brand claim, whatever the manufacturer contracts actually yield. On{" "}
          {formatNumber(rebate.brandClaims)} brand claims that floor is{" "}
          {formatCentsCompact(rebate.floorCents)}; the book has accrued{" "}
          {formatCentsCompact(rebate.actualCents)}, or{" "}
          {formatCentsWhole(rebate.perClaimCents)} a claim.{" "}
          {rebate.met
            ? `The plan keeps the larger number, which is ${formatCentsCompact(rebate.surplusCents)} above the floor.`
            : `The plan is owed the difference of ${formatCentsCompact(-rebate.surplusCents)}.`}{" "}
          This is the one financial guarantee that can genuinely be missed,
          because it turns on what manufacturers pay rather than on how a claim
          is priced.
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Operational                                                        */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Operational guarantees"
          description="Measured monthly, on every case rather than a sample, with a twelfth of the annual amount at risk in each month. The measurement period is not a detail: four bad days in June are 99.5% of the year and a clean report, or 93.5% of June and a credit. Both numbers are true, and which one appears in the report is a drafting decision the sponsor usually loses without noticing."
          action={
            <Badge tone={scorecard.totalCreditCents > 0 ? "negative" : "positive"}>
              {formatCentsWhole(scorecard.totalCreditCents)} owed
            </Badge>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Measure</Th>
              <Th align="right">Target</Th>
              <Th align="right">Year to date</Th>
              <Th align="right">Cases</Th>
              <Th align="right">Months missed</Th>
              <Th align="right">At risk / year</Th>
              <Th align="right">Credit</Th>
            </tr>
          </thead>
          <tbody>
            {scorecard.rows.map((r) => (
              <tr key={r.guarantee.id} className="hover:bg-ink-50/60">
                <Td className="max-w-[280px]">{r.guarantee.name}</Td>
                <Td align="right" className="text-ink-600">
                  {r.guarantee.target}%
                </Td>
                <Td align="right" className="font-medium">
                  {r.annualMeasured.toFixed(2)}%
                </Td>
                <Td align="right" className="text-ink-600">
                  {formatNumber(r.annualSample)}
                </Td>
                <Td align="right">
                  {r.missedPeriods > 0 ? (
                    <Badge tone="negative">{r.missedPeriods}</Badge>
                  ) : (
                    <span className="text-ink-400">none</span>
                  )}
                </Td>
                <Td align="right" className="text-ink-600">
                  {formatCentsWhole(r.guarantee.atRiskCents)}
                </Td>
                <Td
                  align="right"
                  className={r.creditCents > 0 ? "font-medium text-rose-700" : ""}
                >
                  {r.creditCents > 0 ? formatCentsWhole(r.creditCents) : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>

        {missedMeasures.length > 0 ? (
          <div className="border-t border-ink-200/70 bg-ink-50/50 px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Every period that missed
            </div>
            <div className="mt-3 space-y-3">
              {missedMeasures.map((r) => (
                <div key={r.guarantee.id}>
                  <div className="text-[13px] font-medium text-ink-900">
                    {r.guarantee.name}
                  </div>
                  <p className="mt-0.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-600">
                    {r.guarantee.clause}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {r.periods
                      .filter((p) => !p.met)
                      .map((p) => (
                        <li
                          key={p.month}
                          className="text-[12.5px] text-ink-700"
                        >
                          <span className="font-medium">{p.label}</span>:{" "}
                          {p.measured.toFixed(2)}% of {formatNumber(p.sample)}{" "}
                          cases, {p.shortfall.toFixed(2)} points short —{" "}
                          {p.band} of the target, so{" "}
                          {Math.round((p.creditCents / (r.guarantee.atRiskCents / 12)) * 100)}
                          % of the month&rsquo;s exposure, or{" "}
                          <span className="font-medium text-rose-700">
                            {formatCentsWhole(p.creditCents)}
                          </span>
                          .
                        </li>
                      ))}
                  </ul>
                  <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-ink-500">
                    {r.guarantee.method}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 max-w-3xl border-t border-ink-200/70 pt-3 text-[12px] leading-relaxed text-ink-500">
              Two things the sample column is there to stop you misreading.
              Where a month holds five eligibility files, a percentage target is
              really a count, and one late file is a nineteen-point miss rather
              than a collapse in service. And a hundredth of a point short on
              expedited review is one member out of ninety-nine who waited
              longer than a day for an answer their prescriber marked urgent —
              the band structure does not care how narrow the miss was, because
              that member does not either.
            </p>
          </div>
        ) : null}

        <div className="border-t border-ink-200/70 px-5 py-4 text-[12.5px] leading-relaxed text-ink-600">
          <span className="font-medium text-ink-900">
            What the drafting is worth.
          </span>{" "}
          Measured annually instead of monthly, the same year produces{" "}
          {formatCentsWhole(scorecard.creditIfMeasuredAnnuallyCents)} of credit
          rather than {formatCentsWhole(scorecard.totalCreditCents)} — and the
          prior authorisation failure disappears from the report entirely,
          because eleven good months bury four bad days. Neither number is
          wrong. The sponsor who does not ask which one the contract uses is the
          one who finds out afterwards.{" "}
          {NETTING_PERMITTED
            ? "This contract permits netting across measures."
            : "This contract does not permit netting across measures: a measure that beats its target does not buy back one that missed."}
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Incidents                                                          */}
      {/* ------------------------------------------------------------------ */}

      {incidents.map((incident) => (
        <Card key={incident.id}>
          <CardHeader
            title="What happened"
            description={`${formatDate(incident.startedAt)} to ${formatDate(incident.endedAt)}. The sponsor was told ${incident.notifiedWithinHours} hours in, not at the quarterly review.`}
            action={<Badge tone="warn">{incident.severity}</Badge>}
          />
          <div className="space-y-3 px-5 py-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                {incident.title}
              </div>
              <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-800">
                {incident.summary}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                  Cause
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">
                  {incident.cause}
                </p>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                  What changed
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">
                  {incident.remedy}
                </p>
              </div>
            </div>
            <p className="max-w-3xl border-t border-ink-200/70 pt-3 text-[12.5px] leading-relaxed text-ink-500">
              The credit above was computed from the case records this incident
              produced. Nothing in the data says a guarantee was missed; the
              decisions simply took longer, and the measurement found it. An
              incumbent has the same records and reports the annual number.
            </p>
          </div>
        </Card>
      ))}

      {/* ------------------------------------------------------------------ */}
      {/* Settlement                                                         */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="When it settles"
          description="Claims keep arriving after the year ends, so a reconciliation published on the second of January is measuring a book that is not finished. These are the dates the settlement turns on."
        />
        <Table>
          <thead>
            <tr>
              <Th>Stage</Th>
              <Th align="right">Date</Th>
              <Th>What it means</Th>
              <Th align="right"></Th>
            </tr>
          </thead>
          <tbody>
            {settlement.stages.map((s) => (
              <tr key={s.label} className="hover:bg-ink-50/60">
                <Td className="font-medium">{s.label}</Td>
                <Td align="right" className="text-ink-600">
                  {formatDate(s.date)}
                </Td>
                <Td className="max-w-[520px] text-ink-600">{s.detail}</Td>
                <Td align="right">
                  {s.status === "done" ? (
                    <Badge tone="neutral">done</Badge>
                  ) : s.status === "current" ? (
                    <Badge tone="accent">next</Badge>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="border-t border-ink-200/70 px-5 py-4 text-[12.5px] leading-relaxed text-ink-600">
          <span className="font-medium text-ink-900">Applied, not promised.</span>{" "}
          {formatCentsWhole(scorecard.totalCreditCents)} of credit against{" "}
          {formatCentsCompact(settlement.adminFeeCents)}{" "}
          of administrative fees billed so far comes off the next invoice as a
          line item, where the
          sponsor&rsquo;s accounts payable will see it whether or not anybody
          reads this page. The sponsor may reopen a settled year for{" "}
          {settlement.auditWindowYears} years, and every measure above expands
          to the individual cases behind it, because the cases are the
          measurement rather than a report about it.
        </div>
      </Card>
      <AgentWorkPanel
        subjectTypes={["PerformanceGuarantee", "SponsorInvoice"]}
        title="Guarantee-credit agent work"
      />
    </div>
  );
}
