import { prisma } from "@/lib/db";

export async function listPriorAuths(filter?: {
  status?: string;
  urgency?: string;
}) {
  return prisma.priorAuthorization.findMany({
    where: {
      ...(filter?.status ? { determination: filter.status } : {}),
      ...(filter?.urgency ? { urgency: filter.urgency } : {}),
    },
    include: {
      member: { select: { firstName: true, lastName: true, id: true } },
      drug: { select: { name: true, isSpecialty: true } },
      tree: { select: { name: true } },
      _count: { select: { decisionSteps: true } },
    },
    orderBy: [{ receivedAt: "desc" }],
    take: 200,
  });
}

export async function getPriorAuthQueueStats() {
  const rows = await prisma.priorAuthorization.groupBy({
    by: ["determination", "decidedBy", "urgency"],
    _count: { _all: true },
  });

  let approved = 0;
  let denied = 0;
  let pending = 0;
  let byAi = 0;
  let byHuman = 0;
  let expedited = 0;
  for (const r of rows) {
    const n = r._count._all;
    if (r.determination === "Approved") approved += n;
    else if (r.determination === "Denied") denied += n;
    else pending += n;
    if (r.decidedBy === "AI") byAi += n;
    else if (r.decidedBy) byHuman += n;
    if (r.urgency === "Expedited") expedited += n;
  }

  const escalated = await prisma.priorAuthorization.count({
    where: { escalated: true },
  });

  return {
    total: approved + denied + pending,
    approved,
    denied,
    pending,
    byAi,
    byHuman,
    expedited,
    escalated,
  };
}

/**
 * One PA with the path the criteria engine actually walked, joined against
 * every step in the tree so the page can show the questions that were never
 * reached alongside the ones that were.
 */
export async function getPriorAuthDetail(id: string) {
  const pa = await prisma.priorAuthorization.findFirst({
    where: { OR: [{ id }, { paNumber: id }] },
    include: {
      member: true,
      drug: true,
      tree: {
        include: {
          steps: { orderBy: { stepNumber: "asc" } },
          sourceDocument: true,
        },
      },
      decisionSteps: {
        include: { criteriaStep: true },
        orderBy: { seq: "asc" },
      },
    },
  });
  if (!pa) return null;

  const walked = new Map(
    pa.decisionSteps.map((d) => [d.criteriaStep.stepNumber, d]),
  );

  const path = (pa.tree?.steps ?? []).map((step) => {
    const taken = walked.get(step.stepNumber);
    return {
      stepNumber: step.stepNumber,
      question: step.question,
      predicate: step.predicate,
      predicateArgs: JSON.parse(step.predicateArgs) as Record<string, unknown>,
      citation: step.citation,
      yes: {
        outcome: step.yesOutcome,
        step: step.yesStep,
        days: step.yesApprovalDays,
      },
      no: {
        outcome: step.noOutcome,
        step: step.noStep,
        days: step.noApprovalDays,
        reason: step.denyReason,
      },
      visited: Boolean(taken),
      seq: taken?.seq ?? null,
      answer: taken?.answer ?? null,
      evidence: taken?.evidence ?? null,
    };
  });

  return { pa, path };
}

/** Claims that this authorization let through, so the PA ties to money. */
export async function getPaClaims(memberId: string, drugId: string) {
  return prisma.claim.findMany({
    where: { memberId, drugId },
    select: {
      id: true,
      claimNumber: true,
      dateOfService: true,
      responseStatus: true,
      rejectMessage: true,
      totalBilledCents: true,
      patientPayCents: true,
      planPaidCents: true,
    },
    orderBy: { dateOfService: "asc" },
  });
}
