import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Minus,
  X,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  SourceLink,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { EpaExchange } from "@/components/epa-exchange";
import { getEpaExchange, getPaClaims, getPriorAuthDetail } from "@/lib/queries/pa";
import { paDeadlines } from "@/lib/pa/engine";
import { formatCents } from "@/lib/money";
import { getClock } from "@/lib/session";
import { formatDate, formatDateTime } from "@/lib/utils";
import { getSource } from "@/lib/sources";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PriorAuthDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const simClock = await getClock();
  const detail = await getPriorAuthDetail(id, simClock);
  if (!detail) notFound();
  const { pa, path } = detail;
  const [claims, exchange] = await Promise.all([
    getPaClaims(pa.memberId, pa.drugId, simClock),
    getEpaExchange(id, simClock),
  ]);

  const approved = pa.determination === "Approved";
  const denied = pa.determination === "Denied";
  const visited = path.filter((s) => s.visited);

  /*
   * Two deadlines, both real, and the request is held to the earlier one.
   *
   * The regulation that governs this request is not a single hardcoded pair of
   * Part D citations: a commercial pre-service request is an ERISA claim with a
   * 15-day clock, and an exception request does not start its clock until the
   * prescriber's supporting statement arrives. Over the top of that sits the
   * turnaround the plan actually bought, which on a standard request is twelve
   * days shorter than the law allows. Showing only the statutory one would make
   * a request that owes a performance credit look comfortably on time.
   */
  const deadlines = paDeadlines(
    pa.receivedAt,
    pa.urgency === "Expedited" ? "Expedited" : "Standard",
    "Commercial",
    {
      requestType: pa.requestType,
      supportingStatementAt: pa.prescriberStatementAt,
    },
  );
  const sla = deadlines.binding;
  const turnaroundHours = pa.decidedAt
    ? (pa.decidedAt.getTime() - sla.startedAt.getTime()) / 3_600_000
    : null;
  const allowedHours = sla.hours;
  const clock = getSource("cfr-2560-503-1");

  return (
    <div className="space-y-5">
      <Link
        href="/pa"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500 transition hover:text-ink-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Prior authorization queue
      </Link>

      {/* Outcome banner */}
      <Card
        className={cn(
          approved && "border-emerald-600/25 bg-emerald-50/40",
          denied && "border-rose-600/25 bg-rose-50/40",
        )}
      >
        <div className="flex flex-wrap items-start gap-4 px-5 py-4">
          {approved ? (
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
          ) : denied ? (
            <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-rose-700" />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[17px] font-semibold tracking-tight text-ink-900">
                {pa.determination ?? pa.status}
                {pa.decidingStepNumber
                  ? ` at step ${pa.decidingStepNumber}`
                  : ""}
              </h1>
              {pa.urgency === "Expedited" ? (
                <Badge tone="warn">expedited</Badge>
              ) : null}
              <span className="tnum text-[12.5px] text-ink-500">
                {pa.paNumber}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">
              {denied
                ? pa.denyReason
                : approved
                  ? `Approved for ${pa.approvedDays} days${pa.approvedEffectiveDate ? `, effective ${formatDate(pa.approvedEffectiveDate)}` : ""}${pa.approvedTerminationDate ? ` through ${formatDate(pa.approvedTerminationDate)}` : ""}.`
                  : "Awaiting determination."}
            </p>
            {pa.reviewerNote ? (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
                {pa.reviewerNote}
              </p>
            ) : null}
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-4">
            <Meta label="Member">
              <Link
                href={`/members/${pa.memberId}`}
                className="font-medium text-ink-900 hover:text-glass-700"
              >
                {pa.member.firstName} {pa.member.lastName}
              </Link>
            </Meta>
            <Meta label="Drug">{pa.drug.name}</Meta>
            <Meta label="Received">{formatDateTime(pa.receivedAt)}</Meta>
            <Meta label="Decided">
              {pa.decidedAt ? formatDateTime(pa.decidedAt) : "—"}
            </Meta>
          </dl>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* The traversal */}
        <Card>
          <CardHeader
            title="Criteria traversal"
            description={
              pa.tree
                ? `Every numbered question in the ${pa.tree.name} form. The engine answered the ones on the path and never reached the rest.`
                : "No encoded criteria tree for this drug."
            }
            action={
              pa.tree?.sourceDocument ? (
                <a
                  href={pa.tree.sourceDocument.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
                >
                  Open the published form
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null
            }
          />
          <ol className="divide-y divide-ink-100">
            {path.map((step) => (
              <li
                key={step.stepNumber}
                className={cn(
                  "px-5 py-3.5",
                  !step.visited && "bg-ink-50/40",
                  step.stepNumber === pa.decidingStepNumber &&
                    (approved
                      ? "bg-emerald-50/60"
                      : denied
                        ? "bg-rose-50/60"
                        : ""),
                )}
              >
                <div className="flex items-start gap-3">
                  <StepMark
                    visited={step.visited}
                    answer={step.answer}
                    number={step.stepNumber}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className={cn(
                          "text-[13px] font-medium leading-snug",
                          step.visited ? "text-ink-900" : "text-ink-400",
                        )}
                      >
                        {step.question}
                      </span>
                      {step.stepNumber === pa.decidingStepNumber ? (
                        <Badge tone={approved ? "positive" : "negative"}>
                          decided here
                        </Badge>
                      ) : null}
                    </div>

                    {step.visited ? (
                      <>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-600">
                          <span
                            className={cn(
                              "font-medium",
                              step.answer ? "text-emerald-700" : "text-rose-700",
                            )}
                          >
                            {step.answer ? "Yes" : "No"}
                          </span>
                          {" — "}
                          {step.evidence ??
                            "answered from the member's record and the submitted form"}
                        </p>
                        <p className="mt-1 text-[11.5px] text-ink-500">
                          {describeOutcome(
                            step.answer ? step.yes : step.no,
                            step.answer ? undefined : step.no.reason,
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-[11.5px] text-ink-400">
                        Not reached. The path terminated before this question.
                      </p>
                    )}

                    {step.citation ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-ink-400">
                        <FileText className="mt-[1px] h-3 w-3 shrink-0" />
                        {step.citation}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {path.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-ink-500">
              This drug has no transcribed criteria tree. The catalogue of
              published forms is on the{" "}
              <Link href="/sources" className="text-glass-700 hover:underline">
                sources page
              </Link>
              , with the coverage gap stated rather than hidden.
            </div>
          ) : null}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Turnaround"
              description="Measured against the earlier of two deadlines: what the regulation allows and what the contract promised."
            />
            <div className="space-y-3 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-ink-700">
                  Time to determination
                </span>
                <span className="tnum text-[15px] font-semibold text-ink-900">
                  {turnaroundHours != null
                    ? `${turnaroundHours.toFixed(1)} h`
                    : "—"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  className={cn(
                    "h-full rounded-full",
                    (turnaroundHours ?? 0) <= allowedHours
                      ? "bg-emerald-500"
                      : "bg-rose-500",
                  )}
                  style={{
                    width: `${Math.min(100, ((turnaroundHours ?? 0) / allowedHours) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-[12px] leading-relaxed text-ink-500">
                A {pa.urgency.toLowerCase()} {pa.requestType === "PA" ? "request" : "exception request"}{" "}
                allows {allowedHours} hours. This one took{" "}
                {turnaroundHours != null
                  ? `${turnaroundHours.toFixed(1)}`
                  : "—"}
                .
              </p>

              {/*
                Both clocks, named. The binding one is the number above; the
                other is shown so the gap between what was promised and what is
                permitted is visible rather than implied.
              */}
              <div className="space-y-1.5 rounded-lg bg-ink-50/70 px-3 py-2.5">
                <DeadlineLine
                  label="Contract"
                  hours={deadlines.contractual.hours}
                  binds={deadlines.bindingSource === "contractual"}
                />
                <DeadlineLine
                  label="Regulation"
                  hours={deadlines.regulatory.hours}
                  binds={deadlines.bindingSource === "regulatory"}
                />
                <p className="pt-0.5 text-[11px] leading-relaxed text-ink-500">
                  {deadlines.bindingSource === "contractual"
                    ? "The contract is the binding number here. Missing it draws on the amount at risk in the guarantee schedule; missing the regulatory one would additionally vest the member's right to external review."
                    : "The regulation is the binding number here."}
                </p>
              </div>
              {sla.startedAt.getTime() !== pa.receivedAt.getTime() ? (
                <p className="text-[11.5px] leading-relaxed text-ink-500">
                  The clock started on {formatDateTime(sla.startedAt)}, when the
                  prescriber&apos;s supporting statement arrived, rather than on
                  receipt. An exception asks the plan to depart from its own
                  formulary, which it cannot decide until the prescriber has said
                  why it should.
                </p>
              ) : null}
              {sla.awaitingSupportingStatement ? (
                <p className="text-[11.5px] leading-relaxed text-amber-700">
                  Waiting on the prescriber&apos;s supporting statement. The
                  regulatory clock has not started.
                </p>
              ) : null}
              <p className="text-[11.5px] leading-relaxed text-ink-500">
                {sla.citation}
              </p>
              <SourceLink url={clock.url}>{clock.title}</SourceLink>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Decided by"
              description="Automation is allowed to approve. Only a pharmacist may deny."
            />
            <div className="space-y-2.5 px-5 py-4 text-[13px]">
              <Row label="Reviewer">
                {pa.decidedBy === "AI"
                  ? "Automated criteria traversal"
                  : (pa.decidedBy ?? "Not yet decided")}
              </Row>
              <Row label="Escalated">
                {pa.escalated ? "Yes, routed to a pharmacist" : "No"}
              </Row>
              <Row label="Questions answered">
                {visited.length} of {path.length}
              </Row>
              <Row label="Criteria document">
                {pa.tree?.name ?? "None encoded"}
              </Row>
              <p className="pt-1 text-[11.5px] leading-relaxed text-ink-500">
                The traversal is deterministic: the same answers produce the same
                outcome every time, and the outcome names the step that caused
                it. There is no model judgment anywhere in this decision.
              </p>
            </div>
          </Card>

          {exchange ? (
            <EpaExchange
              transactions={exchange.transactions}
              questionnaire={exchange.questionnaire}
              unusedAnswers={exchange.unusedAnswers}
            />
          ) : null}

          {claims.length > 0 ? (
            <Card>
              <CardHeader
                title="Claims for this drug"
                description="What the authorization actually let through."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Result</Th>
                    <Th align="right">Plan paid</Th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => (
                    <tr key={c.id}>
                      <Td>
                        <Link
                          href={`/claims/${c.id}`}
                          className="hover:text-glass-700"
                        >
                          {formatDate(c.dateOfService)}
                        </Link>
                      </Td>
                      <Td>
                        {c.responseStatus === "P" ? (
                          <Badge tone="positive">paid</Badge>
                        ) : (
                          <span className="text-[12px] text-rose-700">
                            {c.rejectMessage}
                          </span>
                        )}
                      </Td>
                      <Td align="right">{formatCents(c.planPaidCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function describeOutcome(
  branch: { outcome: string; step?: number | null; days?: number | null },
  reason?: string | null,
): string {
  if (branch.outcome === "step") return `Continue to step ${branch.step}.`;
  if (branch.outcome === "approve")
    return `Form complete here. Approve for ${branch.days} days.`;
  return reason ? `Form complete here. Deny: ${reason}` : "Form complete here. Deny.";
}

function StepMark({
  visited,
  answer,
  number,
}: {
  visited: boolean;
  answer: boolean | null;
  number: number;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          "tnum flex h-5 w-5 items-center justify-center rounded text-[10.5px] font-semibold",
          visited ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-400",
        )}
      >
        {number}
      </span>
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full",
          !visited
            ? "bg-ink-100 text-ink-300"
            : answer
              ? "bg-emerald-100 text-emerald-700"
              : "bg-rose-100 text-rose-700",
        )}
      >
        {!visited ? (
          <Minus className="h-2.5 w-2.5" />
        ) : answer ? (
          <Check className="h-2.5 w-2.5" />
        ) : (
          <X className="h-2.5 w-2.5" />
        )}
      </span>
    </span>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-ink-800">{children}</dd>
    </div>
  );
}

function DeadlineLine({
  label,
  hours,
  binds,
}: {
  label: string;
  hours: number;
  binds: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className={binds ? "font-medium text-ink-800" : "text-ink-500"}>
        {label}
      </span>
      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            "tnum",
            binds ? "font-semibold text-ink-900" : "text-ink-500",
          )}
        >
          {hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`}
        </span>
        {binds ? <Badge tone="accent">binds</Badge> : null}
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-600">{label}</span>
      <span className="text-right font-medium text-ink-900">{children}</span>
    </div>
  );
}
