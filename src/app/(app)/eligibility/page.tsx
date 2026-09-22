import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ProportionBar,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  getAuditFindings,
  getFeedOverview,
  getRejectOverview,
  getSampleTransaction,
} from "@/lib/queries/eligibility";
import { renderX12, MAINTENANCE_TYPE_LABEL } from "@/lib/eligibility/x12";
import { getClock } from "@/lib/session";
import { formatCentsWhole } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EligibilityPage() {
  const clock = await getClock();
  const [feed, rejects, audits, sample] = await Promise.all([
    getFeedOverview(clock),
    getRejectOverview(clock),
    getAuditFindings(clock),
    getSampleTransaction(clock),
  ]);

  const segments = sample
    ? renderX12({
        controlNumber: sample.file.controlNumber,
        senderId: sample.file.senderId,
        receiverId: sample.file.receiverId,
        fileType: sample.file.fileType,
        createdAt: sample.file.createdAt,
        transaction: sample.transaction,
        sponsorName: "Steel Potatoes LLC",
        dateOfBirth: sample.member?.dateOfBirth ?? null,
        gender: sample.member?.gender ?? null,
      })
    : [];

  const maxAging = Math.max(1, ...rejects.aging.map((a) => a.count));

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`${formatNumber(feed.livesOnFile)} covered lives · ${feed.filesReceived} eligibility files received.`}
      >
        Eligibility feed
      </SectionTitle>

      <Card>
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Lives on file"
            value={formatNumber(feed.livesOnFile)}
            sub="Covered as of the current date"
          />
          <Stat
            label="Instructions applied"
            value={formatNumber(feed.transactionsApplied)}
            sub={`${formatNumber(feed.adds)} adds, ${formatNumber(feed.changes)} changes, ${formatNumber(feed.terms)} terms`}
          />
          <Stat
            label="Open rejections"
            value={formatNumber(feed.openRejects)}
            tone={feed.openRejects > 0 ? "negative" : "positive"}
            sub={`${formatNumber(feed.resolvedRejects)} corrected or withdrawn`}
          />
          <Stat
            label="Median turnaround"
            value={`${feed.medianTurnaroundHours}h`}
            sub="File cut to instructions applied"
          />
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* The inbox                                                          */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="File inbox"
          description="A change file every Monday carrying only what moved, and a full audit on the first Monday of the month restating the whole population. The audit is not ceremony: it is the only way to find a termination the sponsor never sent."
        />
        <Table>
          <thead>
            <tr>
              <Th>Control number</Th>
              <Th>Type</Th>
              <Th align="right">Cut</Th>
              <Th align="right">Received</Th>
              <Th align="right">Turnaround</Th>
              <Th align="right">Records</Th>
              <Th align="right">Adds</Th>
              <Th align="right">Changes</Th>
              <Th align="right">Terms</Th>
              <Th align="right">Rejected</Th>
              <Th align="right">Status</Th>
            </tr>
          </thead>
          <tbody>
            {feed.files.map((f) => (
              <tr key={f.id} className="hover:bg-ink-50/60">
                <Td className="font-mono text-[12px]">{f.controlNumber}</Td>
                <Td>
                  <Badge tone={f.fileType === "Change" ? "neutral" : "accent"}>
                    {f.fileType}
                  </Badge>
                </Td>
                <Td align="right" className="text-ink-600">
                  {formatDate(f.createdAt)}
                </Td>
                <Td align="right" className="text-ink-600">
                  {formatDate(f.receivedAt)}
                </Td>
                <Td align="right" className="text-ink-600">
                  {f.turnaroundHours}h
                </Td>
                <Td align="right">{formatNumber(f.recordCount)}</Td>
                <Td align="right" className="text-ink-600">
                  {f.addCount || "—"}
                </Td>
                <Td align="right" className="text-ink-600">
                  {f.changeCount || "—"}
                </Td>
                <Td align="right" className="text-ink-600">
                  {f.termCount || "—"}
                </Td>
                <Td
                  align="right"
                  className={f.rejectCount > 0 ? "text-rose-700" : "text-ink-400"}
                >
                  {f.rejectCount || "—"}
                </Td>
                <Td align="right">
                  <Badge
                    tone={
                      f.status === "Processed"
                        ? "positive"
                        : f.status === "In processing"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {f.status}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* One instruction, on the wire                                       */}
      {/* ------------------------------------------------------------------ */}

      {sample ? (
        <Card>
          <CardHeader
            title="One instruction, as it arrived"
            description={`A ${MAINTENANCE_TYPE_LABEL[sample.transaction.maintenanceType] ?? "instruction"} for ${sample.transaction.memberName}, on control number ${sample.file.controlNumber}. Rebuilt from the columns it was parsed into rather than replayed from a stored copy.`}
          />
          <div className="divide-y divide-ink-100">
            {segments.map((s, i) => (
              <div
                key={i}
                className="grid gap-1 px-5 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-6"
              >
                {/* The envelope is fixed-width by specification, so the
                    padding has to survive to the screen. */}
                <code className="min-w-0 break-all whitespace-pre-wrap font-mono text-[11.5px] text-ink-900">
                  {s.text}
                </code>
                <p className="text-[12px] leading-relaxed text-ink-500">
                  {s.gloss}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Rejections                                                         */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Rejected instructions"
          description="An instruction the plan could not apply changes nothing and has to go back. Until the sponsor re-sends it corrected, somebody is enrolled who should not be, or is not enrolled who should be, and they find out at a pharmacy counter."
          action={
            <Badge tone={rejects.openCount > 0 ? "negative" : "positive"}>
              {formatNumber(rejects.openCount)} open
            </Badge>
          }
        />
        <div className="grid grid-cols-1 divide-y divide-ink-200/70 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              How long they have been waiting
            </div>
            <div className="mt-3 space-y-3">
              {rejects.aging.map((a) => (
                <div key={a.bucket}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-ink-800">{a.bucket}</span>
                    <span className="tnum shrink-0 text-[12.5px] text-ink-500">
                      {formatNumber(a.count)}
                    </span>
                  </div>
                  <ProportionBar
                    className="mt-1.5"
                    segments={[
                      {
                        label: a.bucket,
                        value: a.count,
                        className: "bg-rose-500",
                      },
                      {
                        label: "rest",
                        value: maxAging - a.count,
                        className: "bg-transparent",
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-ink-500">
              Rejections close in a median of {rejects.medianResolutionDays}{" "}
              days, either because the sponsor re-sent the instruction
              correctly on its next weekly file or because it confirmed the
              person is not theirs and withdrew it.
            </p>
          </div>

          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Why they failed
            </div>
            <dl className="mt-3 space-y-2.5 text-[13px] leading-relaxed">
              {rejects.reasons.map((r) => (
                <div key={r.code}>
                  <dt className="flex items-baseline justify-between gap-3 font-medium text-ink-900">
                    <span>
                      <span className="mr-2 font-mono text-[11.5px] text-ink-500">
                        {r.code}
                      </span>
                      {formatNumber(r.count)} instructions
                    </span>
                    <span className="tnum shrink-0 text-[12px] text-ink-500">
                      {r.open} open
                    </span>
                  </dt>
                  <dd className="text-ink-600">{r.reason}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {rejects.open.length === 0 ? (
          <EmptyState title="Nothing open" description="Every rejected instruction has been corrected and re-sent." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th align="right">Received</Th>
                <Th>Instruction</Th>
                <Th>Contract</Th>
                <Th>Name on the file</Th>
                <Th>Reason</Th>
                <Th align="right">Age</Th>
              </tr>
            </thead>
            <tbody>
              {rejects.open.map((r) => (
                <tr key={r.id} className="hover:bg-ink-50/60">
                  <Td className="font-mono text-[12px]">
                    {r.fileControlNumber}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(r.receivedAt)}
                  </Td>
                  <Td className="capitalize text-ink-600">
                    {MAINTENANCE_TYPE_LABEL[r.maintenanceType] ??
                      r.maintenanceType}
                  </Td>
                  <Td className="font-mono text-[12px]">
                    {r.cardholderId}-{r.personCode}
                  </Td>
                  <Td className="max-w-[180px] truncate" title={r.memberName}>
                    {r.memberName}
                  </Td>
                  <Td
                    className="max-w-[320px] truncate text-ink-600"
                    title={r.rejectReason}
                  >
                    <span className="mr-2 font-mono text-[11.5px] text-ink-500">
                      {r.rejectCode}
                    </span>
                    {r.rejectReason}
                  </Td>
                  <Td align="right">
                    <Badge tone={r.ageDays > 30 ? "negative" : "warn"}>
                      {r.ageDays}d
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* What the audit caught                                              */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Audit findings"
          description="A change file can only report changes the sponsor knew to send. The restatement finds the ones it did not: the member is simply absent from the roster, and the absence is the notice."
          action={
            <Link
              href="/reversals"
              className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
            >
              Recovery worklist
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        {audits.length === 0 ? (
          <EmptyState
            title="No audit has run yet"
            description="The clock has not reached the first full restatement of the year."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Audit</Th>
                <Th align="right">Processed</Th>
                <Th align="right">Lives restated</Th>
                <Th align="right">Terminations found</Th>
                <Th align="right">Median lag</Th>
                <Th align="right">Claims outside coverage</Th>
                <Th align="right">Recoverable</Th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.controlNumber} className="hover:bg-ink-50/60">
                  <Td className="font-mono text-[12px]">{a.controlNumber}</Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(a.processedAt)}
                  </Td>
                  <Td align="right">{formatNumber(a.restatedLives)}</Td>
                  <Td align="right">{formatNumber(a.terminationsFound)}</Td>
                  <Td align="right">
                    <Badge tone={a.medianLagDays > 60 ? "negative" : "warn"}>
                      {a.medianLagDays}d
                    </Badge>
                  </Td>
                  <Td align="right">{formatNumber(a.claimsAfterTermination)}</Td>
                  <Td align="right" className="font-medium text-rose-700">
                    {formatCentsWhole(a.recoverableCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-ink-200/70 px-5 py-4 text-[12.5px] leading-relaxed text-ink-500">
          Nothing about the claims in that last column was wrong when it
          adjudicated. Each one was correct against eligibility as it stood, and
          each one still reproduces step for step. What changed is the span
          underneath, which is why the audit is the mechanism and not an
          afterthought: without it the money is not recovered, it is written
          off.
        </div>
      </Card>
    </div>
  );
}
