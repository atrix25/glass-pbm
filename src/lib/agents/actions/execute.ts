import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { actionDefinition } from "./registry";

export type ProposalDecision = "Approved" | "Rejected";

export class ActionReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function proposalPayloadHash(proposal: {
  action: string;
  subjectType: string;
  subjectId: string;
  payload: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: proposal.action,
        subjectType: proposal.subjectType,
        subjectId: proposal.subjectId,
        payload: proposal.payload,
      }),
    )
    .digest("hex");
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new ActionReviewError("Proposal payload is not valid JSON.", 422);
  }
}

export async function reviewProposal(input: {
  proposalId: string;
  decision: ProposalDecision;
  reviewer: { id?: string | null; label: string; role: string };
  note?: string | null;
}) {
  const proposal = await prisma.agentProposal.findUnique({
    where: { id: input.proposalId },
    include: { approval: true, execution: true },
  });
  if (!proposal) throw new ActionReviewError("Proposal not found.", 404);

  const definition = actionDefinition(proposal.action);
  const parsed = definition.schema.safeParse(parsePayload(proposal.payload));
  if (!parsed.success) {
    throw new ActionReviewError(
      `Proposal payload failed validation: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      422,
    );
  }

  if (
    input.decision === "Approved" &&
    !definition.approverRoles.includes(input.reviewer.role)
  ) {
    throw new ActionReviewError(
      `${input.reviewer.role} may not approve ${proposal.action}.`,
      403,
    );
  }
  if (
    input.reviewer.role === "system" &&
    (definition.humanRequired || !proposal.autoApplied)
  ) {
    throw new ActionReviewError("This action requires a human reviewer.", 403);
  }

  const digest = proposalPayloadHash(proposal);
  if (proposal.approval) {
    if (
      proposal.approval.decision !== input.decision ||
      proposal.approval.proposalPayloadHash !== digest
    ) {
      throw new ActionReviewError(
        "This proposal already has a different review decision.",
        409,
      );
    }
    if (input.decision === "Approved") {
      return executeApprovedProposal(proposal.id, proposal.approval.id);
    }
    return { proposalId: proposal.id, status: "Rejected", idempotent: true };
  }

  const approval = await prisma.$transaction(async (tx) => {
    const created = await tx.agentApproval.create({
      data: {
        proposalId: proposal.id,
        decision: input.decision,
        reviewerId: input.reviewer.id ?? null,
        reviewerLabel: input.reviewer.label,
        reviewerRole: input.reviewer.role,
        note: input.note ?? null,
        proposalPayloadHash: digest,
      },
    });
    await tx.agentProposal.update({
      where: { id: proposal.id },
      data: {
        status: input.decision,
        reviewedBy: input.reviewer.label,
        reviewedAt: created.createdAt,
        overrideNote:
          input.decision === "Rejected"
            ? input.note ?? "Rejected by reviewer."
            : null,
        appliedAt: null,
      },
    });
    return created;
  });

  await recordAudit({
    actorId: input.reviewer.id,
    action: `agent.proposal.${input.decision.toLowerCase()}`,
    entity: "AgentProposal",
    entityId: proposal.id,
    detail: {
      proposalAction: proposal.action,
      reviewerRole: input.reviewer.role,
      payloadHash: digest,
    },
  });

  if (input.decision === "Rejected") {
    return { proposalId: proposal.id, status: "Rejected", idempotent: false };
  }
  return executeApprovedProposal(proposal.id, approval.id);
}

export async function executeAutoAppliedProposal(proposalId: string) {
  const proposal = await prisma.agentProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) throw new ActionReviewError("Proposal not found.", 404);
  const definition = actionDefinition(proposal.action);
  if (definition.humanRequired || !proposal.autoApplied) {
    throw new ActionReviewError("Proposal is not eligible for automatic execution.", 403);
  }
  return reviewProposal({
    proposalId,
    decision: "Approved",
    reviewer: {
      label: "Autonomy policy",
      role: "system",
    },
    note: "Executed under the effective-dated autonomy policy.",
  });
}

async function executeApprovedProposal(proposalId: string, approvalId: string) {
  const proposal = await prisma.agentProposal.findUnique({
    where: { id: proposalId },
    include: { approval: true, execution: true },
  });
  if (!proposal || !proposal.approval) {
    throw new ActionReviewError("Approved proposal not found.", 404);
  }
  if (proposal.approval.id !== approvalId || proposal.approval.decision !== "Approved") {
    throw new ActionReviewError("Proposal does not have the required approval.", 409);
  }

  const digest = proposalPayloadHash(proposal);
  if (digest !== proposal.approval.proposalPayloadHash) {
    throw new ActionReviewError(
      "Proposal changed after approval; a new review is required.",
      409,
    );
  }
  if (proposal.execution?.status === "Succeeded") {
    return {
      proposalId,
      executionId: proposal.execution.id,
      status: "Applied",
      idempotent: true,
      result: proposal.execution.result
        ? JSON.parse(proposal.execution.result)
        : null,
    };
  }
  if (proposal.execution?.status === "Running") {
    throw new ActionReviewError("Proposal execution is already running.", 409);
  }

  const definition = actionDefinition(proposal.action);
  const parsed = definition.schema.safeParse(parsePayload(proposal.payload));
  if (!parsed.success) {
    throw new ActionReviewError("Approved payload no longer validates.", 422);
  }
  const idempotencyKey = `agent-proposal:${proposal.id}:${digest}`;

  let execution;
  if (proposal.execution?.status === "Failed") {
    execution = await prisma.agentActionExecution.update({
      where: { id: proposal.execution.id },
      data: {
        status: "Running",
        error: null,
        result: null,
        completedAt: null,
        attemptedAt: new Date(),
      },
    });
  } else {
    try {
      execution = await prisma.agentActionExecution.create({
        data: {
          proposalId: proposal.id,
          approvalId,
          action: proposal.action,
          idempotencyKey,
          payloadHash: digest,
          status: "Running",
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await prisma.agentActionExecution.findUnique({
          where: { proposalId },
        });
        if (existing?.status === "Succeeded") {
          return {
            proposalId,
            executionId: existing.id,
            status: "Applied",
            idempotent: true,
            result: existing.result ? JSON.parse(existing.result) : null,
          };
        }
      }
      throw error;
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const output = await definition.execute(tx, parsed.data, {
        proposal: {
          id: proposal.id,
          runId: proposal.runId,
          agentId: proposal.agentId,
          subjectType: proposal.subjectType,
          subjectId: proposal.subjectId,
          action: proposal.action,
          headline: proposal.headline,
          rationale: proposal.rationale,
        },
        reviewer: {
          label: proposal.approval!.reviewerLabel,
          role: proposal.approval!.reviewerRole,
        },
        now: new Date(),
      });
      await tx.agentActionExecution.update({
        where: { id: execution.id },
        data: {
          status: "Succeeded",
          result: JSON.stringify(output),
          completedAt: new Date(),
        },
      });
      await tx.agentProposal.update({
        where: { id: proposal.id },
        data: { status: "Applied", appliedAt: new Date() },
      });
      return output;
    });

    await recordAudit({
      actorId: proposal.approval.reviewerId,
      action: "agent.proposal.execute",
      entity: proposal.subjectType,
      entityId: proposal.subjectId,
      detail: {
        proposalId: proposal.id,
        executionId: execution.id,
        action: proposal.action,
        consequences: definition.consequences,
        result,
      },
    });
    return {
      proposalId,
      executionId: execution.id,
      status: "Applied",
      idempotent: false,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.agentActionExecution.update({
      where: { id: execution.id },
      data: { status: "Failed", error: message, completedAt: new Date() },
    });
    throw new ActionReviewError(`Action execution failed: ${message}`, 422);
  }
}
