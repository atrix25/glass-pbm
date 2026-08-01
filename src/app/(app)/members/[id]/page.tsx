import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquare } from "lucide-react";
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
import { OopCurveChart } from "@/components/charts";
import {
  buildOopCurve,
  getMemberClaims,
  getMemberDetail,
} from "@/lib/queries/members";
import { DEMO_MEMBER_BY_ID } from "@/lib/demo-members";
import { formatCents } from "@/lib/money";
import { formatDate, formatNumber, levelMeta } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const member = await getMemberDetail(id);
  if (!member) notFound();

  const claims = await getMemberClaims(id);
  const curve = buildOopCurve(claims);
  const story = DEMO_MEMBER_BY_ID[id];
  const span = member.eligibilitySpans[0];
  const plan = span?.benefitPlan;

  const paid = claims.filter((c) => c.responseStatus === "P");
  const rejected = claims.filter((c) => c.responseStatus === "R");
  const billed = paid.reduce((s, c) => s + c.totalBilledCents, 0);
  const memberPaid = paid.reduce((s, c) => s + c.patientPayCents, 0);
  const rxOop = paid
    .filter((c) => ["1", "2"].includes(c.formularyLevel ?? ""))
    .reduce((s, c) => s + c.patientPayCents, 0);
  const nonQualifying = memberPaid - rxOop;

  const diagnoses: string[] = JSON.parse(member.diagnosisCodes);

  return (
    <div className="space-y-5">
      <Link
        href="/members"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 transition hover:text-ink-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Membership
      </Link>

      <SectionTitle
        description={story?.story}
        action={
          <Link
            href={`/assistant?member=${member.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-ink-800"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Open member service
          </Link>
        }
      >
        {member.firstName} {member.lastName}
      </SectionTitle>

      <Card>
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Member ID">
            {member.cardholderId}-{member.personCode}
          </Detail>
          <Detail label="Date of birth">{formatDate(member.dateOfBirth)}</Detail>
          <Detail label="Plan">{plan?.name ?? "—"}</Detail>
          <Detail label="Coverage">
            {span ? `${formatDate(span.effectiveDate)} — open` : "—"}
          </Detail>
          <Detail label="Location">
            {member.city ? `${member.city}, ${member.state}` : "—"}
          </Detail>
          <Detail label="Coverage tier">{span?.coverageTier ?? "—"}</Detail>
          <Detail label="Diagnoses on file">
            {diagnoses.length ? diagnoses.join(", ") : "none recorded"}
          </Detail>
          <Detail label="Sponsor">{member.sponsor.shortName}</Detail>
        </div>
      </Card>

      <Card>
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Paid claims" value={formatNumber(paid.length)} />
          <Stat
            label="Plan cost"
            value={formatCents(billed)}
            sub={`${formatCents(billed - memberPaid)} paid by the plan`}
          />
          <Stat
            label="Out of pocket"
            value={formatCents(memberPaid)}
            sub={`${formatCents(rxOop)} counted toward the prescription limit`}
          />
          <Stat
            label="Rejected claims"
            value={formatNumber(rejected.length)}
            tone={rejected.length ? "negative" : "default"}
            sub={
              rejected.length
                ? "Each one sent the member away from the counter"
                : "None"
            }
          />
        </div>
      </Card>

      {plan ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <Card>
            <CardHeader
              title="Out-of-pocket limits"
              description="This plan runs two limits with different eligibility rules."
            />
            <div className="space-y-5 px-5 py-4">
              <Gauge
                label="Prescription out-of-pocket limit"
                sub="Level 1 and Level 2 cost share only"
                current={Math.min(rxOop, plan.rxOopLimitIndividual)}
                limit={plan.rxOopLimitIndividual}
                tone="glass"
              />
              <Gauge
                label="Federal maximum out-of-pocket"
                sub="All cost share, medical and pharmacy combined"
                current={memberPaid}
                limit={plan.federalOopLimitIndividual}
                tone="ink"
              />
              {nonQualifying > 0 ? (
                <div className="rounded-lg border-l-2 border-amber-500 bg-amber-50/70 px-3 py-2.5">
                  <p className="text-[12.5px] leading-relaxed text-amber-950">
                    <strong className="font-semibold">
                      {formatCents(nonQualifying)}
                    </strong>{" "}
                    of this member&apos;s spending came from Level 3 and Level 4
                    fills, which never count toward the{" "}
                    {formatCents(plan.rxOopLimitIndividual)} prescription limit.
                    That is the rule most likely to generate a call, and the
                    agent is built to explain it with the Certificate of
                    Coverage cited.
                  </p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Cumulative out of pocket"
              description="Each step is a fill. The flat stretch is the cap taking effect."
            />
            <div className="px-3 py-4">
              <OopCurveChart
                data={curve}
                rxLimitCents={plan.rxOopLimitIndividual}
              />
            </div>
          </Card>
        </div>
      ) : null}

      {member.priorAuths.length ? (
        <Card>
          <CardHeader
            title="Prior authorizations"
            description="Determinations produced by traversing the published Navitus criteria."
          />
          <Table>
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Drug</Th>
                <Th align="center">Outcome</Th>
                <Th>Deciding step</Th>
                <Th align="right">Received</Th>
              </tr>
            </thead>
            <tbody>
              {member.priorAuths.map((pa) => (
                <tr key={pa.id} className="group transition hover:bg-glass-50/40">
                  <Td>
                    <Link
                      href={`/pa/${pa.id}`}
                      className="tnum font-medium text-ink-900 group-hover:text-glass-700"
                    >
                      {pa.paNumber}
                    </Link>
                    <span className="block text-[11.5px] text-ink-500">
                      {pa.urgency}
                    </span>
                  </Td>
                  <Td>{pa.drug.name}</Td>
                  <Td align="center">
                    <Badge
                      tone={
                        pa.determination === "Approved"
                          ? "positive"
                          : pa.determination === "Denied"
                            ? "negative"
                            : "warn"
                      }
                    >
                      {pa.determination}
                    </Badge>
                  </Td>
                  <Td className="text-[12.5px] text-ink-600">
                    {pa.decidingStepNumber
                      ? `Step ${pa.decidingStepNumber}`
                      : "routed to a pharmacist"}
                  </Td>
                  <Td align="right">{formatDate(pa.receivedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Claim history"
          description="Every submission for this member, in date order. Open any one for its full derivation."
          action={
            <Link
              href={`/claims?member=${member.id}`}
              className="text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
            >
              Open in the ledger
            </Link>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Drug</Th>
              <Th>Pharmacy</Th>
              <Th align="center">Level</Th>
              <Th align="right">Plan cost</Th>
              <Th align="right">Member paid</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => {
              const meta = levelMeta(c.formularyLevel);
              const rejectedRow = c.responseStatus === "R";
              return (
                <tr key={c.id} className="group transition hover:bg-glass-50/40">
                  <Td>
                    <Link
                      href={`/claims/${c.id}`}
                      className="group-hover:text-glass-700"
                    >
                      {formatDate(c.dateOfService)}
                    </Link>
                  </Td>
                  <Td>
                    <span className="line-clamp-1 max-w-[240px]">
                      {c.drug.name}
                    </span>
                  </Td>
                  <Td className="text-[12.5px] text-ink-600">
                    <span className="line-clamp-1 max-w-[150px]">
                      {c.pharmacy.name}
                    </span>
                  </Td>
                  <Td align="center">
                    <Badge className={meta.className}>{meta.short}</Badge>
                  </Td>
                  <Td align="right">
                    {rejectedRow ? "—" : formatCents(c.totalBilledCents)}
                  </Td>
                  <Td align="right">
                    {rejectedRow ? "—" : formatCents(c.patientPayCents)}
                  </Td>
                  <Td>
                    {rejectedRow ? (
                      <span className="text-[12px] text-rose-700">
                        {c.rejectMessage}
                      </span>
                    ) : (
                      <span className="text-[12px] text-ink-500">
                        {c.daysSupply} day supply
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white px-5 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13.5px] text-ink-900">{children}</dd>
    </div>
  );
}

function Gauge({
  label,
  sub,
  current,
  limit,
  tone,
}: {
  label: string;
  sub: string;
  current: number;
  limit: number;
  tone: "glass" | "ink";
}) {
  const pct = Math.min(1, current / Math.max(1, limit));
  const met = current >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-ink-900">{label}</span>
        <span className="tnum text-[13px] text-ink-700">
          {formatCents(current)}{" "}
          <span className="text-ink-400">of {formatCents(limit)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100">
        <div
          className={`h-full rounded-full transition-all ${
            met
              ? "bg-emerald-600"
              : tone === "glass"
                ? "bg-glass-500"
                : "bg-ink-500"
          }`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <p className="mt-1 text-[11.5px] text-ink-500">
        {sub}
        {met ? " · limit reached, the plan pays 100% from here" : ""}
      </p>
    </div>
  );
}
