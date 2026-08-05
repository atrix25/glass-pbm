import {
  Badge,
  Card,
  CardHeader,
  IncumbentNote,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { getThroughput, type RunSummary } from "@/lib/queries/throughput";
import { getClock } from "@/lib/session";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

function duration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} milliseconds`;
  if (seconds < 90) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 5_400) return `${(seconds / 60).toFixed(1)} minutes`;
  if (seconds < 172_800) return `${(seconds / 3_600).toFixed(1)} hours`;
  return `${(seconds / 86_400).toFixed(1)} days`;
}

export default async function ThroughputPage() {
  const clock = await getClock();
  const t = await getThroughput(clock);

  if (!t.adjudication) {
    return (
      <div className="space-y-6">
        <SectionTitle description="No benchmark has been run against this build.">
          Throughput
        </SectionTitle>
      </div>
    );
  }

  const a = t.adjudication;
  const pos = t.pointOfSale;

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`${formatNumber(Math.round(a.claimsPerSecond))} claims a second on one thread of a laptop, measured on ${formatNumber(a.sample)} real requests drawn from this book. The whole plan year re-adjudicates in ${duration(t.wholeYearSeconds)}.`}
      >
        Throughput
      </SectionTitle>

      <IncumbentNote>
        Capacity is the last argument standing once pricing is on the table:
        that claim adjudication is a decade of mainframe engineering, that the
        volumes are unimaginable, and that a plan sponsor could not possibly run
        one. The volumes are not unimaginable. Every prescription dispensed in
        the United States in a year — about{" "}
        {formatNumber(t.nationalScripts / 1_000_000_000, 1)} billion of them —
        would take this engine {t.nationalHours.toFixed(1)} hours on a single
        core of the machine named below. The hard parts of a pharmacy benefit
        manager are the contract, the clinical policy, the rebate agreements and
        the data. Compute has not been the hard part for twenty years, and the
        pricing still reflects a decade when it was.
      </IncumbentNote>

      <Card>
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Claims per second"
            value={formatNumber(Math.round(a.claimsPerSecond))}
            sub="Single thread, reference data resident"
          />
          <Stat
            label="Median decision"
            value={`${(a.p50Ms * 1000).toFixed(0)} µs`}
            sub={`99th percentile ${(a.p99Ms * 1000).toFixed(0)} µs`}
          />
          <Stat
            label="Busiest day in the book"
            value={
              t.busiestDay ? formatNumber(t.busiestDay.claims) : "—"
            }
            sub={
              t.busiestDay
                ? `${formatDate(t.busiestDay.date)}, ${duration(t.busiestDaySeconds)} of work`
                : ""
            }
          />
          <Stat
            label="Headroom at peak"
            value={
              t.peakHeadroom >= 1_000_000
                ? `${formatNumber(t.peakHeadroom / 1_000_000, 1)}M×`
                : `${formatNumber(Math.round(t.peakHeadroom / 1000))}k×`
            }
            sub={`The busiest day's fills arriving across a 14-hour pharmacy day, ${formatNumber(t.members)} lives`}
          />
        </div>
        <div className="px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-600">
          <span className="font-medium text-ink-900">Measured on.</span>{" "}
          {a.machine}, {a.cores} cores, {a.memoryGb} GB. {a.runtime}. Run{" "}
          {formatDateTime(a.ranAt)}. One thread was used; the other{" "}
          {a.cores - 1} sat idle.
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Latency                                                            */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Where the time goes"
          description="Percentiles from the individual timings, not from dividing a total. A mean latency is the number you quote when the tail is embarrassing, so the tail is here: the slowest request in the run, and the shape of the distribution behind it."
        />
        <Table>
          <thead>
            <tr>
              <Th>Run</Th>
              <Th align="right">Requests</Th>
              <Th align="right">Median</Th>
              <Th align="right">90th</Th>
              <Th align="right">99th</Th>
              <Th align="right">99.9th</Th>
              <Th align="right">Slowest</Th>
              <Th align="right">Per second</Th>
            </tr>
          </thead>
          <tbody>
            <LatencyRow label="Decision engine" run={a} />
            {pos ? <LatencyRow label="Full round trip" run={pos} /> : null}
          </tbody>
        </Table>
        <div className="border-t border-ink-200/70 px-5 py-4">
          <Histogram run={a} />
        </div>
        {pos ? (
          <div className="border-t border-ink-200/70 px-5 py-4 text-[12.5px] leading-relaxed text-ink-600">
            <span className="font-medium text-ink-900">
              What the pharmacy waits for.
            </span>{" "}
            The second row is the whole round trip through the same endpoint the
            counter calls: eligibility, the drug, the pharmacy contract, the
            formulary, the member&rsquo;s accumulators, their claim history and
            the clinical screening against active therapy — {pos.notes
              .toLowerCase()
              .includes("database")
              ? "every database read included"
              : "end to end"}
            . The 99th percentile is {pos.p99Ms.toFixed(1)} milliseconds. A
            pharmacy system times out at thirty seconds and a pharmacist starts
            complaining at three, so the budget is roughly three thousand
            times the measurement.
          </div>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Scale                                                              */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="What that means at scale"
          description="Arithmetic on the measured rate. Nothing here assumes a faster engine, a bigger machine, or more than the one thread that was timed."
        />
        <Table>
          <thead>
            <tr>
              <Th>Workload</Th>
              <Th align="right">Claims</Th>
              <Th align="right">Single-thread time</Th>
              <Th>What it is</Th>
            </tr>
          </thead>
          <tbody>
            {t.busiestDay ? (
              <tr>
                <Td>This plan&rsquo;s busiest day</Td>
                <Td align="right">{formatNumber(t.busiestDay.claims)}</Td>
                <Td align="right" className="font-medium">
                  {duration(t.busiestDaySeconds)}
                </Td>
                <Td className="text-ink-600">
                  {formatDate(t.busiestDay.date)}, across{" "}
                  {formatNumber(t.members)} lives
                </Td>
              </tr>
            ) : null}
            <tr>
              <Td>The whole plan year, re-adjudicated</Td>
              <Td align="right">
                {formatNumber(Math.round(t.claimsThisYear / Math.max(0.01, clock.yearElapsed)))}
              </Td>
              <Td align="right" className="font-medium">
                {duration(t.wholeYearSeconds)}
              </Td>
              <Td className="text-ink-600">
                What the change console does when it models a benefit change
                against every claim in the book
              </Td>
            </tr>
            <tr>
              <Td>Every prescription in the United States, for a year</Td>
              <Td align="right">
                {formatNumber(t.nationalScripts / 1_000_000_000, 1)}bn
              </Td>
              <Td align="right" className="font-medium">
                {duration(t.nationalHours * 3_600)}
              </Td>
              <Td className="text-ink-600">
                IQVIA, 2024. Every retail and mail prescription dispensed in the
                country, on one core, over a weekend
              </Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Honesty                                                            */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="What this does not prove"
          description="A benchmark that only flatters itself is marketing. These are the things between this measurement and a production claim processor, stated plainly, because a management team that discovers them later will discount everything else on this page."
        />
        <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
          <Gap title="One machine, one process">
            The engine is stateless per claim once reference data is resident,
            which is why it scales across cores and machines by running more of
            them. That is an ordinary piece of engineering, not a research
            project, but it has not been done here and should not be assumed.
          </Gap>
          <Gap title="SQLite, not a clustered database">
            The store behind this book is a single file. Production needs a
            replicated database, a durable write path, and a retention policy
            measured in years. That work is weeks, not years, and it is the same
            work every claims system does.
          </Gap>
          <Gap title="No network in the measurement">
            A real pharmacy submits over a switch — Change Healthcare, RelayHealth
            — and the switch, the internet and TLS will add tens of milliseconds
            that this measurement does not include. They will not add seconds.
          </Gap>
          <Gap title="No failover, no disaster recovery">
            A pharmacy benefit manager that stops answering stops prescriptions
            being dispensed. High availability, a tested failover and an audited
            recovery point are table stakes and are not modelled here at all.
          </Gap>
          <Gap title="The workload is this book">
            Real books have compounds, coordination of benefits, Medicare Part D
            with its own accumulators, and members with a decade of history. The
            mix here is broad but it is one plan sponsor&rsquo;s.
          </Gap>
          <Gap title="Speed was never the moat">
            Which is the point. If capacity were the barrier, this page would be
            an argument for building one. It is not the barrier, so the question
            for a management team is what the barrier actually is — and whether
            the incumbent has been charging for it.
          </Gap>
        </div>
      </Card>
    </div>
  );
}

function LatencyRow({ label, run }: { label: string; run: RunSummary }) {
  const ms = (v: number) =>
    v < 1 ? `${(v * 1000).toFixed(0)} µs` : `${v.toFixed(2)} ms`;
  return (
    <tr className="hover:bg-ink-50/60">
      <Td className="font-medium">{label}</Td>
      <Td align="right">{formatNumber(run.sample)}</Td>
      <Td align="right">{ms(run.p50Ms)}</Td>
      <Td align="right" className="text-ink-600">
        {ms(run.p90Ms)}
      </Td>
      <Td align="right" className="font-medium">
        {ms(run.p99Ms)}
      </Td>
      <Td align="right" className="text-ink-600">
        {ms(run.p999Ms)}
      </Td>
      <Td align="right" className="text-ink-600">
        {ms(run.maxMs)}
      </Td>
      <Td align="right">
        <Badge tone="accent">
          {formatNumber(Math.round(run.claimsPerSecond))}
        </Badge>
      </Td>
    </tr>
  );
}

function Histogram({ run }: { run: RunSummary }) {
  const max = Math.max(...run.histogram.map((b) => b.count));
  const label = (upperMs: number) =>
    upperMs < 1 ? `≤ ${(upperMs * 1000).toFixed(0)} µs` : `≤ ${upperMs} ms`;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
        Distribution of {formatNumber(run.sample)} decisions
      </div>
      <div className="mt-3 space-y-1">
        {run.histogram.map((b) => (
          <div key={b.upperMs} className="flex items-center gap-3">
            <div className="tnum w-20 shrink-0 text-right text-[12px] text-ink-600">
              {label(b.upperMs)}
            </div>
            <div className="h-3.5 flex-1 rounded-sm bg-ink-100">
              <div
                className="h-full rounded-sm bg-glass-500"
                style={{ width: `${Math.max(0.4, (b.count / max) * 100)}%` }}
              />
            </div>
            <div className="tnum w-24 shrink-0 text-right text-[12px] text-ink-600">
              {formatNumber(b.count)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-ink-900">{title}</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">
        {children}
      </p>
    </div>
  );
}
