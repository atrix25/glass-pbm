import { beforeEach, describe, expect, it, vi } from "vitest";
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  agentProposal: { findFirst: vi.fn(), update: vi.fn() },
  configVersion: { findMany: vi.fn(), create: vi.fn() },
  agentRun: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    configVersion: tx.configVersion,
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));
vi.mock("@/lib/engine/replay", () => ({ replay: vi.fn() }));
vi.mock("@/lib/queries/trends", () => ({
  getDrugDrivers: vi.fn(),
  getTrendOverview: vi.fn(),
}));
vi.mock("@/lib/agents/runtime", () => ({ startRun: vi.fn() }));
import { activateBenefit } from "@/lib/agents/account-management/service";
const analysis = () => ({
  runId: "run",
  generatedAt: new Date().toISOString(),
  asOf: "2026-01-01",
  baselineId: null,
  recommendedId: "one",
  goals: {
    savingCents: 100,
    maxAffectedMembers: 10,
    maxMembersPayingMore: 0,
    maxNewRejects: 0,
  },
  options: [
    {
      id: "one",
      name: "Option",
      override: { formulary: [{ drugId: "d", level: "3" }] },
      planSavingCents: 1000,
      memberShiftCents: 0,
      netSavingCents: 1000,
      affectedMembers: 5,
      membersPayingMore: 0,
      newRejects: 0,
      reasons: [],
    },
  ],
});
const proposal = (a = analysis()) => ({
  id: "proposal",
  status: "Proposed",
  payload: JSON.stringify({ analysis: a }),
});
beforeEach(() => {
  vi.clearAllMocks();
  tx.agentProposal.findFirst.mockResolvedValue(proposal());
  tx.configVersion.findMany.mockResolvedValue([]);
  tx.configVersion.create.mockResolvedValue({ id: "release" });
});
describe("approved benefit activation", () => {
  it("schedules one effective release and seven explicit review requests", async () => {
    const result = await activateBenefit("proposal", "benefits@example.test");
    expect(result.id).toBe("release");
    expect(Date.parse(result.effectiveAt)).toBeGreaterThan(Date.now());
    expect(tx.agentRun.create).toHaveBeenCalledTimes(7);
    expect(tx.agentProposal.update.mock.calls[0][0].data).toMatchObject({
      status: "Applied",
      reviewedBy: "benefits@example.test",
      autoApplied: false,
    });
    expect(
      tx.agentRun.create.mock.calls[0][0].data.proposals.create,
    ).toMatchObject({
      action: "review-benefit-release",
      status: "Proposed",
      autoApplied: false,
    });
  });
  it("rejects stale evidence before any write", async () => {
    tx.agentProposal.findFirst.mockResolvedValue(
      proposal({ ...analysis(), generatedAt: "2020-01-01" }),
    );
    await expect(activateBenefit("proposal", "reviewer")).rejects.toThrow(
      "24 hours",
    );
    expect(tx.configVersion.create).not.toHaveBeenCalled();
  });
  it("rejects changed configuration", async () => {
    tx.configVersion.findMany.mockResolvedValue([
      { id: "newer", payload: JSON.stringify({ sponsorId: "steel-potatoes" }) },
    ]);
    await expect(activateBenefit("proposal", "reviewer")).rejects.toThrow(
      "Benefits changed",
    );
    expect(tx.agentRun.create).not.toHaveBeenCalled();
  });
  it("rejects resolved proposals and future-clock evidence", async () => {
    tx.agentProposal.findFirst.mockResolvedValue({
      ...proposal(),
      status: "Rejected",
    });
    await expect(activateBenefit("proposal", "reviewer")).rejects.toThrow(
      "no longer",
    );
    tx.agentProposal.findFirst.mockResolvedValue(
      proposal({ ...analysis(), asOf: "2099-01-01" }),
    );
    await expect(activateBenefit("proposal", "reviewer")).rejects.toThrow(
      "future clock",
    );
  });
  it("rechecks limits at activation", async () => {
    const a = analysis();
    a.options[0].membersPayingMore = 1;
    tx.agentProposal.findFirst.mockResolvedValue(proposal(a));
    await expect(activateBenefit("proposal", "reviewer")).rejects.toThrow(
      "No eligible",
    );
    expect(tx.configVersion.create).not.toHaveBeenCalled();
  });
  it("returns an existing applied release without duplicate fanout", async () => {
    tx.agentProposal.findFirst.mockResolvedValue({
      ...proposal(),
      status: "Applied",
    });
    tx.configVersion.findMany.mockResolvedValue([
      {
        id: "existing",
        payload: JSON.stringify({
          proposalId: "proposal",
          effectiveAt: "2026-10-01",
        }),
      },
    ]);
    expect(await activateBenefit("proposal", "reviewer")).toEqual({
      id: "existing",
      effectiveAt: "2026-10-01",
    });
    expect(tx.agentRun.create).not.toHaveBeenCalled();
    expect(tx.configVersion.create).not.toHaveBeenCalled();
  });
});

import { analyzeBenefits } from "@/lib/agents/account-management/service";
import { startRun } from "@/lib/agents/runtime";
import { getTrendOverview } from "@/lib/queries/trends";
it("records work at execution time, even when analyzing historical claims", async () => {
  const finish = vi.fn().mockResolvedValue(undefined);
  vi.mocked(startRun).mockResolvedValue({ id: "record", finish } as never);
  vi.mocked(getTrendOverview).mockResolvedValue(null as never);
  const before = Date.now();
  await expect(
    analyzeBenefits(analysis().goals, "2026-01-01", vi.fn()),
  ).rejects.toThrow("Not enough claims");
  const at = vi.mocked(startRun).mock.calls[0][0].at!;
  expect(at.getTime()).toBeGreaterThanOrEqual(before);
  expect(finish).toHaveBeenCalledWith(
    "Failed",
    expect.stringContaining("Not enough claims"),
  );
});
