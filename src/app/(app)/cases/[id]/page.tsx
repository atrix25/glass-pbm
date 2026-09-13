import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, SectionTitle, Stat } from "@/components/ui";
import { canMutate } from "@/lib/auth";
import { demoFeaturesEnabled } from "@/lib/config";
import { prisma } from "@/lib/db";
import { getClock, getSessionUser } from "@/lib/session";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  formatSla,
  priorityTone,
  sourceHref,
  sourceLabel,
} from "../case-display";
import { CaseActions } from "./case-actions";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [serviceCase, { now }, sessionUser] = await Promise.all([
    prisma.serviceCase.findUnique({ where: { id } }),
    getClock(),
    getSessionUser(),
  ]);
  if (!serviceCase) notFound();

  const domainHref = sourceHref(
    serviceCase.sourceType,
    serviceCase.sourceId,
  );
  const runHref = serviceCase.agentRunId
    ? `/agents/runs/${serviceCase.agentRunId}`
    : serviceCase.sourceType === "AgentRun"
      ? `/agents/runs/${serviceCase.sourceId}`
      : null;
  const sla = formatSla(serviceCase.slaDueAt, now);
  const canAct =
    demoFeaturesEnabled() ||
    Boolean(sessionUser && canMutate(sessionUser.role));
  const operatorLabel =
    sessionUser?.name ?? sessionUser?.email ?? "Demo case operator";

  return (
    <div className="space-y-5">
      <Link
        href="/cases"
        className="inline-flex text-[12.5px] text-glass-700 hover:text-glass-900"
      >
        ← Service cases
      </Link>

      <SectionTitle
        description={`${serviceCase.caseNumber} · ${serviceCase.queue}`}
        action={
          <Badge
            tone={serviceCase.status === "Resolved" ? "positive" : "accent"}
          >
            {serviceCase.status}
          </Badge>
        }
      >
        {serviceCase.title}
      </SectionTitle>

      <Card>
        <div className="grid divide-y divide-ink-200/70 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <Stat
            label="Priority"
            value={
              <Badge tone={priorityTone(serviceCase.priority)}>
                {serviceCase.priority}
              </Badge>
            }
            sub={serviceCase.queue}
          />
          <Stat
            label="Owner"
            value={serviceCase.owner ?? "Unassigned"}
            tone={serviceCase.owner ? "default" : "negative"}
            sub={`Updated ${formatDateTime(serviceCase.updatedAt)}`}
          />
          <Stat
            label="SLA"
            value={serviceCase.slaDueAt ? sla.label : "Not set"}
            tone={sla.overdue && serviceCase.status === "Open" ? "negative" : "default"}
            sub={
              serviceCase.slaDueAt
                ? `Due ${formatDateTime(serviceCase.slaDueAt)}`
                : "No deadline attached"
            }
          />
          <Stat
            label="Opened"
            value={formatDate(serviceCase.createdAt)}
            sub={
              serviceCase.resolvedAt
                ? `Resolved ${formatDateTime(serviceCase.resolvedAt)}`
                : "Still open"
            }
          />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Case summary"
              description="The reason this work entered the shared operator queue."
            />
            <div className="px-5 py-4">
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-700">
                {serviceCase.summary}
              </p>
            </div>
          </Card>

          {serviceCase.resolution ? (
            <Card className="border-emerald-300/60">
              <CardHeader
                title="Resolution"
                description={
                  serviceCase.resolvedAt
                    ? `Recorded ${formatDateTime(serviceCase.resolvedAt)}`
                    : undefined
                }
                action={<Badge tone="positive">Resolved</Badge>}
              />
              <div className="px-5 py-4">
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-700">
                  {serviceCase.resolution}
                </p>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Origin"
              description="Follow the case back to the workflow and agent evidence that raised it."
            />
            <dl className="divide-y divide-ink-100 text-[13px]">
              <div className="grid gap-1 px-5 py-3 sm:grid-cols-[150px_1fr]">
                <dt className="text-ink-500">Domain record</dt>
                <dd>
                  {domainHref ? (
                    <Link
                      href={domainHref}
                      className="font-medium text-glass-700 hover:text-glass-900"
                    >
                      {sourceLabel(serviceCase.sourceType)}{" "}
                      <span className="font-mono text-[11.5px]">
                        {serviceCase.sourceId}
                      </span>
                    </Link>
                  ) : (
                    <>
                      {sourceLabel(serviceCase.sourceType)}{" "}
                      <span className="font-mono text-[11.5px] text-ink-600">
                        {serviceCase.sourceId}
                      </span>
                    </>
                  )}
                </dd>
              </div>
              <div className="grid gap-1 px-5 py-3 sm:grid-cols-[150px_1fr]">
                <dt className="text-ink-500">Originating agent run</dt>
                <dd>
                  {runHref ? (
                    <Link
                      href={runHref}
                      className="font-medium text-glass-700 hover:text-glass-900"
                    >
                      Open run evidence
                    </Link>
                  ) : (
                    <span className="text-ink-500">No run attached</span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader
            title="Operator actions"
            description={
              canAct
                ? "Assign ownership or change the case state."
                : "Your signed-in role has read-only access."
            }
          />
          {canAct ? (
            <CaseActions
              caseId={serviceCase.id}
              status={serviceCase.status}
              owner={serviceCase.owner}
              defaultOperatorLabel={operatorLabel}
            />
          ) : (
            <div className="px-5 py-6 text-[13px] text-ink-500">
              Ask an operations, pharmacist, plan sponsor, or administrator
              role to update this case.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
