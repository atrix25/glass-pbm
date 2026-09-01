import { describe, expect, it } from "vitest";
import { claimIdsReversedAsOf } from "@/lib/engine/reversed-fills";

describe("claimIdsReversedAsOf", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("drops fills whose reversal has already posted", () => {
    const ids = claimIdsReversedAsOf(
      [
        { reversalOfClaimId: "b1-early", adjudicatedAt: day("2026-01-10") },
        { reversalOfClaimId: "b1-late", adjudicatedAt: day("2026-03-01") },
      ],
      day("2026-02-01"),
    );
    expect(ids).toEqual(["b1-early"]);
  });

  it("keeps a fill until the reversal posts", () => {
    const ids = claimIdsReversedAsOf(
      [{ reversalOfClaimId: "b1-a", adjudicatedAt: day("2026-01-10") }],
      day("2026-01-09"),
    );
    expect(ids).toEqual([]);
  });

  it("treats a reversal posted on the as-of day as already undone", () => {
    const ids = claimIdsReversedAsOf(
      [{ reversalOfClaimId: "b1-a", adjudicatedAt: day("2026-01-10") }],
      day("2026-01-10"),
    );
    expect(ids).toEqual(["b1-a"]);
  });

  it("ignores orphan reversals with no original", () => {
    const ids = claimIdsReversedAsOf(
      [{ reversalOfClaimId: null, adjudicatedAt: day("2026-01-10") }],
      day("2026-06-01"),
    );
    expect(ids).toEqual([]);
  });
});
