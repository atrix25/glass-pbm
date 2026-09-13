import { prisma } from "@/lib/db";

const DAY_MS = 86_400_000;

export interface RebateInvoiceFact {
  invoiceId: string;
  manufacturer: string;
  quarter: string;
  invoicedCents: number;
  collectedCents: number;
  disputedCents: number;
  actionableCents: number;
  dueAt: Date;
  collectedAt: Date | null;
  daysOverdue: number;
  basis: "overdue" | "collection-variance" | null;
  existingOpenDispute: boolean;
  existingProposal: boolean;
}

/**
 * Reads the invoice as it stood at `at`. Seeded collection dates may be in the
 * future, so their amounts are not treated as received before that date.
 */
export async function getRebateInvoiceFact(
  invoiceId: string,
  at: Date,
): Promise<RebateInvoiceFact | null> {
  const [invoice, existingProposal] = await Promise.all([
    prisma.rebateInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        disputes: {
          where: { status: "Open", resolvedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma.agentProposal.findFirst({
      where: {
        subjectType: "RebateInvoice",
        subjectId: invoiceId,
        action: "open-rebate-dispute",
        status: { in: ["Proposed", "Approved", "Applied"] },
      },
      select: { id: true },
    }),
  ]);
  if (!invoice || invoice.submittedAt > at) return null;

  const collected =
    invoice.collectedAt && invoice.collectedAt <= at
      ? invoice.collectedCents
      : 0;
  const actionableCents = Math.max(
    0,
    invoice.invoicedCents - collected - invoice.disputedCents,
  );
  const daysOverdue =
    invoice.dueAt < at
      ? Math.floor((at.getTime() - invoice.dueAt.getTime()) / DAY_MS)
      : 0;
  const basis =
    actionableCents <= 0
      ? null
      : invoice.collectedAt && invoice.collectedAt <= at
        ? "collection-variance"
        : daysOverdue > 0
          ? "overdue"
          : null;

  return {
    invoiceId: invoice.id,
    manufacturer: invoice.manufacturer,
    quarter: invoice.quarter,
    invoicedCents: invoice.invoicedCents,
    collectedCents: collected,
    disputedCents: invoice.disputedCents,
    actionableCents,
    dueAt: invoice.dueAt,
    collectedAt:
      invoice.collectedAt && invoice.collectedAt <= at
        ? invoice.collectedAt
        : null,
    daysOverdue,
    basis,
    existingOpenDispute: invoice.disputes.length > 0,
    existingProposal: Boolean(existingProposal),
  };
}

/** Submitted invoices with an overdue or collected shortfall as of `at`. */
export async function listRebateCollectionWork(at: Date): Promise<string[]> {
  const rows = await prisma.rebateInvoice.findMany({
    where: { submittedAt: { lte: at } },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      dueAt: true,
      collectedAt: true,
      invoicedCents: true,
      collectedCents: true,
      disputedCents: true,
    },
  });
  return rows
    .filter((row) => {
      const collected =
        row.collectedAt && row.collectedAt <= at ? row.collectedCents : 0;
      const shortfall = row.invoicedCents - collected - row.disputedCents;
      return (
        shortfall > 0 &&
        (row.dueAt < at || Boolean(row.collectedAt && row.collectedAt <= at))
      );
    })
    .map((row) => row.id);
}

export interface ExistingGuaranteeCredit {
  posted: boolean;
  pendingProposal: boolean;
}

export async function getExistingGuaranteeCredit(
  guaranteeId: string,
  period: string,
): Promise<ExistingGuaranteeCredit> {
  const [credit, proposals] = await Promise.all([
    prisma.guaranteeCredit.findFirst({
      where: { guaranteeId, period },
      select: { id: true },
    }),
    prisma.agentProposal.findMany({
      where: {
        agentId: "guarantee-credit",
        action: "post-guarantee-credit",
        status: { in: ["Proposed", "Approved", "Applied"] },
      },
      select: { payload: true },
    }),
  ]);

  // The proposal payload is JSON, so scan the small governed queue rather than
  // pretending a string contains query is a structured equality check.
  const pending = proposals.some((proposal) => {
    try {
      const payload = JSON.parse(proposal.payload) as {
        guaranteeId?: string;
        period?: string;
      };
      return payload.guaranteeId === guaranteeId && payload.period === period;
    } catch {
      return false;
    }
  });

  return { posted: Boolean(credit), pendingProposal: pending };
}

export interface ServiceEscalationSource {
  sourceType: "PriorAuthorization" | "EligibilityTransaction" | "AgentRun";
  sourceId: string;
  title: string;
  summary: string;
  priority: "Normal" | "High" | "Urgent";
  queue: string;
  occurredAt: Date;
  slaDueAt: Date | null;
  evidence: Record<string, unknown>;
}

/**
 * Produces one source key for each unresolved problem. Agent escalations with
 * an underlying PA or eligibility record collapse onto that record's key.
 */
export async function listServiceEscalationWork(
  at: Date,
): Promise<ServiceEscalationSource[]> {
  const [pas, eligibility, escalatedRuns, cases, proposals] = await Promise.all([
    prisma.priorAuthorization.findMany({
      where: {
        receivedAt: { lte: at },
        determination: null,
        OR: [
          { escalated: true },
          {
            status: { in: ["PendingInfo", "InReview"] },
            decisionDueAt: { lt: at },
          },
        ],
      },
      select: {
        id: true,
        paNumber: true,
        status: true,
        urgency: true,
        receivedAt: true,
        decisionDueAt: true,
        drug: { select: { name: true } },
      },
      orderBy: { receivedAt: "asc" },
    }),
    prisma.eligibilityTransaction.findMany({
      where: {
        status: "Rejected",
        resolvedAt: null,
        file: { receivedAt: { lte: at } },
      },
      select: {
        id: true,
        memberName: true,
        rejectCode: true,
        rejectReason: true,
        file: { select: { receivedAt: true } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.agentRun.findMany({
      where: {
        outcome: "Escalated",
        startedAt: { lte: at },
        agentId: { not: "service-escalation-triage" },
      },
      select: {
        id: true,
        agentId: true,
        summary: true,
        goal: true,
        startedAt: true,
        subjectType: true,
        subjectId: true,
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.serviceCase.findMany({
      where: { status: { not: "Resolved" } },
      select: { sourceType: true, sourceId: true },
    }),
    prisma.agentProposal.findMany({
      where: {
        action: "open-service-case",
        status: { in: ["Proposed", "Approved", "Applied"] },
      },
      select: { subjectType: true, subjectId: true },
    }),
  ]);

  const occupied = new Set([
    ...cases.map((row) => `${row.sourceType}:${row.sourceId}`),
    ...proposals.map((row) => `${row.subjectType}:${row.subjectId}`),
  ]);
  const work = new Map<string, ServiceEscalationSource>();

  for (const pa of pas) {
    const key = `PriorAuthorization:${pa.id}`;
    if (occupied.has(key)) continue;
    work.set(key, {
      sourceType: "PriorAuthorization",
      sourceId: pa.id,
      title: `Unresolved prior authorisation ${pa.paNumber}`,
      summary: `${pa.urgency} request for ${pa.drug.name} remains ${pa.status.toLowerCase()} without a determination.`,
      priority: pa.urgency === "Expedited" ? "Urgent" : "High",
      queue: "Clinical operations",
      occurredAt: pa.receivedAt,
      slaDueAt: pa.decisionDueAt,
      evidence: {
        paNumber: pa.paNumber,
        status: pa.status,
        urgency: pa.urgency,
        decisionDueAt: pa.decisionDueAt,
      },
    });
  }

  for (const tx of eligibility) {
    const key = `EligibilityTransaction:${tx.id}`;
    if (occupied.has(key)) continue;
    work.set(key, {
      sourceType: "EligibilityTransaction",
      sourceId: tx.id,
      title: `Unresolved eligibility reject ${tx.rejectCode ?? tx.id}`,
      summary: `${tx.memberName}: ${tx.rejectReason ?? "rejected eligibility instruction"}`,
      priority: "High",
      queue: "Eligibility operations",
      occurredAt: tx.file.receivedAt,
      slaDueAt: null,
      evidence: {
        transactionId: tx.id,
        rejectCode: tx.rejectCode,
        rejectReason: tx.rejectReason,
      },
    });
  }

  for (const escalated of escalatedRuns) {
    const normalized =
      escalated.subjectId &&
      (escalated.subjectType === "PriorAuthorization" ||
        escalated.subjectType === "EligibilityTransaction")
        ? {
            type: escalated.subjectType,
            id: escalated.subjectId,
          }
        : { type: "AgentRun", id: escalated.id };
    const key = `${normalized.type}:${normalized.id}`;
    if (occupied.has(key) || work.has(key)) continue;
    work.set(key, {
      sourceType: normalized.type as ServiceEscalationSource["sourceType"],
      sourceId: normalized.id,
      title: `${escalated.agentId} escalation`,
      summary: escalated.summary,
      priority: "High",
      queue: "Agent operations",
      occurredAt: escalated.startedAt,
      slaDueAt: null,
      evidence: {
        agentRunId: escalated.id,
        agentId: escalated.agentId,
        goal: escalated.goal,
        summary: escalated.summary,
      },
    });
  }

  return [...work.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
}

export async function getServiceEscalationSource(
  sourceType: ServiceEscalationSource["sourceType"],
  sourceId: string,
  at: Date,
): Promise<ServiceEscalationSource | null> {
  const work = await listServiceEscalationWork(at);
  return (
    work.find(
      (source) =>
        source.sourceType === sourceType && source.sourceId === sourceId,
    ) ?? null
  );
}
