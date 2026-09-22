import { describe, expect, it } from "vitest";
import { rebateSensitivity, type RebatePeriod } from "@/lib/rebate-position";

const period: RebatePeriod = { id: "q1", label: "Q1", closed: true, claims: 10, estimatedCents: 10000, floorCents: 10000 };
describe("rebate sensitivity", () => {
  it("shows a range around accrual rather than declaring the floor met", () => {
    expect(rebateSensitivity(period, 5)).toMatchObject({ lowCents: 9500, highCents: 10500, rateCents: 1000, lowRateCents: 950, highRateCents: 1050, floorRateCents: 1000, position: "Range includes floor" });
  });
  it("distinguishes a range above or below the floor", () => {
    expect(rebateSensitivity({ ...period, floorCents: 11000 }, 5).position).toBe("Range below floor");
    expect(rebateSensitivity({ ...period, floorCents: 8000 }, 5).position).toBe("Range above floor");
  });
  it("does not fabricate a guarantee when terms or volume are missing", () => {
    expect(rebateSensitivity({ ...period, floorCents: null }, 5).position).toBe("Contract terms needed");
    expect(rebateSensitivity({ ...period, claims: 0, estimatedCents: 0 }, 5)).toMatchObject({ rateCents: null, floorRateCents: null, position: "No volume" });
  });
  it("keeps closed periods provisional and rejects invalid assumptions", () => {
    expect(rebateSensitivity(period, 10)).toEqual(rebateSensitivity({ ...period, closed: false }, 10));
    for (const v of [-1, 101, NaN]) expect(() => rebateSensitivity(period, v)).toThrow(RangeError);
  });
});
