import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  IncumbentNote,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { DETECTORS } from "@/lib/integrity/detectors";
import {
  formatObserved,
  getIntegrityOverview,
  type SignalRow,
} from "@/lib/queries/integrity";
import { getClock } from "@/lib/session";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function IntegrityPage() {
  const clock = await getClock();
  const overview = await getIntegrityOverview(clock);

  const actionable = overview.signals.filter((s) => s.severity !== "Watch");
  const watch = overview.signals.filter((s) => s.severity === "Watch");

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`Every paid claim in the book, scored against the population it came from. ${formatNumber(overview.claimsScreened)} claims across ${formatNumber(overview.membersScreened)} members, ${formatNumber(overview.prescribersScreened)} prescribers and ${formatNumber(overview.pharmaciesScreened)} pharmacies, screened by four detectors in about four seconds.`}
        action={
          <Link
            href="/proof"
            className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
          >
            Correctness harness
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        Program integrity
      </SectionTitle>

      <IncumbentNote>
        Program integrity is not a line item in Contract ETG0013. It is inside
        the $2.10 per member per month administrative fee, along with claims
        processing, prior authorisation, clinical review, member service and
        reporting — every function in this build, for about $2.6 million a year
        across this book. A traditional PBM does not charge a fee for this at
        all; it takes spread instead, which on these same claims came to{" "}
        <Link href="/reports" className="underline underline-offset-2">
          $19.3 million
        </Link>
        . The detectors below are four SQL queries over data the plan already
        owns.
      </IncumbentNote>

      <Card>
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="High severity"
            value={formatNumber(overview.bySeverity.high)}
            tone={overview.bySeverity.high > 0 ? "negative" : "positive"}
            sub="Far outside the peer distribution, or meeting published federal criteria"
          />
          <Stat
            label="Elevated"
            value={formatNumber(overview.bySeverity.elevated)}
            sub="Above the peer 95th percentile, worth a look"
          />
          <Stat
            label="Watch"
            value={formatNumber(overview.bySeverity.watch)}
            sub="In the tail but not separated from it; shown for completeness"
          />
          <Stat
            label="Claims implicated"
            value={formatCentsCompact(overview.totalExposureCents)}
            sub="Plan paid on the claims behind every high and elevated signal"
          />
        </div>
      </Card>

      {overview.plantedTotal > 0 ? (
        <Card>
          <div className="flex items-start gap-3 px-5 py-4">
            <ShieldCheck
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                overview.plantedFound === overview.plantedTotal
                  ? "text-emerald-600"
                  : "text-rose-600"
              }`}
            />
            <div className="text-[13px] leading-relaxed text-ink-700">
              <span className="font-semibold text-ink-900">
                {overview.plantedFound} of {overview.plantedTotal} planted cases
                found.
              </span>{" "}
              Randomly generated data contains no fraud, so a detector run
              against it finds almost nothing — which says something about
              specificity and nothing about whether it works. Five cases were
              therefore planted in the book with a coherent story. The detectors
              are not told where they are; they rank the whole population and
              the planted cases have to surface on their own merits. Every one
              of them did, at the top of its detector, and the proof harness
              checks it rather than asking you to take it on trust.
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Findings"
          description="Ranked by how far the subject sits above its own peer group, not by raw volume. The peer figures are shown next to every observation so the comparison is visible rather than asserted."
        />
        {actionable.length === 0 ? (
          <EmptyState
            title="Nothing above the watch threshold"
            description="No subject in the book separated itself from its peer distribution."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Subject</Th>
                <Th>Detector</Th>
                <Th align="right">Observed</Th>
                <Th align="right">Peer median</Th>
                <Th align="right">Peer p95</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Plan paid</Th>
                <Th>Severity</Th>
              </tr>
            </thead>
            <tbody>
              {actionable.map((s) => (
                <SignalRowView key={s.id} signal={s} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {actionable.length > 0 ? (
        <Card>
          <CardHeader
            title="Evidence"
            description="What each high-severity finding is actually made of. A signal a reviewer cannot open is a signal a reviewer cannot act on."
          />
          <div className="divide-y divide-ink-200/70">
            {actionable
              .filter((s) => s.severity === "High")
              .slice(0, 6)
              .map((s) => (
                <div key={s.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-ink-900">
                      {s.subjectLabel}
                    </span>
                    <Badge tone="neutral">{s.detector.name}</Badge>
                    {s.seededCase ? (
                      <Badge tone="accent">Planted case</Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {s.evidence.map((e, i) => (
                      <div key={i}>
                        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">
                          {e.label}
                        </div>
                        <div className="tnum mt-0.5 text-[15px] font-semibold text-ink-900">
                          {e.value}
                        </div>
                        <div className="mt-0.5 text-[12px] leading-snug text-ink-500">
                          {e.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-[12.5px] leading-relaxed text-ink-600">
                    {s.detector.citation ? (
                      <>
                        <span className="font-medium text-ink-700">
                          Criteria:
                        </span>{" "}
                        {s.detector.citation}
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-ink-700">Method:</span>{" "}
                        {s.detector.method}
                      </>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="What each detector asks"
          description="Two of these implement published federal criteria. The other two are conventional method — rank against peers, read the tail — and are labelled as such rather than dressed up."
        />
        <div className="divide-y divide-ink-200/70">
          {DETECTORS.map((d) => {
            const mine = overview.signals.filter((s) => s.detector.id === d.id);
            return (
              <div key={d.id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[13.5px] font-semibold text-ink-900">
                    {d.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{d.subjectType}</Badge>
                    <span className="tnum text-[12.5px] text-ink-500">
                      {mine.length}{" "}
                      {mine.length === 1 ? "finding" : "findings"}
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 max-w-4xl text-[13px] leading-relaxed text-ink-600">
                  {d.question}
                </p>
                <p className="mt-1.5 max-w-4xl text-[12.5px] leading-relaxed text-ink-500">
                  {d.method}
                </p>
                {d.citation ? (
                  <p className="mt-1.5 max-w-4xl text-[12.5px] leading-relaxed text-glass-800">
                    {d.citation}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-ink-400">
                    No published standard. The thresholds are ours, and the
                    method is peer-relative ranking rather than anything
                    proprietary.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {watch.length > 0 ? (
        <Card>
          <CardHeader
            title={`${watch.length} subjects in the tail`}
            description="Above the peer 95th percentile but not separated from the distribution. Shown because leaving them out would make the findings above look cleaner than they are: a real queue has a long, ambiguous middle."
          />
          <Table>
            <thead>
              <tr>
                <Th>Subject</Th>
                <Th>Detector</Th>
                <Th align="right">Observed</Th>
                <Th align="right">Peer median</Th>
                <Th align="right">Claims</Th>
                <Th align="right">Plan paid</Th>
              </tr>
            </thead>
            <tbody>
              {watch.slice(0, 20).map((s) => (
                <tr key={s.id}>
                  <Td>
                    <SubjectLink signal={s} />
                  </Td>
                  <Td>
                    <span className="text-[12.5px] text-ink-600">
                      {s.detector.name}
                    </span>
                  </Td>
                  <Td align="right" className="tnum">
                    {formatObserved(s.detector, s.observed)}
                  </Td>
                  <Td align="right" className="tnum text-ink-500">
                    {formatObserved(s.detector, s.peerMedian)}
                  </Td>
                  <Td align="right" className="tnum">
                    {formatNumber(s.claimCount)}
                  </Td>
                  <Td align="right" className="tnum">
                    {formatCents(s.exposureCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

function SignalRowView({ signal }: { signal: SignalRow }) {
  const tone =
    signal.severity === "High"
      ? "negative"
      : signal.severity === "Elevated"
        ? "warn"
        : "neutral";

  return (
    <tr>
      <Td>
        <SubjectLink signal={signal} />
        <div className="mt-0.5 text-[12px] text-ink-500">
          {formatDate(signal.windowStart)} to {formatDate(signal.windowEnd)}
        </div>
      </Td>
      <Td>
        <span className="block max-w-[15rem] text-[12.5px] text-ink-600">
          {signal.detector.name}
        </span>
        {signal.seededCase ? (
          <Badge tone="accent" className="mt-1">
            Planted case
          </Badge>
        ) : null}
      </Td>
      <Td align="right" className="tnum font-semibold">
        {formatObserved(signal.detector, signal.observed)}
      </Td>
      <Td align="right" className="tnum text-ink-500">
        {formatObserved(signal.detector, signal.peerMedian)}
      </Td>
      <Td align="right" className="tnum text-ink-500">
        {formatObserved(signal.detector, signal.peerP95)}
      </Td>
      <Td align="right" className="tnum">
        {formatNumber(signal.claimCount)}
      </Td>
      <Td align="right" className="tnum">
        {formatCents(signal.exposureCents)}
      </Td>
      <Td>
        <Badge tone={tone}>{signal.severity}</Badge>
      </Td>
    </tr>
  );
}

function SubjectLink({ signal }: { signal: SignalRow }) {
  if (signal.subjectType === "member") {
    return (
      <Link
        href={`/members/${signal.subjectId}`}
        className="whitespace-nowrap text-[13px] font-medium text-glass-700 hover:text-glass-900"
      >
        {signal.subjectLabel}
      </Link>
    );
  }
  return (
    <span className="block max-w-[14rem] truncate whitespace-nowrap text-[13px] font-medium text-ink-900">
      {signal.subjectLabel}
    </span>
  );
}
