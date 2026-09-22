import Link from "next/link";
import { CheckCircle2, Clock, ShieldAlert, Stethoscope, XCircle } from "lucide-react";
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
import { getPriorAuthQueueStats, listPriorAuths } from "@/lib/queries/pa";
import { getPaQueueStats } from "@/lib/queries/operations";
import { getClock } from "@/lib/session";
import {
  PA_STATUS_LABEL,
  formatDuration,
  paLiveState,
  type PaLiveState,
} from "@/lib/pa/status";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PriorAuthQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const clock = await getClock();
  const [stats, queueStats, rows] = await Promise.all([
    getPriorAuthQueueStats(clock),
    getPaQueueStats(clock),
    listPriorAuths(clock, { status: params.status }),
  ]);

  const citedShare = (stats.cited / Math.max(1, stats.total)) * 100;

  return (
    <div className="space-y-5">
      <SectionTitle
        description={"Requests, decisions and supporting criteria. Cases without transcribed criteria require pharmacist review."}
        action={
          <Link
            href="/pa/review"
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-[12.5px] font-medium text-ink-700 transition hover:border-ink-300 hover:text-ink-900"
          >
            <Stethoscope className="h-3.5 w-3.5" />
            Pharmacist review
          </Link>
        }
      >
        Prior authorization
      </SectionTitle>

      <Card>
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="In flight now"
            value={formatNumber(stats.pending)}
            tone={queueStats.breached > 0 ? "negative" : "accent"}
            sub={
              queueStats.breached > 0
                ? `${queueStats.breached} past the regulatory deadline, ${queueStats.pendedForInformation} pended on the prescriber`
                : `${queueStats.pendedForInformation} pended on the prescriber, none past deadline`
            }
          />
          <Stat
            label="Decided this year"
            value={formatNumber(stats.total)}
            sub={
              queueStats.medianDecisionMs !== null
                ? `median turnaround ${formatDuration(queueStats.medianDecisionMs)}`
                : `${formatNumber(stats.expedited)} marked expedited`
            }
          />
          <Stat
            label="Approved"
            value={formatNumber(stats.approved)}
            tone="positive"
            sub={`${((stats.approved / Math.max(1, stats.total)) * 100).toFixed(0)}% of determinations, ${formatNumber(stats.denied)} denied`}
          />
          <Stat
            label="Citable to a step"
            value={`${citedShare.toFixed(0)}%`}
            sub={`${formatNumber(stats.cited)} decided by walking a transcribed form; the rest by a pharmacist`}
          />
        </div>
      </Card>

      <Card className="border-glass-600/25 bg-glass-50/40">
        <div className="flex items-start gap-3.5 px-5 py-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-glass-700" />
          <div>
            <h2 className="text-[13.5px] font-semibold text-glass-900">
              Why these decisions are checkable and most PA decisions are not
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-glass-900/75">
              Navitus publishes its commercial criteria as numbered decision
              trees with explicit transitions and explicit terminal outcomes
              carrying approval durations. That structure is machine-evaluable
              without interpretation. This system encodes the trees by hand,
              walks them, and stores the path. It does not ask a language model
              whether a member should get a drug.{" "}
              <Link
                href="/proof#pa"
                className="font-medium underline decoration-glass-600/40 underline-offset-2 hover:decoration-glass-700"
              >
                See the branch coverage
              </Link>
              .
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="The queue"
          description="Newest first, as of the clock. Open any row to see the traversal, or the note explaining why there isn't one."
          action={
            <div className="flex gap-1.5">
              <FilterChip label="All" href="/pa" active={!params.status} />
              <FilterChip
                label="In flight"
                href="/pa?status=InFlight"
                active={params.status === "InFlight"}
              />
              <FilterChip
                label="Approved"
                href="/pa?status=Approved"
                active={params.status === "Approved"}
              />
              <FilterChip
                label="Denied"
                href="/pa?status=Denied"
                active={params.status === "Denied"}
              />
            </div>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Member</Th>
              <Th>Drug</Th>
              <Th>State</Th>
              <Th>Decided on</Th>
              <Th align="right">Received</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const live = paLiveState(r, clock.now);
              return (
                <tr key={r.id} className="transition hover:bg-ink-50/70">
                  <Td>
                    <Link
                      href={`/pa/${r.id}`}
                      className="tnum font-medium text-ink-900 hover:text-glass-700"
                    >
                      {r.paNumber}
                    </Link>
                    {r.urgency === "Expedited" ? (
                      <div className="mt-0.5">
                        <Badge tone="warn">expedited</Badge>
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <Link
                      href={`/members/${r.member.id}`}
                      className="hover:text-glass-700"
                    >
                      {r.member.firstName} {r.member.lastName}
                    </Link>
                  </Td>
                  <Td>
                    <span className="block max-w-[16rem] truncate">
                      {r.drug.name}
                    </span>
                  </Td>
                  <Td>
                    <LiveState live={live} />
                  </Td>
                  {/*
                    Which authority decided the request. Nine in ten have no
                    transcribed form, so stating that on every row buried the
                    one in ten carrying a citation, which is the row worth
                    looking at.
                  */}
                  <Td>
                    {r.decidingStepNumber ? (
                      <>
                        <span className="tnum rounded bg-glass-50 px-1.5 py-0.5 text-[11.5px] font-medium text-glass-800 ring-1 ring-inset ring-glass-600/20">
                          step {r.decidingStepNumber}
                        </span>
                        {r.tree ? (
                          <div className="mt-0.5 max-w-[13rem] truncate text-[11.5px] text-ink-500">
                            {r.tree.name}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-[12px] text-ink-400">
                        pharmacist
                      </span>
                    )}
                  </Td>
                  <Td align="right" className="whitespace-nowrap text-ink-500">
                    {formatDate(r.receivedAt)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-ink-500">
            No requests match this filter.
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * State, and for an open request how long is left on the regulatory clock.
 *
 * The remaining time is the part people actually watch, so it is not tucked
 * into a tooltip.
 */
function LiveState({ live }: { live: PaLiveState }) {
  if (live.status === "Approved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approved
      </span>
    );
  }
  if (live.status === "Denied") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-rose-700">
        <XCircle className="h-3.5 w-3.5" />
        Denied
      </span>
    );
  }
  return (
    <div>
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-glass-800">
        <Clock className="h-3.5 w-3.5" />
        {PA_STATUS_LABEL[live.status]}
      </span>
      {live.msToDue !== null ? (
        <div
          className={`tnum mt-0.5 text-[11.5px] ${
            live.breached ? "font-medium text-rose-700" : "text-ink-500"
          }`}
        >
          {live.breached
            ? `${formatDuration(live.msToDue)} past due`
            : `${formatDuration(live.msToDue)} left`}
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-lg bg-ink-900 px-2.5 py-1 text-[12px] font-medium text-white"
          : "rounded-lg border border-ink-200 px-2.5 py-1 text-[12px] text-ink-600 transition hover:border-ink-300 hover:text-ink-900"
      }
    >
      {label}
    </Link>
  );
}
