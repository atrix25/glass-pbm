import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { reviewProposal } from "@/lib/agents/actions/execute";

vi.mock("server-only", () => ({}));

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const runIds: string[] = [];
const rebateInvoiceIds: string[] = [];

afterEach(async () => {
  if (!process.env.DATABASE_URL) return;
  await prisma.guaranteeCredit.deleteMany({
    where: { proposal: { runId: { in: runIds } } },
  });
  await prisma.serviceCase.deleteMany({
    where: { agentRunId: { in: runIds } },
  });
  await prisma.agentRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.rebateInvoice.deleteMany({
    where: { id: { in: rebateInvoiceIds } },
  });
  runIds.length = 0;
  rebateInvoiceIds.length = 0;
});

async function createProposal(
  options: {
    action?: string;
    agentId?: string;
    subjectType?: string;
    subjectId?: string;
    payload?: Record<string, unknown>;
    consequential?: boolean;
  } = {},
) {
  const runId = randomUUID();
  const proposalId = randomUUID();
  const subjectId = options.subjectId ?? runId;
  runIds.push(runId);
  await prisma.agentRun.create({
    data: {
      id: runId,
      agentId: options.agentId ?? "service-escalation-triage",
      startedAt: new Date(),
      endedAt: new Date(),
      goal: "Integration-test governed execution.",
      subjectType: options.subjectType ?? "AgentRun",
      subjectId,
      outcome: "Completed",
      summary: "Test proposal ready.",
      brain: "deterministic",
      autonomy: "Propose",
      proposals: {
        create: {
          id: proposalId,
          agentId: options.agentId ?? "service-escalation-triage",
          subjectType: options.subjectType ?? "AgentRun",
          subjectId,
          action: options.action ?? "open-service-case",
          headline: "Open an owned service case",
          rationale: "The source remains unresolved.",
          payload: JSON.stringify(
            options.payload ?? {
              title: "Integration test case",
              priority: "High",
              queue: "Agent operations",
            },
          ),
          confidenceBps: 10_000,
          consequential: options.consequential ?? false,
          status: "Proposed",
          createdAt: new Date(),
        },
      },
    },
  });
  return { runId, proposalId };
}

describeWithDatabase("governed proposal execution", () => {
  it("applies once and returns the same receipt on retry", async () => {
    const { proposalId } = await createProposal();
    const reviewer = { label: "Integration test operator", role: "ops" };

    const first = await reviewProposal({
      proposalId,
      decision: "Approved",
      reviewer,
    });
    const second = await reviewProposal({
      proposalId,
      decision: "Approved",
      reviewer,
    });

    expect(first.status).toBe("Applied");
    if (!("executionId" in first)) {
      throw new Error("Approved proposal did not return an execution receipt.");
    }
    expect(second).toMatchObject({
      status: "Applied",
      idempotent: true,
      executionId: first.executionId,
    });
    expect(
      await prisma.agentActionExecution.count({ where: { proposalId } }),
    ).toBe(1);
    expect(
      await prisma.serviceCase.count({
        where: { sourceType: "AgentRun", sourceId: runIds[0] },
      }),
    ).toBe(1);
  });

  it("rejects a proposal whose payload changed after approval", async () => {
    const { proposalId } = await createProposal();
    await reviewProposal({
      proposalId,
      decision: "Approved",
      reviewer: { label: "Integration test operator", role: "ops" },
    });
    await prisma.agentProposal.update({
      where: { id: proposalId },
      data: { payload: JSON.stringify({ title: "Changed after review" }) },
    });

    await expect(
      reviewProposal({
        proposalId,
        decision: "Approved",
        reviewer: { label: "Integration test operator", role: "ops" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("fails closed for an unregistered proposal action", async () => {
    const { proposalId } = await createProposal({
      action: "invented-action",
    });
    await expect(
      reviewProposal({
        proposalId,
        decision: "Approved",
        reviewer: { label: "Integration test operator", role: "admin" },
      }),
    ).rejects.toThrow("Unknown agent action");
  });

  it("opens a rebate dispute and updates the authoritative receivable", async () => {
    const invoiceId = randomUUID();
    rebateInvoiceIds.push(invoiceId);
    await prisma.rebateInvoice.create({
      data: {
        id: invoiceId,
        manufacturer: "Integration manufacturer",
        quarter: "2026Q1",
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-03-31T00:00:00Z"),
        submittedAt: new Date("2026-04-01T00:00:00Z"),
        dueAt: new Date("2026-05-01T00:00:00Z"),
        claimCount: 10,
        invoicedCents: 25_000,
      },
    });
    const { proposalId } = await createProposal({
      action: "open-rebate-dispute",
      agentId: "rebate-collections",
      subjectType: "RebateInvoice",
      subjectId: invoiceId,
      consequential: true,
      payload: {
        invoiceId,
        amountCents: 5_000,
        reason: "Cash receipt is short of the submitted invoice.",
      },
    });

    await reviewProposal({
      proposalId,
      decision: "Approved",
      reviewer: { label: "Finance operator", role: "ops" },
    });

    expect(
      await prisma.rebateDispute.findFirst({ where: { invoiceId } }),
    ).toMatchObject({ amountCents: 5_000, status: "Open" });
    expect(
      await prisma.rebateInvoice.findUnique({ where: { id: invoiceId } }),
    ).toMatchObject({ disputedCents: 5_000 });
  });

  it("posts one deterministic guarantee credit", async () => {
    const guaranteeId = `integration-${randomUUID()}`;
    const { proposalId } = await createProposal({
      action: "post-guarantee-credit",
      agentId: "guarantee-credit",
      subjectType: "PerformanceGuarantee",
      subjectId: `${guaranteeId}:2026-01`,
      consequential: true,
      payload: {
        guaranteeId,
        period: "2026-01",
        amountCents: 12_500,
        rationale: "The deterministic scorecard returned the contract penalty.",
      },
    });

    const result = await reviewProposal({
      proposalId,
      decision: "Approved",
      reviewer: { label: "Plan sponsor", role: "plan_sponsor" },
    });

    expect(result.status).toBe("Applied");
    expect(
      await prisma.guaranteeCredit.findUnique({ where: { proposalId } }),
    ).toMatchObject({ guaranteeId, period: "2026-01", amountCents: 12_500 });
  });
});
