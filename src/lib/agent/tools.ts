/**
 * The tools the member service agent is allowed to use.
 *
 * The agent has no direct access to the database and no ability to compute a
 * dollar figure on its own. Every number it says out loud comes back from one
 * of these functions, and every one of them returns its citations alongside
 * its data. That is the whole design: the language model chooses which
 * question to ask, and the rules engine answers it.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { adjudicate } from "@/lib/engine/adjudicate";
import { loadWorld } from "@/lib/engine/replay";
import { getSource } from "@/lib/sources";
import { formatCents } from "@/lib/money";
import { CRITERIA_TREES, findTreeForDrug } from "@/lib/pa/criteria";
import { REJECT_MEMBER_EXPLANATION } from "@/lib/engine/types";
import {
  describeLevelCostShare,
  prescriptionLimitLabel,
  type PlanCostShareContext,
} from "@/lib/agent/cost-share-copy";

export interface Citation {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  locator?: string;
}

export interface ToolResult<T = unknown> {
  data: T;
  citations: Citation[];
  /** One sentence the agent can use verbatim if it has nothing to add. */
  summary: string;
}

function cite(sourceId: string, locator?: string): Citation {
  const s = getSource(sourceId);
  return {
    sourceId: s.id,
    title: s.title,
    publisher: s.publisher,
    url: s.url,
    locator,
  };
}

// ---------------------------------------------------------------------------

/**
 * NADAC descriptions carry parenthetical qualifiers that survive truncation,
 * so the file contains names like "OZEMPIC INJ )". Read to a member, a stray
 * bracket looks like the system is broken.
 */
export function tidyName(name: string): string {
  return name
    .replace(/\s*\([^)]*$/, "")
    .replace(/\s*\)+\s*$/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function routeOf(name: string): string {
  if (/\bINJ|PEN\b|SYRINGE|AUTOINJ|VIAL/i.test(name)) return "injectable";
  if (/\bOINT|CREAM|GEL\b|LOTION|TOPICAL|OPHTH|DROPS|PATCH/i.test(name))
    return "topical";
  if (/\bINHAL|AERO|NEB\b|ELLIPTA|RESPICLICK/i.test(name)) return "inhaled";
  return "oral";
}

async function resolveDrug(nameOrNdc: string) {
  const q = nameOrNdc.trim();
  const byNdc = /^\d{9,11}$/.test(q)
    ? await prisma.drug.findFirst({ where: { ndc11: q.padStart(11, "0") } })
    : null;
  if (byNdc) return byNdc;

  // Prefer an exact-ish prefix match, then fall back to a contains search.
  const prefix = await prisma.drug.findFirst({
    where: { name: { startsWith: q } },
    orderBy: { name: "asc" },
  });
  if (prefix) return prefix;
  return prisma.drug.findFirst({
    where: { name: { contains: q } },
    orderBy: { name: "asc" },
  });
}

// ---------------------------------------------------------------------------
// 1. Member profile
// ---------------------------------------------------------------------------

export const getMemberProfileSchema = z.object({
  memberId: z.string().describe("The member's internal id"),
});

export async function getMemberProfile(
  args: z.infer<typeof getMemberProfileSchema>,
): Promise<ToolResult> {
  const m = await prisma.member.findUnique({
    where: { id: args.memberId },
    include: {
      eligibilitySpans: { include: { benefitPlan: true } },
      sponsor: true,
    },
  });
  if (!m) {
    return { data: { found: false }, citations: [], summary: "No such member." };
  }
  const span = m.eligibilitySpans[0];
  const plan = span?.benefitPlan;
  return {
    data: {
      name: `${m.firstName} ${m.lastName}`,
      memberId: `${m.cardholderId}-${m.personCode}`,
      dateOfBirth: m.dateOfBirth.toISOString().slice(0, 10),
      plan: plan?.name,
      planYear: plan?.planYear,
      coverageEffective: span?.effectiveDate.toISOString().slice(0, 10),
      coverageTier: span?.coverageTier,
      sponsor: m.sponsor.name,
      diagnosisCodesOnFile: JSON.parse(m.diagnosisCodes),
      prescriptionOutOfPocketLimit: plan
        ? formatCents(plan.rxOopLimitIndividual)
        : null,
      federalOutOfPocketLimit: plan
        ? formatCents(plan.federalOopLimitIndividual)
        : null,
      levelsThatCountTowardPrescriptionLimit: ["1", "2"],
    },
    citations: [cite("etf-uniform-pharmacy-coc-2026")],
    summary: `${m.firstName} ${m.lastName} is covered under the ${plan?.name} for ${plan?.planYear}.`,
  };
}

// ---------------------------------------------------------------------------
// 2. Accumulators
// ---------------------------------------------------------------------------

export const getAccumulatorsSchema = z.object({
  memberId: z.string(),
});

export async function getAccumulators(
  args: z.infer<typeof getAccumulatorsSchema>,
): Promise<ToolResult> {
  const claims = await prisma.claim.findMany({
    where: { memberId: args.memberId, responseStatus: "P" },
    select: { patientPayCents: true, formularyLevel: true },
  });
  const span = await prisma.eligibilitySpan.findFirst({
    where: { memberId: args.memberId },
    include: { benefitPlan: true },
  });
  const plan = span?.benefitPlan;

  const total = claims.reduce((s, c) => s + c.patientPayCents, 0);
  const counted = claims
    .filter((c) => ["1", "2"].includes(c.formularyLevel ?? ""))
    .reduce((s, c) => s + c.patientPayCents, 0);
  // Preventive fills sit outside Level 1 and 2 but cost the member nothing, so
  // they contribute no non-qualifying spend and should not be named as a cause.
  const notCounted = total - counted;
  const limit = plan?.rxOopLimitIndividual ?? 60000;

  return {
    data: {
      totalPaidThisYear: formatCents(total),
      appliedToPrescriptionLimit: formatCents(Math.min(counted, limit)),
      prescriptionLimit: formatCents(limit),
      prescriptionLimitRemaining: formatCents(Math.max(0, limit - counted)),
      prescriptionLimitReached: counted >= limit,
      paidOnLevel3And4ThatDoesNotCount: formatCents(notCounted),
      federalLimit: formatCents(plan?.federalOopLimitIndividual ?? 1060000),
      federalApplied: formatCents(total),
    },
    citations: [
      cite(
        "etf-uniform-pharmacy-coc-2026",
        "Level 1 and 2 out-of-pocket limit, $600 individual and $1,200 family. Level 3 and 4 cost share applies only to the federal maximum out-of-pocket limit.",
      ),
    ],
    summary:
      counted >= limit
        ? `This member has reached the ${formatCents(limit)} prescription out-of-pocket limit. ${formatCents(notCounted)} of what they paid came from Level 3 and 4 fills, which never counted toward it.`
        : `${formatCents(Math.max(0, limit - counted))} remains before the ${formatCents(limit)} prescription out-of-pocket limit.`,
  };
}

// ---------------------------------------------------------------------------
// 3. Claims
// ---------------------------------------------------------------------------

export const getClaimsSchema = z.object({
  memberId: z.string(),
  drugName: z.string().optional().describe("Filter to one drug"),
  onlyRejected: z.boolean().optional(),
  limit: z.number().optional(),
});

export async function getClaims(
  args: z.infer<typeof getClaimsSchema>,
): Promise<ToolResult> {
  const claims = await prisma.claim.findMany({
    where: {
      memberId: args.memberId,
      ...(args.onlyRejected ? { responseStatus: "R" } : {}),
      ...(args.drugName
        ? { drug: { name: { contains: args.drugName } } }
        : {}),
    },
    include: { drug: true, pharmacy: true },
    orderBy: { dateOfService: "desc" },
    take: args.limit ?? 10,
  });

  return {
    data: claims.map((c) => ({
      claimId: c.id,
      claimNumber: c.claimNumber,
      date: c.dateOfService.toISOString().slice(0, 10),
      drug: tidyName(c.drug.name),
      pharmacy: c.pharmacy.name,
      status: c.responseStatus === "P" ? "paid" : "rejected",
      rejectReason: c.rejectMessage,
      memberPaid: formatCents(c.patientPayCents),
      planPaid: formatCents(c.planPaidCents),
      totalCost: formatCents(c.totalBilledCents),
      benefitLevel: c.formularyLevel,
      daysSupply: c.daysSupply,
      countsTowardPrescriptionLimit: ["1", "2"].includes(c.formularyLevel ?? ""),
    })),
    citations: [],
    summary: `${claims.length} claims found.`,
  };
}

// ---------------------------------------------------------------------------
// 4. Explain one claim
// ---------------------------------------------------------------------------

export const explainClaimSchema = z.object({
  claimId: z.string().describe("Claim id or claim number"),
});

export async function explainClaim(
  args: z.infer<typeof explainClaimSchema>,
): Promise<ToolResult> {
  const c = await prisma.claim.findFirst({
    where: { OR: [{ id: args.claimId }, { claimNumber: args.claimId }] },
    include: { drug: true, pharmacy: true },
  });
  if (!c) {
    return { data: { found: false }, citations: [], summary: "No such claim." };
  }
  const trace = c.traceJson
    ? (JSON.parse(c.traceJson) as {
        ruleId: string;
        stage: string;
        detail?: string;
        fired: boolean;
        sourceDocumentId?: string;
        citation?: string;
      }[])
    : [];
  const fired = trace.filter((t) => t.fired);
  const citations = Array.from(
    new Map(
      fired
        .filter((t) => t.sourceDocumentId)
        .map((t) => [t.sourceDocumentId!, cite(t.sourceDocumentId!, t.citation)]),
    ).values(),
  );

  return {
    data: {
      claimNumber: c.claimNumber,
      claimId: c.id,
      date: c.dateOfService.toISOString().slice(0, 10),
      drug: tidyName(c.drug.name),
      pharmacy: c.pharmacy.name,
      status: c.responseStatus === "P" ? "paid" : "rejected",
      rejectReason: c.rejectMessage,
      benefitLevel: c.formularyLevel,
      totalCost: formatCents(c.totalBilledCents),
      planPaid: formatCents(c.planPaidCents),
      memberPaid: formatCents(c.patientPayCents),
      brandPenalty: c.brandSelectionPenaltyCents
        ? formatCents(c.brandSelectionPenaltyCents)
        : null,
      pharmacyAcquisitionCost: c.nadacTotalCents
        ? formatCents(c.nadacTotalCents)
        : null,
      steps: fired.map((t) => ({ rule: t.ruleId, explanation: t.detail })),
      proofUrl: `/claims/${c.id}`,
    },
    citations,
    summary:
      c.responseStatus === "P"
        ? `Claim ${c.claimNumber} paid. The member owed ${formatCents(c.patientPayCents)} of a ${formatCents(c.totalBilledCents)} fill.`
        : `Claim ${c.claimNumber} rejected: ${c.rejectMessage}.`,
  };
}

// ---------------------------------------------------------------------------
// 5. Coverage check
// ---------------------------------------------------------------------------

export const checkCoverageSchema = z.object({
  drugName: z.string(),
  memberId: z.string().optional(),
});

async function planCostShareContext(
  memberId: string | undefined,
): Promise<PlanCostShareContext | null> {
  if (!memberId) return null;
  const span = await prisma.eligibilitySpan.findFirst({
    where: { memberId },
    include: { benefitPlan: true },
  });
  const plan = span?.benefitPlan;
  if (!plan) return null;
  return {
    deductibleIndividualCents: plan.deductibleIndividual,
    rxOopLimitIndividualCents: plan.rxOopLimitIndividual,
  };
}

export async function checkCoverage(
  args: z.infer<typeof checkCoverageSchema>,
): Promise<ToolResult> {
  const drug = await resolveDrug(args.drugName);
  if (!drug) {
    return {
      data: { found: false, searched: args.drugName },
      citations: [cite("navitus-etf-formulary-2026")],
      summary: `No product matching "${args.drugName}" is listed on this plan's formulary.`,
    };
  }
  const entry = await prisma.formularyEntry.findFirst({
    where: { drugId: drug.id, formularyId: "navitus-etf-2026" },
  });
  if (!entry) {
    return {
      data: { drug: tidyName(drug.name), onFormulary: false },
      citations: [cite("navitus-etf-formulary-2026")],
      summary: `${tidyName(drug.name)} is not on the plan formulary.`,
    };
  }

  const plan = await planCostShareContext(args.memberId);
  const costShare = describeLevelCostShare(entry.level, plan);
  const prescriptionOutOfPocketLimit = prescriptionLimitLabel(plan);

  return {
    data: {
      drug: tidyName(drug.name),
      ndc: drug.ndc11,
      onFormulary: !entry.notCovered && !entry.planExclusion,
      benefitLevel: entry.level,
      costShare,
      prescriptionOutOfPocketLimit,
      countsTowardPrescriptionLimit: ["1", "2"].includes(entry.level),
      priorAuthorizationRequired: entry.requiresPA,
      stepTherapyRequired: entry.requiresStep,
      quantityLimit: entry.hasQuantityLimit ? entry.qlRawText : null,
      diagnosisRestriction: entry.diagnosisRestricted
        ? entry.diagnosisRawText
        : null,
      specialtyPharmacyRequired: entry.level === "4" || entry.mandatorySpecialty,
      planExclusion: entry.planExclusion,
      specialCode: entry.specialCode,
    },
    citations: [
      cite(
        "navitus-etf-formulary-2026",
        `${tidyName(drug.name)} listed at Level ${entry.level}${entry.specialCode ? ` with special code ${entry.specialCode}` : ""}`,
      ),
      cite("etf-uniform-pharmacy-coc-2026", `Level ${entry.level} cost share`),
    ],
    summary: entry.planExclusion
      ? `${tidyName(drug.name)} is excluded from the pharmacy benefit entirely.`
      : `${tidyName(drug.name)} is a Level ${entry.level} drug: ${costShare}.${entry.requiresPA ? " It requires prior authorization." : ""}`,
  };
}

// ---------------------------------------------------------------------------
// 6. Price a hypothetical fill through the real engine
// ---------------------------------------------------------------------------

/**
 * How much of this product a fill of this length actually contains.
 *
 * Prefer what the plan has really dispensed. Failing that, use the plan's own
 * quantity limit, which is the largest fill it will cover and therefore the
 * right thing to quote. One unit per day is the last resort and is only
 * correct for oral solids.
 */
async function typicalQuantity(
  drugId: string,
  daysSupply: number,
): Promise<number | null> {
  const rows = await prisma.claim.findMany({
    where: { drugId, responseStatus: "P" },
    select: { quantityDispensed: true, daysSupply: true },
    take: 50,
  });
  const perDay = rows
    .filter((r) => r.daysSupply > 0)
    .map((r) => r.quantityDispensed / r.daysSupply)
    .sort((a, b) => a - b);
  if (perDay.length > 0) {
    const median = perDay[Math.floor(perDay.length / 2)];
    return Math.max(0.01, Math.round(median * daysSupply * 100) / 100);
  }

  const entry = await prisma.formularyEntry.findFirst({
    where: { drugId, formularyId: "navitus-etf-2026" },
    select: { qlQuantity: true, qlDays: true },
  });
  if (entry?.qlQuantity && entry.qlDays) {
    return (
      Math.round((entry.qlQuantity / entry.qlDays) * daysSupply * 100) / 100
    );
  }
  return null;
}

export const estimateCostSchema = z.object({
  memberId: z.string(),
  drugName: z.string(),
  daysSupply: z.number().optional(),
  quantity: z.number().optional(),
  channel: z.enum(["Retail", "Mail", "Specialty"]).optional(),
});

export async function estimateCost(
  args: z.infer<typeof estimateCostSchema>,
): Promise<ToolResult> {
  const drug = await resolveDrug(args.drugName);
  if (!drug) {
    return {
      data: { found: false },
      citations: [],
      summary: `No product matching "${args.drugName}".`,
    };
  }

  const world = await loadWorld();
  const engineDrug = world.drugs.get(drug.id);
  const entry = world.formulary.get(drug.id) ?? null;
  const member = world.members.get(args.memberId);
  const elig = world.eligibility.get(args.memberId);
  if (!engineDrug || !member || !elig) {
    return {
      data: { found: false },
      citations: [],
      summary: "Not enough information on file to price this fill.",
    };
  }
  const plan = world.plans.get(elig.benefitPlanId);
  if (!plan) {
    return { data: { found: false }, citations: [], summary: "No plan on file." };
  }

  const pharmacyId =
    args.channel === "Mail"
      ? "ph-costco-mail"
      : args.channel === "Specialty" || entry?.level === "4"
        ? "ph-lumicera"
        : "ph-walgreens-mad";
  const pharmacy = world.pharmacies.get(pharmacyId)!;

  const daysSupply = args.daysSupply ?? 30;
  // Quantity is not days supply. An injectable dispensed as 3 mL for a month
  // would blow through its quantity limit if quoted as 30, and the member
  // would be told a covered drug will not pay. Take the quantity the plan has
  // actually seen for this product and only fall back to a unit a day.
  const quantity =
    args.quantity ??
    (await typicalQuantity(drug.id, daysSupply)) ??
    daysSupply;
  const nadacTotalCents = Math.round(engineDrug.nadacPerUnit * quantity * 100);

  const out = adjudicate({
    request: {
      dateOfService: new Date(),
      cardholderId: "",
      personCode: "01",
      serviceProviderId: pharmacy.npi,
      productServiceId: engineDrug.ndc11,
      rxNumber: "QUOTE",
      fillNumber: 0,
      quantityDispensed: quantity,
      daysSupply,
      dawCode: "0",
      usualAndCustomaryCents: Math.round(nadacTotalCents * 1.9),
      ingredientCostSubmittedCents: Math.round(nadacTotalCents * 1.8),
      compoundCode: "1",
    },
    member: { id: args.memberId, diagnosisCodes: member.diagnosisCodes, weightKg: member.weightKg },
    eligibility: elig,
    plan,
    drug: engineDrug,
    formularyEntry: entry,
    pharmacy,
    contract: world.contract,
    priorFills: [],
    accumulators: {
      rxOopAccumulatedCents: 0,
      federalOopAccumulatedCents: 0,
      deductibleAccumulatedCents: 0,
    },
    approvedPAs: world.approvedPAs.get(args.memberId) ?? [],
  });

  const citations = Array.from(
    new Map(
      out.trace
        .filter((t) => t.fired && t.sourceDocumentId)
        .map((t) => [t.sourceDocumentId!, cite(t.sourceDocumentId!, t.citation)]),
    ).values(),
  );

  if (out.responseStatus === "R") {
    return {
      data: {
        drug: tidyName(drug.name),
        wouldPay: false,
        rejectCode: out.rejectCodes[0],
        rejectReason: out.rejectMessage,
        memberExplanation: REJECT_MEMBER_EXPLANATION[out.rejectCodes[0]],
      },
      citations,
      summary: `A fill of ${tidyName(drug.name)} today would not pay: ${out.rejectMessage}.`,
    };
  }

  return {
    data: {
      drug: tidyName(drug.name),
      quantity,
      daysSupply,
      pharmacy: pharmacy.name,
      channel: out.channel,
      benefitLevel: out.formularyLevel,
      totalCostOfFill: formatCents(out.totalBilledCents),
      memberPays: formatCents(out.patientPayCents),
      planPays: formatCents(out.planPaidCents),
      countsTowardPrescriptionLimit: ["1", "2"].includes(out.formularyLevel ?? ""),
      note: "Quoted by running the same adjudication engine that processes real claims, against today's date and a zero accumulator balance.",
    },
    citations,
    summary: `A ${daysSupply}-day fill of ${tidyName(drug.name)} at ${pharmacy.name} would cost the member ${formatCents(out.patientPayCents)} of a ${formatCents(out.totalBilledCents)} total.`,
  };
}

// ---------------------------------------------------------------------------
// 7. Prior authorization status
// ---------------------------------------------------------------------------

export const getPriorAuthStatusSchema = z.object({
  memberId: z.string(),
  drugName: z.string().optional(),
});

export async function getPriorAuthStatus(
  args: z.infer<typeof getPriorAuthStatusSchema>,
): Promise<ToolResult> {
  const pas = await prisma.priorAuthorization.findMany({
    where: {
      memberId: args.memberId,
      ...(args.drugName ? { drug: { name: { contains: args.drugName } } } : {}),
    },
    include: {
      drug: true,
      tree: true,
      decisionSteps: { include: { criteriaStep: true }, orderBy: { seq: "asc" } },
    },
    orderBy: { receivedAt: "desc" },
  });

  if (pas.length === 0) {
    return {
      data: { requests: [] },
      citations: [],
      summary: "No prior authorization requests on file for this member.",
    };
  }

  const citations: Citation[] = [
    cite("navitus-pa-forms"),
    cite("cfr-423-568", "72 hours for a standard determination"),
  ];

  return {
    data: {
      requests: pas.map((pa) => ({
        paNumber: pa.paNumber,
        drug: tidyName(pa.drug.name),
        status: pa.status,
        determination: pa.determination,
        urgency: pa.urgency,
        received: pa.receivedAt.toISOString().slice(0, 10),
        decided: pa.decidedAt?.toISOString().slice(0, 10) ?? null,
        decidedBy: pa.decidedBy,
        decidingStep: pa.decidingStepNumber,
        decidingQuestion: pa.decisionSteps.at(-1)?.criteriaStep.question ?? null,
        denialReason: pa.denyReason,
        approvedThrough:
          pa.approvedTerminationDate?.toISOString().slice(0, 10) ?? null,
        approvedForDays: pa.approvedDays,
        criteriaDocument: pa.tree?.name,
        appealRights: pa.determination === "Denied",
        detailUrl: `/pa/${pa.id}`,
      })),
    },
    citations,
    summary: pas
      .map(
        (pa) =>
          `${tidyName(pa.drug.name)}: ${pa.determination ?? pa.status}${pa.decidingStepNumber ? ` at step ${pa.decidingStepNumber} of the published criteria` : ""}.`,
      )
      .join(" "),
  };
}

// ---------------------------------------------------------------------------
// 8. Explain the published criteria
// ---------------------------------------------------------------------------

export const explainCriteriaSchema = z.object({
  drugName: z.string(),
});

function describeBranch(
  b: { outcome: string; step?: number; days?: number; reason?: string },
  defaultDays: number,
): string {
  if (b.outcome === "step") return `go to step ${b.step}`;
  if (b.outcome === "approve") return `approve for ${b.days ?? defaultDays} days`;
  return b.reason ? `deny: ${b.reason}` : "deny";
}

export async function explainCriteria(
  args: z.infer<typeof explainCriteriaSchema>,
): Promise<ToolResult> {
  const tree = findTreeForDrug(args.drugName);
  if (!tree) {
    return {
      data: {
        found: false,
        availableCriteria: CRITERIA_TREES.map((t) => t.scopeLabel),
      },
      citations: [cite("navitus-pa-forms")],
      summary: `No encoded criteria document for ${args.drugName}.`,
    };
  }
  return {
    data: {
      criteriaDocument: tree.name,
      scope: tree.scopeLabel,
      approvalDuration: `${tree.defaultApprovalDays} days`,
      formUrl: tree.url,
      steps: tree.steps.map((s) => ({
        step: s.step,
        question: s.question,
        options: s.options,
        ifYes: describeBranch(s.yes, tree.defaultApprovalDays),
        ifNo: describeBranch(s.no, tree.defaultApprovalDays),
      })),
    },
    citations: [cite("navitus-pa-forms", tree.name)],
    summary: `Coverage of ${tree.scopeLabel} is decided by walking ${tree.steps.length} numbered questions in the published Navitus criteria document.`,
  };
}

// ---------------------------------------------------------------------------
// 9. Lower cost alternatives
// ---------------------------------------------------------------------------

export const findAlternativesSchema = z.object({
  drugName: z.string(),
  memberId: z.string().optional(),
});

export async function findAlternatives(
  args: z.infer<typeof findAlternativesSchema>,
): Promise<ToolResult> {
  const drug = await resolveDrug(args.drugName);
  if (!drug?.therapeuticClass) {
    return {
      data: { alternatives: [] },
      citations: [cite("navitus-etf-formulary-2026")],
      summary: "No therapeutic class on file, so no alternatives can be listed.",
    };
  }
  const entry = await prisma.formularyEntry.findFirst({
    where: { drugId: drug.id, formularyId: "navitus-etf-2026" },
  });
  const currentLevel = Number(entry?.level ?? 9);

  /*
   * Therapeutic class in the NADAC file is coarse. "Dermatologicals" holds
   * both Skyrizi and acyclovir ointment, and offering the ointment as a
   * cheaper option for plaque psoriasis is not a savings opportunity, it is
   * nonsense that destroys trust in every other answer the agent gives.
   * Requiring the same specialty status and the same route of administration
   * keeps the comparison inside the range a prescriber would consider.
   */
  const candidates = await prisma.formularyEntry.findMany({
    where: {
      formularyId: "navitus-etf-2026",
      level: { in: ["1", "2", "3"] },
      notCovered: false,
      planExclusion: false,
      drug: {
        therapeuticClass: drug.therapeuticClass,
        isSpecialty: drug.isSpecialty,
        id: { not: drug.id },
        prices: { some: { priceType: "NADAC" } },
      },
    },
    include: { drug: true },
    take: 60,
  });

  const sameRoute = candidates.filter(
    (c) => routeOf(c.drug.name) === routeOf(drug.name),
  );
  const alternatives = sameRoute
    .filter((c) => Number(c.level) < currentLevel)
    .slice(0, 6);
  // Everything comparable sitting at the same level is a different answer from
  // nothing comparable existing, and the member deserves to know which it is.
  const sameLevelCount = sameRoute.filter(
    (c) => Number(c.level) === currentLevel,
  ).length;

  const plan = await planCostShareContext(args.memberId);

  return {
    data: {
      current: { drug: tidyName(drug.name), level: entry?.level ?? null },
      therapeuticClass: drug.therapeuticClass,
      comparedOn:
        "same therapeutic class, same route of administration, same specialty status",
      comparableAtSameLevel: sameLevelCount,
      alternatives: alternatives.map((c) => ({
        drug: tidyName(c.drug.name),
        level: c.level,
        costShare: describeLevelCostShare(c.level, plan),
        priorAuthorizationRequired: c.requiresPA,
        note: "A prescriber has to agree the alternative is clinically appropriate. This is information, not medical advice.",
      })),
    },
    citations: [cite("navitus-etf-formulary-2026")],
    summary: `${alternatives.length} lower-level alternatives in the ${drug.therapeuticClass} class at the same route of administration.`,
  };
}

// ---------------------------------------------------------------------------
// 10. Refill timing
// ---------------------------------------------------------------------------

export const refillEligibilitySchema = z.object({
  memberId: z.string(),
  drugName: z
    .string()
    .optional()
    .describe(
      "Leave empty if the member did not name a drug. The tool will find the fill that was actually rejected for refill too soon.",
    ),
});

export async function refillEligibility(
  args: z.infer<typeof refillEligibilitySchema>,
): Promise<ToolResult> {
  let drugName = args.drugName;
  let rejectedAt: Date | null = null;

  // A member who says "my refill was too soon" is quoting the pharmacy, not
  // naming a drug. Find the fill that actually got the 79 so the answer is
  // about the right prescription instead of the most recent one.
  if (!drugName) {
    const reject = await prisma.claim.findFirst({
      where: {
        memberId: args.memberId,
        responseStatus: "R",
        rejectCodes: { contains: "79" },
      },
      include: { drug: true },
      orderBy: { dateOfService: "desc" },
    });
    if (reject) {
      drugName = reject.drug.name;
      rejectedAt = reject.dateOfService;
    }
  }
  if (!drugName) {
    return {
      data: { found: false },
      citations: [],
      summary:
        "No refill-too-soon rejection on file, and no drug was named, so there is nothing to check.",
    };
  }

  const last = await prisma.claim.findFirst({
    where: {
      memberId: args.memberId,
      responseStatus: "P",
      drug: { name: { contains: drugName } },
      ...(rejectedAt ? { dateOfService: { lt: rejectedAt } } : {}),
    },
    include: { drug: true },
    orderBy: { dateOfService: "desc" },
  });
  if (!last) {
    return {
      data: { found: false },
      citations: [],
      summary: `No paid fill of ${drugName} on file, so there is nothing holding a refill.`,
    };
  }
  const threshold = 0.75;
  const requiredDays = Math.ceil(last.daysSupply * threshold);
  const eligible = new Date(
    last.dateOfService.getTime() + requiredDays * 86_400_000,
  );
  const now = new Date();
  return {
    data: {
      drug: tidyName(last.drug.name),
      identifiedFrom: args.drugName
        ? "the drug the member named"
        : "the claim that was rejected for refill too soon",
      rejectedOn: rejectedAt?.toISOString().slice(0, 10) ?? null,
      lastFilled: last.dateOfService.toISOString().slice(0, 10),
      daysSupplyDispensed: last.daysSupply,
      thresholdPercent: threshold * 100,
      eligibleForRefillOn: eligible.toISOString().slice(0, 10),
      eligibleNow: now >= eligible,
      daysToWait: Math.max(
        0,
        Math.ceil((eligible.getTime() - now.getTime()) / 86_400_000),
      ),
    },
    citations: [
      cite(
        "etf-uniform-pharmacy-coc-2026",
        "A refill is allowed once 75% of the previous days supply has elapsed.",
      ),
    ],
    summary: `The last ${last.daysSupply}-day fill of ${tidyName(last.drug.name)} was ${last.dateOfService.toISOString().slice(0, 10)}, so a refill is allowed from ${eligible.toISOString().slice(0, 10)}.`,
  };
}

// ---------------------------------------------------------------------------
// 11. Pharmacies
// ---------------------------------------------------------------------------

export const findPharmaciesSchema = z.object({
  specialtyOnly: z.boolean().optional(),
  city: z.string().optional(),
});

export async function findPharmacies(
  args: z.infer<typeof findPharmaciesSchema>,
): Promise<ToolResult> {
  const rows = await prisma.pharmacy.findMany({
    where: {
      ...(args.specialtyOnly ? { isDesignatedSpecialty: true } : {}),
      ...(args.city ? { city: { contains: args.city } } : {}),
      networkLinks: { some: { networkId: "navicare-limited" } },
    },
    take: 12,
  });
  return {
    data: rows.map((p) => ({
      name: p.name,
      type: p.pharmacyType,
      city: p.city,
      state: p.state,
      designatedSpecialty: p.isDesignatedSpecialty,
    })),
    citations: [
      cite(
        "etg0013-amd1-exhibit-c",
        "Guarantees apply only to the NaviCare Limited Network. Specialty drugs dispense through Lumicera and UW Health Services.",
      ),
    ],
    summary: `${rows.length} in-network pharmacies.`,
  };
}

// ---------------------------------------------------------------------------

export const TOOL_REGISTRY = {
  getMemberProfile: {
    description:
      "Look up who the member is, which plan they are on, and the plan's out-of-pocket limits.",
    schema: getMemberProfileSchema,
    execute: getMemberProfile,
  },
  getAccumulators: {
    description:
      "How much the member has paid this year, how much counted toward the prescription out-of-pocket limit, and how much did not.",
    schema: getAccumulatorsSchema,
    execute: getAccumulators,
  },
  getClaims: {
    description: "List the member's recent claims, paid or rejected.",
    schema: getClaimsSchema,
    execute: getClaims,
  },
  explainClaim: {
    description:
      "Get the full derivation of one claim: which rules fired, what the member paid, and the documents behind each rule.",
    schema: explainClaimSchema,
    execute: explainClaim,
  },
  checkCoverage: {
    description:
      "Is a drug covered, at what benefit level, and what utilization management applies.",
    schema: checkCoverageSchema,
    execute: checkCoverage,
  },
  estimateCost: {
    description:
      "Price a hypothetical fill by running the real adjudication engine. Use this for any 'how much will X cost' question.",
    schema: estimateCostSchema,
    execute: estimateCost,
  },
  getPriorAuthStatus: {
    description:
      "Status of the member's prior authorization requests, including the numbered criteria step that decided each one.",
    schema: getPriorAuthStatusSchema,
    execute: getPriorAuthStatus,
  },
  explainCriteria: {
    description:
      "The published clinical criteria for a drug, as a numbered decision tree.",
    schema: explainCriteriaSchema,
    execute: explainCriteria,
  },
  findAlternatives: {
    description:
      "Lower benefit level alternatives in the same therapeutic class.",
    schema: findAlternativesSchema,
    execute: findAlternatives,
  },
  refillEligibility: {
    description: "When the member may refill a drug.",
    schema: refillEligibilitySchema,
    execute: refillEligibility,
  },
  findPharmacies: {
    description: "In-network pharmacies, optionally only designated specialty.",
    schema: findPharmaciesSchema,
    execute: findPharmacies,
  },
} as const;

export type ToolName = keyof typeof TOOL_REGISTRY;
