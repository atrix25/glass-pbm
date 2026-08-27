/**
 * BookDay refresh must match the seed / invariant contract. A wrong primary
 * key or an unfiltered Claim scan silently corrupts every dashboard that
 * reads the daily rollup.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafe = vi.fn();
const bookDayUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    bookDay: { upsert: (...args: unknown[]) => bookDayUpsert(...args) },
  },
}));

vi.mock("@/lib/config", () => ({
  tenantSponsorId: () => "sponsor-test",
}));

describe("bookDayRollupId", () => {
  it("matches the seed primary-key scheme", async () => {
    const { bookDayRollupId } = await import("@/lib/rollups");
    expect(bookDayRollupId(new Date("2026-03-15T00:00:00.000Z"))).toBe(
      "day-2026-03-15",
    );
  });
});

describe("refreshBookDayRollups", () => {
  beforeEach(() => {
    queryRawUnsafe.mockReset();
    bookDayUpsert.mockReset();
    bookDayUpsert.mockResolvedValue({});
  });

  it("scans only untagged claims and upserts day-YYYY-MM-DD rows with reversals", async () => {
    const day = new Date("2026-06-01T00:00:00.000Z");
    queryRawUnsafe.mockResolvedValue([
      {
        day,
        claimsSubmitted: 10n,
        claimsPaid: 8n,
        claimsRejected: 2n,
        totalBilledCents: 1000n,
        planPaidCents: 700n,
        patientPayCents: 300n,
        pharmacyPaidCents: 650n,
        estimatedRebateCents: 40n,
        genericClaims: 5n,
        brandClaims: 3n,
        specialtyClaims: 1n,
        specialtyBilledCents: 200n,
        mailClaims: 2n,
        retailClaims: 5n,
        retail90Claims: 1n,
        membersFilling: 7n,
        reversalsProcessed: 1n,
        reversalBilledCents: -50n,
        reversalPlanPaidCents: -30n,
        reversalPatientPayCents: -20n,
        reversalRebateCents: -2n,
      },
    ]);

    const { refreshBookDayRollups } = await import("@/lib/rollups");
    const result = await refreshBookDayRollups();

    expect(result.days).toBe(1);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = String(queryRawUnsafe.mock.calls[0]![0]);
    expect(sql).toContain('"scenarioTag" IS NULL');
    expect(sql).toContain("\"transactionCode\" = 'B1'");
    expect(sql).toContain("\"transactionCode\" = 'B2'");
    expect(sql).toContain('"reversalsProcessed"');
    // Rejects and reversals must not inflate channel mix.
    expect(sql).toMatch(
      /"transactionCode" = 'B1' AND "responseStatus" = 'P' AND "channel" = 'Mail'/,
    );

    expect(bookDayUpsert).toHaveBeenCalledWith({
      where: { id: "day-2026-06-01" },
      create: expect.objectContaining({
        id: "day-2026-06-01",
        sponsorId: "sponsor-test",
        claimsSubmitted: 10,
        claimsPaid: 8,
        reversalsProcessed: 1,
        reversalBilledCents: -50,
        mailClaims: 2,
      }),
      update: expect.objectContaining({
        claimsSubmitted: 10,
        reversalsProcessed: 1,
        reversalPlanPaidCents: -30,
      }),
    });
  });
});
