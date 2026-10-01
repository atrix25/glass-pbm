import { describe, expect, it } from "vitest";
import {
  dayOfPlanYear,
  medicalDeductibleAsOf,
  medicalEncountersFor,
} from "@/lib/accumulators/medical-feed";

describe("medicalEncountersFor", () => {
  it("is deterministic for a member and returns sorted, deductible-bounded encounters", () => {
    const first = medicalEncountersFor("test-member-0", 170_000);
    const second = medicalEncountersFor("test-member-0", 170_000);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.map((e) => e.day)).toEqual(
      [...first.map((e) => e.day)].sort((a, b) => a - b),
    );
    expect(first.reduce((sum, e) => sum + e.amountCents, 0)).toBeLessThanOrEqual(
      170_000,
    );
  });

  it("returns no encounters for a non-positive deductible", () => {
    expect(medicalEncountersFor("test-member-0", 0)).toEqual([]);
    expect(medicalEncountersFor("test-member-0", -1)).toEqual([]);
  });

  it("has deterministic members with no medical deductible spending", () => {
    expect(medicalEncountersFor("test-member-3", 170_000)).toEqual([]);
  });

  it("trims the final encounter rather than dropping it at the deductible", () => {
    const encounters = medicalEncountersFor("test-member-0", 170_000);

    expect(encounters.reduce((sum, e) => sum + e.amountCents, 0)).toBe(170_000);
    expect(encounters).toHaveLength(5);
    expect(encounters.at(-1)?.amountCents).toBe(8_806);
  });
});

describe("medicalDeductibleAsOf", () => {
  it("counts only encounters strictly before the requested day", () => {
    const encounters = [
      { day: 10, amountCents: 100, description: "before" },
      { day: 20, amountCents: 200, description: "same day" },
      { day: 30, amountCents: 300, description: "after" },
    ];

    expect(medicalDeductibleAsOf(encounters, 20)).toBe(100);
  });
});

describe("dayOfPlanYear", () => {
  it("uses UTC day zero and handles leap years", () => {
    expect(dayOfPlanYear(new Date("2024-01-01T00:00:00Z"))).toBe(0);
    expect(dayOfPlanYear(new Date("2024-06-15T12:00:00Z"))).toBe(166);
    expect(dayOfPlanYear(new Date("2024-12-31T23:59:59Z"))).toBe(365);
  });
});
