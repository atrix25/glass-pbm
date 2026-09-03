import { describe, expect, it } from "vitest";
import { claimIdsReversedAsOf } from "@/lib/engine/reversed-fills";
import { buildOopCurve } from "@/lib/queries/members";

describe("claimIdsReversedAsOf", () => {
  const day = (month: number, dayOfMonth: number) =>
    new Date(Date.UTC(2026, month - 1, dayOfMonth));

  it("drops B1s whose B2 has already posted", () => {
    const ids = claimIdsReversedAsOf(
      [
        { reversalOfClaimId: "b1-a", adjudicatedAt: day(3, 10) },
        { reversalOfClaimId: "b1-b", adjudicatedAt: day(6, 1) },
        { reversalOfClaimId: null, adjudicatedAt: day(3, 10) },
      ],
      day(4, 1),
    );
    expect(ids).toEqual(["b1-a"]);
  });

  it("keeps a fill until its reversal posts", () => {
    const ids = claimIdsReversedAsOf(
      [{ reversalOfClaimId: "b1-a", adjudicatedAt: day(6, 1) }],
      day(4, 1),
    );
    expect(ids).toEqual([]);
  });
});

describe("buildOopCurve excludes reversed fills", () => {
  it("does not accumulate patient pay from isReversed rows", () => {
    const curve = buildOopCurve([
      {
        dateOfService: new Date("2026-01-15T00:00:00Z"),
        patientPayCents: 5_00,
        formularyLevel: "1",
        responseStatus: "P",
        isReversed: false,
      },
      {
        dateOfService: new Date("2026-02-15T00:00:00Z"),
        patientPayCents: 50_00,
        formularyLevel: "2",
        responseStatus: "P",
        isReversed: true,
      },
      {
        dateOfService: new Date("2026-03-15T00:00:00Z"),
        patientPayCents: 5_00,
        formularyLevel: "1",
        responseStatus: "P",
      },
    ]);
    expect(curve).toHaveLength(2);
    expect(curve[0]!.rxOopCents).toBe(5_00);
    expect(curve[1]!.rxOopCents).toBe(10_00);
    expect(curve[1]!.federalOopCents).toBe(10_00);
  });
});
