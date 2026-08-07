import Link from "next/link";
import { ArrowRight, CircleAlert, Timer } from "lucide-react";
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
import { DailyVolumeChart } from "@/components/charts";
import {
  getInFlightPriorAuths,
  getOperationsSnapshot,
  getPaQueueStats,
  getRecentClaims,
  getRecentlyDecidedPriorAuths,
  type DayActivity,
  type QueueItem,
} from "@/lib/queries/operations";
import { getClock, getBook } from "@/lib/session";
import { PA_STATUS_LABEL, formatDuration } from "@/lib/pa/status";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const [clock, book] = await Promise.all([getClock(), getBook()]);
  const sponsorId = book.sponsorId;
  const [snapshot, paStats, inFlight, decided, recentClaims] =
    await Promise.all([
      getOperationsSnapshot(clock, sponsorId),
      getPaQueueStats(clock),
      getInFlightPriorAuths(clock),
      getRecentlyDecidedPriorAuths(clock),
      getRecentClaims(clock, 25, sponsorId),
    ]);

  const { today, yesterday, recent, yearToDate, membership } = snapshot;
  const runRate =
    yearToDate.daysElapsed > 0
      ? Math.round(yearToDate.claimsSubmitted / yearToDate.daysElapsed)
      : 0;

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`Steel Potatoes LLC, ${formatNumber(membership.lives)} covered lives on ${formatNumber(membership.contracts)} contracts. Everything on this page is cut against the simulation clock in the bar above: claims dated after that instant have not happened yet, and authorizations received but not yet decided are still open.`}
      >
        Live operations
      </SectionTitle>

      <Card>
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Scripts today"
            value={formatNumber(today?.claimsSubmitted ?? 0)}
            tone="accent"
            sub={
              yesterday
                ? `${formatNumber(yesterday.claimsSubmitted)} yesterday, against a year-to-date average of ${formatNumber(runRate)} a day`
                : `Year-to-date average is ${formatNumber(runRate)} a day`
            }
          />
          <Stat
            label="Plan paid today"
            value={formatCentsCompact(today?.planPaidCents ?? 0)}
            sub={`Members paid ${formatCents(today?.patientPayCents ?? 0)} at the counter`}
          />
          <Stat
            label="Authorizations in flight"
            value={formatNumber(paStats.inFlight)}
            tone={paStats.breached > 0 ? "negative" : "default"}
            sub={
              paStats.breached > 0
                ? `${paStats.breached} past the regulatory deadline`
                : "None past the regulatory deadline"
            }
          />
          <Stat
            label="Decided today"
            value={formatNumber(paStats.decidedToday)}
            sub={`${paStats.approvedToday} approved, ${paStats.deniedToday} denied, ${paStats.receivedToday} received`}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Daily volume"
          description="The last thirty days of the book, as of the simulation clock. The right edge is today, and it fills in as the day goes on."
        />
        <div className="px-5 py-4">
          <DailyVolumeChart
            data={recent.map((d) => ({
              date: d.date.toISOString().slice(5, 10),
              paid: d.claimsPaid,
              rejected: d.claimsRejected,
            }))}
          />
        </div>
        <div className="grid gap-px border-t border-ink-200/70 bg-ink-200/60 sm:grid-cols-4">
          <MiniStat
            label="Year to date"
            value={`${formatNumber(yearToDate.claimsSubmitted)} scripts`}
            sub={`over ${yearToDate.daysElapsed} days`}
          />
          <MiniStat
            label="Plan cost"
            value={formatCentsCompact(yearToDate.planPaidCents)}
            sub={`${formatCentsCompact(yearToDate.patientPayCents)} member share`}
          />
          <MiniStat
            label="Generic rate"
            value={`${genericRate(yearToDate)}%`}
            sub={`${formatNumber(yearToDate.brandClaims)} brand fills`}
          />
          <MiniStat
            label="Specialty"
            value={`${specialtyCostShare(yearToDate)}% of spend`}
            sub={`${formatNumber(yearToDate.specialtyClaims)} fills, ${specialtyScriptShare(yearToDate)}% of scripts`}
          />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Prior authorizations in flight"
            description="Open right now: received, and not yet decided. Time remaining runs against the regulatory deadline for the request's urgency."
            action={
              <Link
                href="/pa"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
              >
                Full queue
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          {inFlight.length === 0 ? (
            <EmptyState
              title="Nothing open at this instant"
              description="Every request received by now has been decided. Advance the clock to watch new ones arrive."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Member and drug</Th>
                  <Th>State</Th>
                  <Th align="right">Due in</Th>
                </tr>
              </thead>
              <tbody>
                {inFlight.slice(0, 12).map((pa) => (
                  <QueueRow key={pa.id} pa={pa} />
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Decided in the last three days"
            description="Approvals the engine could justify from a published criteria step are marked as cited. The rest were decided by a pharmacist."
          />
          {decided.length === 0 ? (
            <EmptyState
              title="No decisions in this window"
              description="Advance the clock to let the queue work through."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Member and drug</Th>
                  <Th>Outcome</Th>
                  <Th align="right">Took</Th>
                </tr>
              </thead>
              <tbody>
                {decided.slice(0, 12).map((pa) => (
                  <tr key={pa.id}>
                    <Td>
                      <Link
                        href={`/pa/${pa.id}`}
                        className="font-medium text-ink-900 hover:text-glass-700"
                      >
                        {pa.memberName}
                      </Link>
                      <div className="max-w-[15rem] truncate text-[12px] text-ink-500">
                        {pa.drugName}
                      </div>
                    </Td>
                    {/*
                      Who decided it belongs under the outcome rather than in
                      a column of its own. In its own column the card was too
                      narrow to hold it and every row wrapped to four lines.
                    */}
                    <Td>
                      {pa.status === "Denied" ? (
                        <Badge tone="negative">denied</Badge>
                      ) : (
                        <Badge tone="positive">approved</Badge>
                      )}
                      <div className="mt-1 whitespace-nowrap text-[11.5px] text-ink-500">
                        {pa.decidingStepNumber !== null
                          ? `engine, step ${pa.decidingStepNumber}`
                          : "pharmacist"}
                      </div>
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      <span className="tnum text-[12.5px] text-ink-700">
                        {formatDuration(pa.ageMs)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="The tape"
          description="The most recent fills to reach the processor. Open any one to see its derivation recomputed from the inputs on the claim."
          action={
            <Link
              href="/claims"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
            >
              Full ledger
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Claim</Th>
              <Th>Member</Th>
              <Th>Drug</Th>
              <Th>Pharmacy</Th>
              <Th align="right">Billed</Th>
              <Th align="right">Member</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {recentClaims.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link
                    href={`/claims/${c.id}`}
                    className="tnum text-[12.5px] font-medium text-ink-800 hover:text-glass-700"
                  >
                    {c.claimNumber}
                  </Link>
                </Td>
                <Td>
                  <span className="text-[12.5px]">
                    {c.member.firstName} {c.member.lastName}
                  </span>
                </Td>
                <Td>
                  <span className="line-clamp-1 text-[12.5px]">
                    {c.drug.name}
                  </span>
                </Td>
                <Td>
                  <span className="line-clamp-1 text-[12px] text-ink-500">
                    {c.pharmacy.name}
                  </span>
                </Td>
                <Td align="right">
                  {c.responseStatus === "R"
                    ? "—"
                    : formatCents(c.totalBilledCents)}
                </Td>
                <Td align="right">
                  {c.responseStatus === "R"
                    ? "—"
                    : formatCents(c.patientPayCents)}
                </Td>
                <Td>
                  {c.responseStatus === "R" ? (
                    <Badge tone="negative">
                      {(JSON.parse(c.rejectCodes) as string[])[0] ?? "reject"}
                    </Badge>
                  ) : (
                    <Badge tone="positive">paid</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function QueueRow({ pa }: { pa: QueueItem }) {
  const due = pa.msToDue;
  return (
    <tr className={pa.breached ? "bg-rose-50/60" : ""}>
      <Td>
        <Link
          href={`/pa/${pa.id}`}
          className="font-medium text-ink-900 hover:text-glass-700"
        >
          {pa.memberName}
        </Link>
        {/*
          A formulary name can run to sixty characters with the therapeutic
          class appended. Truncation needs a width to work against, and
          without one the name set the column width and pushed the SLA clock
          off the right edge of the card.
        */}
        <div className="max-w-[11rem] truncate text-[12px] text-ink-500">
          {pa.drugName}
        </div>
      </Td>
      <Td>
        <Badge
          tone={
            pa.status === "PendingInfo"
              ? "warn"
              : pa.status === "InReview"
                ? "accent"
                : "neutral"
          }
        >
          {PA_STATUS_LABEL[pa.status]}
        </Badge>
        {pa.urgency === "Expedited" ? (
          <div className="mt-1">
            <Badge tone="warn">expedited</Badge>
          </div>
        ) : null}
      </Td>
      {/*
        Time remaining and time waited sit in one cell. This card is half the
        page, and a fourth column pushed both of them past the right edge,
        which hid the only numbers on the row that move.
      */}
      <Td align="right" className="whitespace-nowrap">
        {due === null ? (
          <span className="text-[12.5px] text-ink-400">—</span>
        ) : due < 0 ? (
          <span className="tnum inline-flex items-center gap-1 text-[12.5px] font-medium text-rose-700">
            <CircleAlert className="h-3 w-3" />
            {formatDuration(due)} over
          </span>
        ) : (
          <span className="tnum inline-flex items-center gap-1 text-[12.5px] text-ink-700">
            <Timer className="h-3 w-3 text-ink-400" />
            {formatDuration(due)}
          </span>
        )}
        <div className="tnum mt-0.5 text-[11.5px] text-ink-500">
          {formatDuration(pa.ageMs)} old
        </div>
      </Td>
    </tr>
  );
}

function MiniStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white px-5 py-3.5">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-500">
        {label}
      </div>
      <div className="tnum mt-1 text-[15px] font-semibold text-ink-900">
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-ink-500">{sub}</div>
    </div>
  );
}

type Ytd = Awaited<ReturnType<typeof getOperationsSnapshot>>["yearToDate"];

function genericRate(y: Ytd): string {
  const total = y.genericClaims + y.brandClaims;
  return total === 0 ? "0" : ((y.genericClaims / total) * 100).toFixed(1);
}

function specialtyCostShare(y: Ytd): string {
  return y.totalBilledCents === 0
    ? "0"
    : ((y.specialtyBilledCents / y.totalBilledCents) * 100).toFixed(1);
}

function specialtyScriptShare(y: Ytd): string {
  return y.claimsPaid === 0
    ? "0"
    : ((y.specialtyClaims / y.claimsPaid) * 100).toFixed(1);
}

export type { DayActivity };
