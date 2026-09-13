import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import type { ActionContext, ActionDefinition } from "./types";

const jsonRecord = z.record(z.string(), z.unknown());
const pathStep = z.object({ step: z.number().int().positive() }).passthrough();

const paPayload = z
  .object({
    answers: jsonRecord,
    condition: z.string().nullable().optional(),
    specialty: z.string().nullable().optional(),
    path: z.array(pathStep).min(1),
  })
  .passthrough();

const eligibilityPayload = z.object({
  patch: jsonRecord,
  rejectCode: z.string().nullable().optional(),
});

const nonTerminatingEligibilityPayload = eligibilityPayload.superRefine(
  (payload, context) => {
    if (
      "terminationDate" in payload.patch &&
      payload.patch.terminationDate !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["patch", "terminationDate"],
        message:
          "A correction that sets a coverage end date must use terminate-coverage.",
      });
    }
  },
);

const macPayload = z.object({
  letter: z.string().min(1),
  citedNdc: z.string().nullable().optional(),
  revisedUnitPrice: z.number().positive().nullable().optional(),
});

const planPayload = z
  .object({
    override: jsonRecord,
    driverKey: z.string().min(1),
    scored: z.array(jsonRecord).min(1),
  })
  .superRefine((payload, context) => {
    const selected = JSON.stringify(payload.override);
    if (
      !payload.scored.some(
        (candidate) => JSON.stringify(candidate.override) === selected,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["override"],
        message: "The selected override must be one of the replayed candidates.",
      });
    }
  });

const casePayload = z
  .object({
    title: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    priority: z.enum(["Low", "Normal", "High", "Urgent"]).optional(),
    queue: z.string().min(1).optional(),
    slaDueAt: z.string().datetime().optional(),
  })
  .passthrough();

const rebatePayload = z.object({
  invoiceId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  reason: z.string().min(1),
  evidence: jsonRecord.optional(),
});

const guaranteePayload = z.object({
  guaranteeId: z.string().min(1),
  period: z.string().min(1),
  amountCents: z.number().int().positive(),
  sponsorInvoiceId: z.string().min(1).nullable().optional(),
  rationale: z.string().min(1),
});

async function openCase(
  tx: Prisma.TransactionClient,
  payload: z.output<typeof casePayload>,
  context: ActionContext,
) {
  const existing = await tx.serviceCase.findUnique({
    where: {
      sourceType_sourceId: {
        sourceType: context.proposal.subjectType,
        sourceId: context.proposal.subjectId,
      },
    },
  });
  if (existing) {
    const updated = await tx.serviceCase.update({
      where: { id: existing.id },
      data: {
        title: payload.title ?? existing.title,
        summary: payload.summary ?? context.proposal.rationale,
        priority: payload.priority ?? existing.priority,
        queue: payload.queue ?? existing.queue,
        status: "Open",
        owner: context.reviewer.label,
        slaDueAt: payload.slaDueAt
          ? new Date(payload.slaDueAt)
          : existing.slaDueAt,
        resolution: null,
        resolvedAt: null,
      },
    });
    return { serviceCaseId: updated.id, caseNumber: updated.caseNumber };
  }

  const created = await tx.serviceCase.create({
    data: {
      caseNumber: `CASE-${randomUUID().slice(0, 8).toUpperCase()}`,
      sourceType: context.proposal.subjectType,
      sourceId: context.proposal.subjectId,
      agentRunId: context.proposal.runId,
      title: payload.title ?? context.proposal.headline,
      summary: payload.summary ?? context.proposal.rationale,
      priority: payload.priority ?? "Normal",
      queue: payload.queue ?? queueFor(context.proposal.subjectType),
      owner: context.reviewer.label,
      slaDueAt: payload.slaDueAt
        ? new Date(payload.slaDueAt)
        : new Date(context.now.getTime() + 24 * 60 * 60 * 1000),
    },
  });
  return { serviceCaseId: created.id, caseNumber: created.caseNumber };
}

function queueFor(subjectType: string) {
  switch (subjectType) {
    case "PriorAuthorization":
      return "Clinical operations";
    case "EligibilityTransaction":
      return "Eligibility operations";
    case "MacAppeal":
      return "Network operations";
    case "RebateInvoice":
      return "Manufacturer finance";
    default:
      return "Member and client services";
  }
}

async function applyPa(
  tx: Prisma.TransactionClient,
  payload: z.output<typeof paPayload>,
  context: ActionContext,
  denied: boolean,
) {
  const pa = await tx.priorAuthorization.findUnique({
    where: { id: context.proposal.subjectId },
    include: { tree: true },
  });
  if (!pa) throw new Error("Prior authorization no longer exists.");
  if (pa.determination && pa.decidedAt && pa.decidedAt <= context.now) {
    const expected = denied ? "Denied" : "Approved";
    if (pa.determination === expected) {
      return {
        priorAuthorizationId: pa.id,
        determination: pa.determination,
        decidingStep: pa.decidingStepNumber,
        alreadyRecorded: true,
      };
    }
    if (!denied) {
      await tx.priorAuthorization.update({
        where: { id: pa.id },
        data: {
          questionResponses: JSON.stringify(payload.answers),
        },
      });
      return {
        priorAuthorizationId: pa.id,
        determination: pa.determination,
        proposedDetermination: expected,
        decisionPreserved: true,
      };
    }
    throw new Error("Prior authorization has already been determined differently.");
  }

  const decidingStep = payload.path.at(-1)?.step ?? null;
  const approvedDays = pa.tree?.approvalDurationDays ?? 365;
  await tx.priorAuthorization.update({
    where: { id: pa.id },
    data: {
      questionResponses: JSON.stringify(payload.answers),
      status: denied ? "Denied" : "Approved",
      determination: denied ? "Denied" : "Approved",
      decidingStepNumber: decidingStep,
      denyReason: denied ? context.proposal.rationale : null,
      approvedDays: denied ? null : approvedDays,
      approvedEffectiveDate: denied ? null : context.now,
      approvedTerminationDate: denied
        ? null
        : new Date(context.now.getTime() + approvedDays * 86_400_000),
      decidedAt: context.now,
      decidedBy: context.reviewer.label,
      escalated: false,
    },
  });
  return {
    priorAuthorizationId: pa.id,
    determination: denied ? "Denied" : "Approved",
    decidingStep,
  };
}

async function applyEligibility(
  tx: Prisma.TransactionClient,
  payload: z.output<typeof eligibilityPayload>,
  context: ActionContext,
) {
  const original = await tx.eligibilityTransaction.findUnique({
    where: { id: context.proposal.subjectId },
  });
  if (!original) throw new Error("Eligibility transaction no longer exists.");

  const patch = payload.patch;
  const correctedId = `${original.id}-agent`;
  const effectiveDate =
    typeof patch.effectiveDate === "string"
      ? new Date(patch.effectiveDate)
      : original.effectiveDate;
  const terminationDate =
    patch.terminationDate === null
      ? null
      : typeof patch.terminationDate === "string"
        ? new Date(patch.terminationDate)
        : original.terminationDate;
  const memberId =
    typeof patch.memberId === "string" ? patch.memberId : original.memberId;
  const benefitPlanId =
    typeof patch.benefitPlanId === "string"
      ? patch.benefitPlanId
      : original.benefitPlanId;

  await tx.eligibilityTransaction.create({
    data: {
      id: correctedId,
      fileId: original.fileId,
      maintenanceType: original.maintenanceType,
      maintenanceReason: original.maintenanceReason,
      memberId,
      cardholderId: original.cardholderId,
      personCode: original.personCode,
      relationshipCode:
        typeof patch.relationshipCode === "string"
          ? patch.relationshipCode
          : original.relationshipCode,
      memberName: original.memberName,
      benefitPlanId,
      coverageTier: original.coverageTier,
      effectiveDate,
      terminationDate,
      status: "Applied",
      resolution: `Applied from agent proposal ${context.proposal.id}`,
      resolvedAt: context.now,
    },
  });
  await tx.eligibilityTransaction.update({
    where: { id: original.id },
    data: {
      correctedById: correctedId,
      resolvedAt: context.now,
      resolution: context.proposal.rationale,
    },
  });

  if (memberId && benefitPlanId && effectiveDate) {
    const span = await tx.eligibilitySpan.findFirst({
      where: { memberId, benefitPlanId },
      orderBy: { effectiveDate: "desc" },
    });
    if (span) {
      await tx.eligibilitySpan.update({
        where: { id: span.id },
        data: { effectiveDate, terminationDate },
      });
    } else {
      await tx.eligibilitySpan.create({
        data: {
          memberId,
          benefitPlanId,
          effectiveDate,
          terminationDate,
          coverageTier: original.coverageTier ?? "Employee",
        },
      });
    }
  }
  return { eligibilityTransactionId: correctedId, memberId, benefitPlanId };
}

async function applyMac(
  tx: Prisma.TransactionClient,
  payload: z.output<typeof macPayload>,
  context: ActionContext,
  overturn: boolean,
) {
  const appeal = await tx.macAppeal.findUnique({
    where: { id: context.proposal.subjectId },
  });
  if (!appeal) throw new Error("MAC appeal no longer exists.");
  const expectedOutcome = overturn ? "Overturned" : "Upheld";
  if (appeal.outcome && appeal.decidedAt) {
    if (appeal.outcome === expectedOutcome) {
      return {
        macAppealId: appeal.id,
        outcome: expectedOutcome,
        alreadyRecorded: true,
      };
    }
    throw new Error("MAC appeal has already been determined differently.");
  }
  const revised = overturn ? payload.revisedUnitPrice : null;
  if (overturn && !revised) {
    throw new Error("An overturned appeal requires a revised unit price.");
  }
  const adjustmentCents =
    overturn && revised
      ? Math.round(
          (revised - appeal.macUnitPrice) * appeal.quantityDispensed * 100,
        )
      : 0;

  await tx.macAppeal.update({
    where: { id: appeal.id },
    data: {
      outcome: overturn ? "Overturned" : "Upheld",
      decidedAt: context.now,
      denialReason: overturn ? null : context.proposal.rationale,
      citedNdc: overturn ? null : (payload.citedNdc ?? null),
      citedWholesaler: overturn ? null : "Verified wholesaler survey",
      revisedUnitPrice: revised,
      adjustmentCents,
      affectedClaims: overturn ? 1 : 0,
      adjustedAt: overturn ? context.now : null,
      responseDraft: payload.letter,
      responseSentAt: context.now,
      responseSentBy: context.reviewer.label,
    },
  });

  if (overturn && revised) {
    const list = await tx.macList.findFirst({ orderBy: { version: "desc" } });
    if (!list) throw new Error("No active MAC list exists.");
    const current = await tx.macPrice.findUnique({
      where: { listId_drugId: { listId: list.id, drugId: appeal.drugId } },
    });
    if (!current) throw new Error("The appealed drug is not on the active MAC list.");
    await tx.macPrice.update({
      where: { id: current.id },
      data: { unitPrice: revised },
    });
    await tx.macPriceChange.create({
      data: {
        id: randomUUID(),
        listId: list.id,
        drugId: appeal.drugId,
        pharmacyId: appeal.pharmacyId,
        priorUnitPrice: current.unitPrice,
        newUnitPrice: revised,
        reason: "Appeal",
        appealId: appeal.id,
      },
    });
  }

  return { macAppealId: appeal.id, outcome: expectedOutcome };
}

async function applyPlanDesign(
  tx: Prisma.TransactionClient,
  payload: z.output<typeof planPayload>,
  context: ActionContext,
) {
  const serialized = JSON.stringify(payload.override);
  const hash = createHash("sha256").update(serialized).digest("hex");
  const selected =
    payload.scored.find(
      (candidate) => JSON.stringify(candidate.override) === serialized,
    );
  if (!selected) {
    throw new Error("Selected benefit override was not replayed.");
  }
  const version = await tx.configVersion.create({
    data: {
      label: context.proposal.headline,
      description: context.proposal.rationale,
      contentHash: hash,
      payload: serialized,
      changeSummary: JSON.stringify([
        `Agent recommendation for ${payload.driverKey}, approved by ${context.reviewer.label}.`,
      ]),
      createdBy: context.reviewer.label,
    },
  });
  await tx.readjudicationRun.create({
    data: {
      configVersionId: version.id,
      baselineLabel: "Plan year 2026 as filed",
      claimsEvaluated: Number(selected.claimsEvaluated ?? 0),
      claimsChanged: Number(selected.claimsChanged ?? 0),
      membersAffected:
        Number(selected.membersPayingMore ?? 0) +
        Number(selected.fillsThatWouldReject ?? 0),
      planCostDeltaCents: -Number(selected.planSavingCents ?? 0),
      memberCostDeltaCents: Number(selected.memberShiftCents ?? 0),
      newRejects: Number(selected.fillsThatWouldReject ?? 0),
      diffPayload: "[]",
    },
  });
  return { configVersionId: version.id, contentHash: hash };
}

const definitions: ActionDefinition[] = [
  {
    action: "record-answer-set",
    description: "Record extracted PA answers and deterministic approval.",
    schema: paPayload,
    consequences: ["care", "coverage"],
    humanRequired: false,
    approverRoles: ["system", "pharmacist", "ops", "admin"],
    execute: (tx, payload, context) => applyPa(tx, payload, context, false),
  },
  {
    action: "record-denial",
    description: "Record a pharmacist-signed PA denial.",
    schema: paPayload,
    consequences: ["care", "coverage"],
    humanRequired: true,
    approverRoles: ["pharmacist", "admin"],
    execute: (tx, payload, context) => applyPa(tx, payload, context, true),
  },
  {
    action: "apply-benefit-change",
    description: "Publish an approved, replayed benefit configuration.",
    schema: planPayload,
    consequences: ["coverage", "money", "contract"],
    humanRequired: true,
    approverRoles: ["plan_sponsor", "admin"],
    execute: applyPlanDesign,
  },
  {
    action: "apply-correction",
    description: "Apply a reversible eligibility correction.",
    schema: nonTerminatingEligibilityPayload,
    consequences: ["coverage"],
    humanRequired: false,
    approverRoles: ["system", "ops", "admin"],
    execute: applyEligibility,
  },
  {
    action: "terminate-coverage",
    description: "Apply an explicitly reviewed coverage termination.",
    schema: eligibilityPayload,
    consequences: ["coverage"],
    humanRequired: true,
    approverRoles: ["ops", "admin"],
    execute: applyEligibility,
  },
  {
    action: "uphold-denial",
    description: "Sign and record a MAC appeal denial response.",
    schema: macPayload,
    consequences: ["money", "external_communication", "legal_compliance"],
    humanRequired: true,
    approverRoles: ["pharmacist", "admin"],
    execute: (tx, payload, context) => applyMac(tx, payload, context, false),
  },
  {
    action: "adjust-mac-price",
    description: "Adjust the MAC price and record the appeal response.",
    schema: macPayload,
    consequences: ["money", "external_communication", "legal_compliance"],
    humanRequired: true,
    approverRoles: ["pharmacist", "admin"],
    execute: (tx, payload, context) => applyMac(tx, payload, context, true),
  },
  {
    action: "open-rebate-dispute",
    description: "Open a manufacturer rebate invoice dispute.",
    schema: rebatePayload,
    consequences: ["money", "contract"],
    humanRequired: true,
    approverRoles: ["ops", "admin"],
    execute: async (tx, payload, context) => {
      const invoice = await tx.rebateInvoice.findUnique({
        where: { id: payload.invoiceId },
      });
      if (!invoice) throw new Error("Rebate invoice no longer exists.");
      const existing = await tx.rebateDispute.findFirst({
        where: { invoiceId: invoice.id, status: "Open", resolvedAt: null },
      });
      if (existing) {
        throw new Error("An open dispute already represents this invoice.");
      }
      const dispute = await tx.rebateDispute.create({
        data: {
          invoiceId: invoice.id,
          reason: payload.reason,
          amountCents: payload.amountCents,
          owner: context.reviewer.label,
          evidence: JSON.stringify(payload.evidence ?? {}),
        },
      });
      await tx.rebateInvoice.update({
        where: { id: invoice.id },
        data: { disputedCents: { increment: payload.amountCents } },
      });
      return { rebateDisputeId: dispute.id, invoiceId: invoice.id };
    },
  },
  {
    action: "post-guarantee-credit",
    description: "Post an approved deterministic guarantee credit.",
    schema: guaranteePayload,
    consequences: ["money", "contract"],
    humanRequired: true,
    approverRoles: ["plan_sponsor", "admin"],
    execute: async (tx, payload, context) => {
      if (payload.sponsorInvoiceId) {
        const invoice = await tx.sponsorInvoice.findUnique({
          where: { id: payload.sponsorInvoiceId },
        });
        if (!invoice) throw new Error("Sponsor invoice no longer exists.");
        if (invoice.totalDueCents < payload.amountCents) {
          throw new Error("Guarantee credit exceeds the sponsor invoice balance.");
        }
        await tx.sponsorInvoice.update({
          where: { id: invoice.id },
          data: { totalDueCents: { decrement: payload.amountCents } },
        });
      }
      const credit = await tx.guaranteeCredit.create({
        data: {
          proposalId: context.proposal.id,
          sponsorInvoiceId: payload.sponsorInvoiceId ?? null,
          guaranteeId: payload.guaranteeId,
          period: payload.period,
          amountCents: payload.amountCents,
          rationale: payload.rationale,
        },
      });
      return { guaranteeCreditId: credit.id, amountCents: credit.amountCents };
    },
  },
  {
    action: "open-service-case",
    description: "Create or update a shared service case.",
    schema: casePayload,
    consequences: [],
    humanRequired: false,
    approverRoles: ["system", "ops", "admin", "pharmacist"],
    execute: openCase,
  },
  {
    action: "handoff",
    description: "Route a member question into the shared service queue.",
    schema: casePayload,
    consequences: [],
    humanRequired: false,
    approverRoles: ["system", "ops", "admin"],
    execute: openCase,
  },
  {
    action: "open-case",
    description: "Open a program-integrity case.",
    schema: casePayload,
    consequences: [],
    humanRequired: false,
    approverRoles: ["system", "ops", "admin", "pharmacist"],
    execute: openCase,
  },
  {
    action: "refer-to-siu",
    description: "Refer a program-integrity case to SIU.",
    schema: casePayload,
    consequences: ["external_communication", "legal_compliance"],
    humanRequired: true,
    approverRoles: ["ops", "admin", "pharmacist"],
    execute: openCase,
  },
  {
    action: "lock-in-member",
    description: "Route a proposed member lock-in for controlled execution.",
    schema: casePayload,
    consequences: ["care", "coverage"],
    humanRequired: true,
    approverRoles: ["pharmacist", "admin"],
    execute: openCase,
  },
  {
    action: "return-to-sponsor",
    description: "Route an unresolved eligibility instruction to the sponsor queue.",
    schema: eligibilityPayload,
    consequences: ["external_communication"],
    humanRequired: false,
    approverRoles: ["system", "ops", "admin"],
    execute: async (tx, _payload, context) =>
      openCase(tx, { queue: "Sponsor eligibility", priority: "Normal" }, context),
  },
  {
    action: "escalate",
    description: "Escalate unresolved work into the shared service queue.",
    schema: eligibilityPayload.or(casePayload),
    consequences: [],
    humanRequired: false,
    approverRoles: ["system", "ops", "admin", "pharmacist"],
    execute: async (tx, _payload, context) =>
      openCase(tx, { priority: "High" }, context),
  },
  {
    action: "close-benign",
    description: "Close a program-integrity signal as benign.",
    schema: casePayload,
    consequences: [],
    humanRequired: false,
    approverRoles: ["system", "ops", "admin", "pharmacist"],
    execute: async (tx, payload, context) => {
      const opened = await openCase(tx, payload, context);
      await tx.serviceCase.update({
        where: { id: String(opened.serviceCaseId) },
        data: {
          status: "Resolved",
          resolution: context.proposal.rationale,
          resolvedAt: context.now,
        },
      });
      return opened;
    },
  },
];

const ACTIONS = new Map(definitions.map((definition) => [definition.action, definition]));

if (ACTIONS.size !== definitions.length) {
  throw new Error("Duplicate agent action definition.");
}

export function actionDefinition(action: string): ActionDefinition {
  const definition = ACTIONS.get(action);
  if (!definition) throw new Error(`Unknown agent action: ${action}`);
  return definition;
}

export function allActionDefinitions(): readonly ActionDefinition[] {
  return definitions;
}
