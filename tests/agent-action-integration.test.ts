import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { reviewProposal } from "@/lib/agents/actions/execute";

vi.mock("server-only", () => ({}));

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const runIds: string[] = [];

afterEach(async () => {
  if (!process.env.DATABASE_URL) return;
  await prisma.serviceCase.deleteMany({
    where: { agentRunId: { in: runIds } },
  });
  await prisma.agentRun.deleteMany({ where: { id: { in: runIds } } });
  runIds.length = 0;
});

async function createProposal(action = "open-service-case") {
  const runId = randomUUID();
  const proposalId = randomUUID();
  runIds.push(runId);
  await prisma.agentRun.create({
    data: {
      id: runId,
      agentId: "service-escalation-triage",
      startedAt: new Date(),
      endedAt: new Date(),
      goal: "Integration-test governed execution.",
      subjectType: "AgentRun",
      subjectId: runId,
      outcome: "Completed",
      summary: "Test proposal ready.",
      brain: "deterministic",
      autonomy: "Propose",
      proposals: {
        create: {
          id: proposalId,
          agentId: "service-escalation-triage",
          subjectType: "AgentRun",
          subjectId: runId,
          action,
          headline: "Open an owned service case",
          rationale: "The source remains unresolved.",
          payload: JSON.stringify({
            title: "Integration test case",
            priority: "High",
            queue: "Agent operations",
          }),
          confidenceBps: 10_000,
          consequential: false,
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
    const { proposalId } = await createProposal("invented-action");
    await expect(
      reviewProposal({
        proposalId,
        decision: "Approved",
        reviewer: { label: "Integration test operator", role: "admin" },
      }),
    ).rejects.toThrow("Unknown agent action");
  });
});
