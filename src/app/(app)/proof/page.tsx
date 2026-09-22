import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  FlaskConical,
  X,
} from "lucide-react";
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
import {
  getBranchCoverage,
  getCoverageFacts,
  getHarnessResults,
  getPopulationReconciliation,
} from "@/lib/queries/proof";
import { formatNumber, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProofPage() {
  const [harness, facts, branches, population] = await Promise.all([
    getHarnessResults(),
    getCoverageFacts(),
    getBranchCoverage(),
    getPopulationReconciliation(),
  ]);

  const allGreen = harness.available && harness.failed === 0;

  return (
    <div className="space-y-6">
      <SectionTitle description={"Test results, book validation and coverage limits."}>
        Correctness
      </SectionTitle>

      {/* Harness summary */}
      <Card
        className={cn(
          allGreen ? "border-emerald-600/25 bg-emerald-50/40" : "border-rose-600/25 bg-rose-50/40",
        )}
      >
        <div className="flex flex-wrap items-start gap-4 px-5 py-4">
          <FlaskConical
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0",
              allGreen ? "text-emerald-700" : "text-rose-700",
            )}
          />
          <div className="min-w-0 flex-1">
            {!harness.available ? (
              <>
                <h2 className="text-[14px] font-semibold text-ink-900">
                  No harness results on file
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-700">
                  Run <code className="font-mono text-[12px]">npm test</code> to
                  produce them. This page deliberately does not run the suite
                  inside a request, so it can never report a greener result than
                  the tests actually produced.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-[14px] font-semibold text-ink-900">
                  {harness.passed} of {harness.total} checks passing across{" "}
                  {harness.suites.length} suites
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-700">
                  Last run {harness.ranAt?.toLocaleString("en-US")}. These are
                  read from the committed test artifact, not recomputed here.
                  The suites below are the whole argument: if one of them is
                  red, the figures everywhere else in this application are
                  suspect and should be treated that way.
                </p>
              </>
            )}
          </div>
          {harness.available ? (
            <div className="grid shrink-0 grid-cols-2 gap-x-8 text-right">
              <div>
                <div className="tnum text-[22px] font-semibold text-emerald-700">
                  {harness.passed}
                </div>
                <div className="text-[11px] uppercase tracking-[0.07em] text-ink-500">
                  passing
                </div>
              </div>
              <div>
                <div
                  className={cn(
                    "tnum text-[22px] font-semibold",
                    harness.failed === 0 ? "text-ink-300" : "text-rose-700",
                  )}
                >
                  {harness.failed}
                </div>
                <div className="text-[11px] uppercase tracking-[0.07em] text-ink-500">
                  failing
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Suites */}
      <div className="grid gap-4 lg:grid-cols-2">
        {harness.suites.map((s) => (
          <Card key={s.file}>
            <div className="border-b border-ink-100 px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[13.5px] font-semibold text-ink-900">
                    {s.name}
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">
                    {s.purpose}
                  </p>
                </div>
                <Badge tone={s.failed === 0 ? "positive" : "negative"}>
                  {s.failed === 0 ? `${s.passed} passing` : `${s.failed} failing`}
                </Badge>
              </div>
            </div>
            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto">
              {s.cases.map((c, i) => (
                <li key={i} className="flex items-start gap-2 px-5 py-2">
                  {c.status === "passed" ? (
                    <Check className="mt-[3px] h-3 w-3 shrink-0 text-emerald-600" />
                  ) : (
                    <X className="mt-[3px] h-3 w-3 shrink-0 text-rose-600" />
                  )}
                  <span
                    className={cn(
                      "text-[12px] leading-snug",
                      c.status === "passed" ? "text-ink-600" : "text-rose-800",
                    )}
                  >
                    {c.name}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {/* What the invariants cover */}
      <Card>
        <CardHeader
          title="Validation scope"
          description="An invariant over ten claims proves nothing. These are the sizes involved."
        />
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Claims adjudicated"
            value={formatNumber(facts.totalClaims)}
            sub={`${formatNumber(facts.paidClaims)} paid, ${formatNumber(facts.rejectedClaims)} rejected`}
          />
          <Stat
            label="Claims carrying a full trace"
            value={formatPercent(facts.traceCoverage)}
            tone={facts.traceCoverage === 1 ? "positive" : "negative"}
            sub="Every pricing step names the document it read"
          />
          <Stat
            label="Criteria steps encoded"
            value={formatNumber(facts.criteriaSteps)}
            sub={`Across ${facts.trees} published Navitus forms`}
          />
          <Stat
            label="Source documents"
            value={formatNumber(facts.sources)}
            sub="Every one publicly retrievable"
          />
        </div>
      </Card>

      {/* Branch coverage */}
      <div id="pa" />
      <Card>
        <CardHeader
          title="Criteria branch coverage"
          description="How many yes and no edges in each published form have actually been walked by a request on file. Untrodden branches are the honest weak spot in any criteria implementation, so they are listed rather than rounded away."
        />
        <Table>
          <thead>
            <tr>
              <Th>Form</Th>
              <Th align="right">Steps</Th>
              <Th align="right">Branches walked</Th>
              <Th align="right">Coverage</Th>
              <Th>Never taken</Th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.treeId}>
                <Td>
                  <span className="font-medium text-ink-900">{b.name}</span>
                  <div className="text-[11.5px] text-ink-500">{b.scopeLabel}</div>
                </Td>
                <Td align="right">{b.steps}</Td>
                <Td align="right">
                  {b.coveredEdges} of {b.totalEdges}
                </Td>
                <Td align="right">
                  <span
                    className={cn(
                      "font-medium",
                      b.coverage >= 0.6 ? "text-emerald-700" : "text-amber-700",
                    )}
                  >
                    {formatPercent(b.coverage)}
                  </span>
                </Td>
                <Td>
                  <span className="text-[11.5px] leading-snug text-ink-500">
                    {b.uncovered.length === 0
                      ? "None"
                      : b.uncovered.slice(0, 3).join("; ") +
                        (b.uncovered.length > 3
                          ? `, and ${b.uncovered.length - 3} more`
                          : "")}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="border-t border-ink-100 px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-500">
          Coverage below 100% does not mean those branches are wrong. It means
          no request on file has exercised them, so the only evidence for them
          is that the transcription matches the published form. The structural
          tests above prove each of those branches is reachable and terminates.
        </div>
      </Card>

      {/* Population reconciliation */}
      <Card>
        <CardHeader
          title="Book validation"
          description="The State of Wisconsin publishes utilisation statistics for this contract. A simulation that adjudicates perfectly against a population nobody recognises proves nothing about the real program."
        />
        <Table>
          <thead>
            <tr>
              <Th>Metric</Th>
              <Th align="right">Published</Th>
              <Th align="right">This simulation</Th>
              <Th>Source</Th>
            </tr>
          </thead>
          <tbody>
            {population.map((p) => (
              <tr key={p.metric}>
                <Td>{p.metric}</Td>
                <Td align="right" className="text-ink-600">
                  {p.published}
                </Td>
                <Td align="right" className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {p.within ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <CircleAlert className="h-3 w-3 text-amber-600" />
                    )}
                    {p.simulated}
                  </span>
                </Td>
                <Td className="text-ink-500">{p.source}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Limits */}
      <Card className="border-amber-600/25 bg-amber-50/30">
        <div className="flex items-start gap-3.5 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h2 className="text-[13.5px] font-semibold text-ink-900">
              What this does not prove
            </h2>
            <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-700">
              <li>
                <span className="font-medium">AWP.</span> It is
                proprietary to Medi-Span and cannot be published. Every figure
                priced off it is derived from NADAC through a stated multiplier,
                and the sensitivity analysis on the{" "}
                <Link href="/reports" className="text-glass-700 hover:underline">
                  reports page
                </Link>{" "}
                shows how far the conclusions move if the multiplier is wrong.
                NADAC itself is real and checkable.
              </li>
              <li>
                <span className="font-medium">
                  The membership is generated, not real.
                </span>{" "}
                No actual Wisconsin employee appears anywhere in this system.
                The population is calibrated to the published aggregate
                statistics above, which is the most that can be done without
                protected health information.
              </li>
              <li>
                <span className="font-medium">
                  Only one rate exhibit is complete.
                </span>{" "}
                Exhibit C from Amendment 1 is the only fully published rate card
                for this contract. Exhibits D and E are referenced in the order
                of precedence, but their amendment PDFs are image-only cover
                pages, so later rate changes are not reflected.
              </li>
              <li>
                <span className="font-medium">
                  Rebates are modelled, not observed.
                </span>{" "}
                Actual manufacturer rebate rates are confidential. What is real
                here is the contract mechanism: 100% pass-through less the $0.40
                per member per month administration fee, and the per-brand-claim
                minimum guarantee.
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
