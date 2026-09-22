import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluate,
  rank,
  mergeBenefit,
  patchEntry,
  GoalsSchema,
  type Option,
} from "@/lib/agents/account-management/model";
const db = vi.hoisted(() => ({ configVersion: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
import { latestRelease, activeEntries } from "@/lib/benefit-release";
const goals = {
  savingCents: 10000,
  maxAffectedMembers: 50,
  maxMembersPayingMore: 0,
  maxNewRejects: 0,
};
const option = (patch: Partial<Option> = {}): Option => ({
  id: "a",
  name: "A",
  override: { formulary: [] },
  planSavingCents: 20000,
  memberShiftCents: 0,
  netSavingCents: 20000,
  affectedMembers: 10,
  membersPayingMore: 0,
  newRejects: 0,
  claimsEvaluated: 100,
  reasons: [],
  ...patch,
});
describe("benefit goals and member disruption", () => {
  it("prefers fewer members over greater savings once the goal is met", () => {
    expect(
      rank(
        [
          option({ id: "larger", planSavingCents: 50000, affectedMembers: 20 }),
          option({ id: "smaller" }),
        ],
        goals,
      )[0].id,
    ).toBe("smaller");
  });
  it("does not prefer an ineligible option with fewer affected members", () => {
    expect(
      rank(
        [option({ id: "bad", affectedMembers: 1, newRejects: 1 }), option()],
        goals,
      )[0].id,
    ).toBe("a");
  });
  it("rejects cost transfer and each breached limit independently", () => {
    expect(
      evaluate(
        option({
          planSavingCents: 1,
          netSavingCents: 0,
          affectedMembers: 51,
          membersPayingMore: 1,
          newRejects: 1,
        }),
        goals,
      ).reasons,
    ).toHaveLength(5);
  });
  it("retains explicit caller limits and stable ordering", () => {
    expect(
      rank([option({ id: "b" }), option({ id: "a" })], goals).map((o) => o.id),
    ).toEqual(["a", "b"]);
    expect(
      GoalsSchema.safeParse({ ...goals, maxMembersPayingMore: -1 }).success,
    ).toBe(false);
  });
  it("uses full member counts, including beyond the 25-row display sample", () => {
    expect(
      evaluate(option({ affectedMembers: 100, membersPayingMore: 30 }), goals)
        .reasons,
    ).toEqual(["Member impact limit exceeded", "Out-of-pocket limit exceeded"]);
  });
  it("merges cumulative releases without mutating the filed entry", () => {
    const base = { formulary: [{ drugId: "one", requiresPA: true }] };
    const next = mergeBenefit(base, { drugId: "one", level: "3" });
    const entry = { drugId: "one", level: "1", requiresPA: false };
    expect(patchEntry(entry, "one", next)).toMatchObject({
      level: "3",
      requiresPA: true,
    });
    expect(entry.level).toBe("1");
    expect(base.formulary[0]).toEqual({ drugId: "one", requiresPA: true });
    expect(patchEntry(entry, "other", next)).toBe(entry);
  });
});
describe("effective benefit configuration", () => {
  beforeEach(() => db.configVersion.findMany.mockReset());
  const row = (
    id: string,
    effectiveAt: string,
    sponsorId = "steel-potatoes",
  ) => ({
    id,
    createdBy: "Recorded reviewer",
    payload: JSON.stringify({
      sponsorId,
      effectiveAt,
      proposalId: "p",
      benefit: { formulary: [{ drugId: "one", level: "3" }] },
    }),
  });
  it("keeps future releases and other sponsors out of current coverage", async () => {
    db.configVersion.findMany.mockResolvedValue([
      row("foreign", "2026-01-01", "other"),
      row("future", "2026-10-01"),
      row("active", "2026-09-01"),
    ]);
    expect((await latestRelease(new Date("2026-09-20")))?.id).toBe("active");
  });
  it("takes effect exactly at the release boundary", async () => {
    db.configVersion.findMany.mockResolvedValue([
      row("active", "2026-09-21T00:00:00Z"),
    ]);
    expect(await latestRelease(new Date("2026-09-20T23:59:59Z"))).toBeNull();
    expect((await latestRelease(new Date("2026-09-21T00:00:00Z")))?.id).toBe(
      "active",
    );
  });
  it("overlays exact products and preserves the baseline", async () => {
    db.configVersion.findMany.mockResolvedValue([row("active", "2026-09-01")]);
    const entries = [
      { drugId: "one", level: "1" },
      { drugId: "two", level: "2" },
    ];
    expect(await activeEntries(entries, new Date("2026-09-20"))).toEqual([
      { drugId: "one", level: "3" },
      { drugId: "two", level: "2" },
    ]);
    expect(entries[0].level).toBe("1");
  });
});

import { adjudicate } from "@/lib/engine/adjudicate";
import { drug, entry, makeContext } from "./fixtures";
describe("benefit release consumption", () => {
  it("changes the engine decision only for the released product", () => {
    const d = drug();
    const filed = entry();
    const benefit = { formulary: [{ drugId: d.id, requiresStep: true }] };
    const before = adjudicate(makeContext({ drug: d, formularyEntry: filed }));
    const after = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: patchEntry(filed, d.id, benefit),
      }),
    );
    expect(before.responseStatus).toBe("P");
    expect(after.responseStatus).toBe("R");
    expect(after.rejectCodes).toContain("608");
    expect(filed.requiresStep).toBe(false);
  });
});
