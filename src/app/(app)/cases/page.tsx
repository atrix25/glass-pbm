import Link from "next/link";
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
import { prisma } from "@/lib/db";
import { getClock } from "@/lib/session";
import { formatDate, formatNumber } from "@/lib/utils";
import {
  formatSla,
  priorityRank,
  priorityTone,
  sourceLabel,
} from "./case-display";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const [{ now }, cases] = await Promise.all([
    getClock(),
    prisma.serviceCase.findMany(),
  ]);
  const openCases = cases
    .filter((serviceCase) => serviceCase.status === "Open")
    .sort((left, right) => {
      const priorityDifference =
        priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDifference !== 0) return priorityDifference;
      if (left.slaDueAt && right.slaDueAt) {
        const deadlineDifference =
          left.slaDueAt.getTime() - right.slaDueAt.getTime();
        if (deadlineDifference !== 0) return deadlineDifference;
      }
      if (left.slaDueAt) return -1;
      if (right.slaDueAt) return 1;
      return left.createdAt.getTime() - right.createdAt.getTime();
    });
  const overdue = openCases.filter(
    (serviceCase) =>
      serviceCase.slaDueAt && serviceCase.slaDueAt.getTime() < now.getTime(),
  ).length;
  const urgent = openCases.filter(
    (serviceCase) =>
      serviceCase.priority === "Urgent" || serviceCase.priority === "High",
  ).length;
  const unassigned = openCases.filter((serviceCase) => !serviceCase.owner).length;
  const resolved = cases.length - openCases.length;

  return (
    <div className="space-y-5">
      <SectionTitle description="One operator queue for unresolved work raised by clinical, eligibility, network, finance, and agent workflows. Open work is ordered by priority, then nearest SLA deadline.">
        Service cases
      </SectionTitle>

      <Card>
        <div className="grid divide-y divide-ink-200/70 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <Stat
            label="Open"
            value={formatNumber(openCases.length)}
            tone="accent"
            sub={`${formatNumber(resolved)} resolved overall`}
          />
          <Stat
            label="Past SLA"
            value={formatNumber(overdue)}
            tone={overdue > 0 ? "negative" : "positive"}
            sub={overdue > 0 ? "Needs immediate attention" : "Every deadline is in bounds"}
          />
          <Stat
            label="High priority"
            value={formatNumber(urgent)}
            tone={urgent > 0 ? "negative" : "default"}
            sub="Urgent and high cases"
          />
          <Stat
            label="Unassigned"
            value={formatNumber(unassigned)}
            tone={unassigned > 0 ? "negative" : "positive"}
            sub={unassigned > 0 ? "Waiting for an owner" : "Every open case has an owner"}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Open work"
          description={`Priority and SLA order as of ${formatDate(now)}.`}
          action={<Badge tone="accent">{openCases.length} open</Badge>}
        />
        {openCases.length === 0 ? (
          <EmptyState
            title="No open service cases"
            description="Escalations will appear here when agent proposals open a case."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Case</Th>
                <Th>Priority</Th>
                <Th>Queue</Th>
                <Th>Owner</Th>
                <Th>SLA</Th>
                <Th align="right">Opened</Th>
              </tr>
            </thead>
            <tbody>
              {openCases.map((serviceCase) => {
                const sla = formatSla(serviceCase.slaDueAt, now);
                return (
                  <tr
                    key={serviceCase.id}
                    className="transition hover:bg-ink-50/70"
                  >
                    <Td className="max-w-[340px]">
                      <Link
                        href={`/cases/${serviceCase.id}`}
                        className="tnum font-semibold text-ink-900 hover:text-glass-700"
                      >
                        {serviceCase.caseNumber}
                      </Link>
                      <div className="mt-0.5 truncate font-medium text-ink-800">
                        {serviceCase.title}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-ink-500">
                        {sourceLabel(serviceCase.sourceType)}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={priorityTone(serviceCase.priority)}>
                        {serviceCase.priority}
                      </Badge>
                    </Td>
                    <Td>{serviceCase.queue}</Td>
                    <Td>
                      {serviceCase.owner ?? (
                        <span className="text-rose-700">Unassigned</span>
                      )}
                    </Td>
                    <Td>
                      <span
                        className={
                          sla.overdue
                            ? "font-medium text-rose-700"
                            : "text-ink-700"
                        }
                      >
                        {sla.label}
                      </span>
                      {serviceCase.slaDueAt ? (
                        <div className="mt-0.5 text-[11.5px] text-ink-500">
                          {formatDate(serviceCase.slaDueAt)}
                        </div>
                      ) : null}
                    </Td>
                    <Td align="right" className="whitespace-nowrap text-ink-500">
                      {formatDate(serviceCase.createdAt)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
