import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { CRITERIA_TREES } from "@/lib/pa/criteria";
import type { PADetermination } from "@/lib/pa/engine";
import { buildEpaExchange, type EpaExchange } from "@/lib/pa/epa";

/**
 * The queue as of the clock.
 *
 * A request that has not arrived yet is not in the queue, and a determination
 * that has not been made yet is not a determination. Both are decided by
 * comparing stored timestamps against the current instant rather than by
 * reading a status column, so the queue moves as the clock does.
 */
export async function listPriorAuths(
  clock: SimulationClock,
  filter?: {
    status?: string;
    urgency?: string;
  },
) {
  const arrived = { receivedAt: { lte: clock.now } };
  const scope =
    filter?.status === "InFlight"
      ? {
          ...arrived,
          OR: [{ decidedAt: null }, { decidedAt: { gt: clock.now } }],
        }
      : filter?.status
        ? {
            ...arrived,
            determination: filter.status,
            decidedAt: { lte: clock.now },
          }
        : arrived;

  return prisma.priorAuthorization.findMany({
    where: {
      ...scope,
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

export async function getPriorAuthQueueStats(clock: SimulationClock) {
  const decided = { decidedAt: { lte: clock.now } };

  const [rows, open, cited] = await Promise.all([
    prisma.priorAuthorization.groupBy({
      by: ["determination", "decidedBy", "urgency"],
      where: decided,
      _count: { _all: true },
    }),
    prisma.priorAuthorization.count({
      where: {
        receivedAt: { lte: clock.now },
        OR: [{ decidedAt: null }, { decidedAt: { gt: clock.now } }],
      },
    }),
    prisma.priorAuthorization.count({
      where: { ...decided, treeId: { not: null } },
    }),
  ]);

  let approved = 0;
  let denied = 0;
  let byAi = 0;
  let byHuman = 0;
  let expedited = 0;
  for (const r of rows) {
    const n = r._count._all;
    if (r.determination === "Approved") approved += n;
    else if (r.determination === "Denied") denied += n;
    if (r.decidedBy === "AI") byAi += n;
    else if (r.decidedBy) byHuman += n;
    if (r.urgency === "Expedited") expedited += n;
  }

  const total = approved + denied;
  return {
    /** Determinations released so far this plan year. */
    total,
    approved,
    denied,
    /** Requests open at this instant. */
    pending: open,
    byAi,
    byHuman,
    expedited,
    /** Decided by walking a transcribed criteria form, so citable to a step. */
    cited,
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

/**
 * The four-transaction ePA conversation for a stored request.
 *
 * Assembled from what is on record rather than re-run: the questionnaire comes
 * from the criteria tree, and the determination comes from the traversal that was
 * actually stored at the time. Re-deriving it would show what the plan would
 * answer today against a possibly-revised tree, which is a different and less
 * useful claim than what it did answer.
 */
export async function getEpaExchange(id: string): Promise<EpaExchange | null> {
  const detail = await getPriorAuthDetail(id);
  if (!detail?.pa.treeId) return null;

  const { pa, path } = detail;
  const tree = CRITERIA_TREES.find((t) => t.id === pa.treeId);
  if (!tree) return null;

  const answers = JSON.parse(pa.questionResponses || "{}") as Record<
    string,
    unknown
  >;

  const walked = path
    .filter((s) => s.visited)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const determination: PADetermination = {
    outcome:
      pa.determination === "Approved"
        ? "Approved"
        : pa.determination === "Denied"
          ? "Denied"
          : "Escalated",
    decidingStep: pa.decidingStepNumber ?? undefined,
    approvedDays: pa.approvedDays ?? undefined,
    reason: pa.denyReason ?? undefined,
    treeId: tree.id,
    path: walked.map((s) => ({
      step: s.stepNumber,
      question: s.question,
      answer: Boolean(s.answer),
      evidence: s.evidence ?? "",
      citation: s.citation ?? "",
      next:
        s.stepNumber === pa.decidingStepNumber
          ? pa.determination === "Approved"
            ? "approve"
            : "deny"
          : "step",
      nextStep: s.answer ? (s.yes.step ?? undefined) : (s.no.step ?? undefined),
    })),
  };

  return buildEpaExchange({
    tree,
    facts: {
      answers,
      condition: answers.condition as string | undefined,
      prescriberSpecialty: undefined,
      memberDiagnosisCodes: JSON.parse(pa.member.diagnosisCodes || "[]") as string[],
      filledDrugNames: [],
    },
    determination,
    drugName: pa.drug.name,
    memberLabel: `${pa.member.firstName} ${pa.member.lastName}`,
    prescriberName: pa.prescriberName,
    prescriberNpi: pa.prescriberNpi,
    requestedQuantity: pa.requestedQuantity,
    requestedDaysSupply: pa.requestedDaysSupply,
    urgency: pa.urgency === "Expedited" ? "Expedited" : "Standard",
    requestId: pa.paNumber,
  });
}

// ---------------------------------------------------------------------------
// The reviewer's queue
// ---------------------------------------------------------------------------

export type ReviewBucket = "signature" | "unresolved" | "noCriteria";

export interface ReviewItem {
  id: string;
  paNumber: string;
  memberId: string;
  memberName: string;
  drugName: string;
  isSpecialty: boolean;
  treeName: string | null;
  treeId: string | null;
  requestType: string;
  urgency: "Standard" | "Expedited";
  prescriberName: string | null;
  receivedAt: Date;
  decisionDueAt: Date | null;
  prescriberStatementAt: Date | null;
  bucket: ReviewBucket;
  /**
   * What automation is recommending, where it walked a form and reached a deny
   * edge. Held rather than recorded: this is the whole reason the console exists.
   */
  proposed: {
    determination: "Denied";
    reason: string | null;
    decidingStep: number | null;
    question: string | null;
    citation: string | null;
  } | null;
  /** The traversal so far, so the reviewer reads the reasoning, not a verdict. */
  walked: Array<{
    step: number;
    question: string;
    answer: boolean;
    evidence: string | null;
    citation: string | null;
  }>;
}

/**
 * What is waiting on a pharmacist right now.
 *
 * Three different things arrive in one queue and they are not interchangeable,
 * so they come back separated:
 *
 *   - a traversal that reached a deny edge, which is a recommendation waiting
 *     for a signature and the only kind of work where automation has already
 *     formed a view;
 *   - a traversal that could not resolve on the facts submitted, where the
 *     engine has deliberately stopped rather than guessed;
 *   - a product with no transcribed criteria form at all, where there is no
 *     tree to walk and the reviewer works from the plan document.
 *
 * Lumping them together would hide the number that matters, which is how much
 * of the queue automation could not finish and why.
 */
export async function getReviewQueue(clock: SimulationClock) {
  const inFlight = {
    receivedAt: { lte: clock.now },
    OR: [{ decidedAt: null }, { decidedAt: { gt: clock.now } }],
  };

  const rows = await prisma.priorAuthorization.findMany({
    where: inFlight,
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      drug: { select: { name: true, isSpecialty: true } },
      tree: { select: { id: true, name: true } },
      decisionSteps: {
        include: { criteriaStep: true },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: [{ urgency: "desc" }, { decisionDueAt: "asc" }],
    take: 120,
  });

  const items: ReviewItem[] = rows.map((r) => {
    const walked = r.decisionSteps.map((d) => ({
      step: d.criteriaStep.stepNumber,
      question: d.criteriaStep.question,
      answer: d.answer,
      evidence: d.evidence,
      citation: d.criteriaStep.citation,
    }));

    /*
     * A stored refusal on a request that has not been answered yet is exactly
     * what a proposal is. The row records where the traversal came out; the
     * signature is a separate act, and until the decision time passes it has
     * not happened.
     */
    const proposesRefusal = r.treeId !== null && r.determination === "Denied";
    const deciding = r.decidingStepNumber
      ? walked.find((w) => w.step === r.decidingStepNumber)
      : undefined;

    const bucket: ReviewBucket = proposesRefusal
      ? "signature"
      : r.treeId === null
        ? "noCriteria"
        : "unresolved";

    return {
      id: r.id,
      paNumber: r.paNumber,
      memberId: r.member.id,
      memberName: `${r.member.firstName} ${r.member.lastName}`,
      drugName: r.drug.name,
      isSpecialty: r.drug.isSpecialty,
      treeName: r.tree?.name ?? null,
      treeId: r.treeId,
      requestType: r.requestType,
      urgency: r.urgency === "Expedited" ? "Expedited" : "Standard",
      prescriberName: r.prescriberName,
      receivedAt: r.receivedAt,
      decisionDueAt: r.decisionDueAt,
      prescriberStatementAt: r.prescriberStatementAt,
      bucket,
      proposed: proposesRefusal
        ? {
            determination: "Denied",
            reason: r.denyReason,
            decidingStep: r.decidingStepNumber,
            question: deciding?.question ?? null,
            citation: deciding?.citation ?? null,
          }
        : null,
      walked,
    };
  });

  /*
   * What automation finished on its own today, which is the other half of the
   * claim. A console that only shows what needed a human says nothing about
   * how much did not, and the ratio is the number a reviewer is entitled to
   * spot-check.
   */
  const dayStart = new Date(clock.now.getTime() - 24 * 3_600_000);
  const [recordedByAutomation, deniedToday, everDeniedByAutomation] =
    await Promise.all([
      prisma.priorAuthorization.count({
        where: {
          decidedAt: { gt: dayStart, lte: clock.now },
          decidedBy: "AI",
          determination: "Approved",
        },
      }),
      prisma.priorAuthorization.count({
        where: {
          decidedAt: { gt: dayStart, lte: clock.now },
          determination: "Denied",
        },
      }),
      prisma.priorAuthorization.count({
        where: { decidedBy: "AI", determination: "Denied" },
      }),
    ]);

  return {
    items,
    signature: items.filter((i) => i.bucket === "signature"),
    unresolved: items.filter((i) => i.bucket === "unresolved"),
    noCriteria: items.filter((i) => i.bucket === "noCriteria"),
    recordedByAutomation,
    deniedToday,
    /** Should be zero, and the console says so out loud rather than assuming it. */
    everDeniedByAutomation,
  };
}

/** A named reviewer, so a signature has somebody behind it. */
export const ON_DUTY_PHARMACIST = {
  label: "Rachel Imhoff, PharmD",
  licence: "WI-RPH-041882",
};

/**
 * What a member could actually file today.
 *
 * An appeal has to name a refusal, so the choices are refusals that have
 * already been released as of the clock. An exception names a drug and a member
 * and needs neither, so those come from requests on file for the same member,
 * which is how a real filing arrives: attached to something that already
 * happened rather than typed into an empty form.
 */
export async function getIntakeOptions(clock: SimulationClock) {
  const denied = await prisma.priorAuthorization.findMany({
    where: {
      determination: "Denied",
      decidedAt: { lte: clock.now, not: null },
    },
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      drug: { select: { id: true, name: true } },
    },
    orderBy: { decidedAt: "desc" },
    take: 25,
  });

  return denied.map((d) => ({
    paId: d.id,
    paNumber: d.paNumber,
    memberId: d.member.id,
    memberName: `${d.member.firstName} ${d.member.lastName}`,
    drugId: d.drug.id,
    drugName: d.drug.name,
    decidedBy: d.decidedBy,
    denyReason: d.denyReason,
    decidingStep: d.decidingStepNumber,
  }));
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
