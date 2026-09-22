import { describe, expect, it } from "vitest";
import { memberMonthsByMonth, sponsorCosts } from "@/lib/sponsor-metrics";
import { calculateGuaranteePosition, type GuaranteeBucket } from "@/lib/guarantee-position";

const bucket: GuaranteeBucket = { channel: "Retail", drugClass: "Brand", count: 10, awpCents: 100000, ingredientCents: 80000, feeCents: 1000, rebateCents: 20000, discountBps: 1800, feeTargetCents: 100, rebateTargetCents: 1900, discountEligible: true, rebateEligible: true, missingAwp: 0, simulatedAwp: 0, citation: null };
describe("sponsor measures", () => {
  it("merges overlapping eligibility and counts inclusive terminations", () => {
    const months = memberMonthsByMonth([
      { memberId: "a", effectiveDate: new Date("2026-01-01"), terminationDate: new Date("2026-01-20") },
      { memberId: "a", effectiveDate: new Date("2026-01-10"), terminationDate: null },
      { memberId: "b", effectiveDate: new Date("2026-01-16"), terminationDate: new Date("2026-01-31") },
    ], 2026, new Date("2026-02-14"));
    expect(months[0]).toBeCloseTo(1 + 16 / 31);
    expect(months[1]).toBeCloseTo(0.5);
    expect(months[2]).toBe(0);
  });
  it("includes fees, preserves signed adjustments and avoids zero-denominator rates", () => {
    expect(sponsorCosts(10000, 2000, 10, 250)).toEqual({ feesCents: 2500, netCents: 10500, pmpmCents: 1050 });
    expect(sponsorCosts(-1000, -200, 0, 250)).toEqual({ feesCents: 0, netCents: -800, pmpmCents: null });
  });
});
describe("continuous guarantee position", () => {
  it("weights discount by AWP and rebate by eligible prescriptions", () => {
    const [discount, rebate] = calculateGuaranteePosition([bucket, { ...bucket, count: 30, awpCents: 300000, ingredientCents: 180000, discountBps: 4000, rebateCents: 30000, rebateTargetCents: 1000 }]);
    expect(discount.target).toBeCloseTo(34.5);
    expect(discount.actual).toBeCloseTo(35);
    expect(rebate.target).toBe(1225);
    expect(rebate.actual).toBe(1250);
  });
  it("treats dispensing fees as a ceiling and rebates as a floor", () => {
    const [, rebate, fee] = calculateGuaranteePosition([{ ...bucket, feeCents: 1500, rebateCents: 18000 }]);
    expect(fee.gap).toBe(-50);
    expect(fee.shortfallCents).toBe(500);
    expect(rebate.shortfallCents).toBe(1000);
  });
  it("does not turn missing benchmarks or terms into a passing result", () => {
    const [discount, rebate] = calculateGuaranteePosition([{ ...bucket, missingAwp: 1, rebateTargetCents: null }]);
    expect(discount.actual).toBeNull();
    expect(rebate.status).toBe("Data needed");
    expect(discount.shortfallCents).toBeNull();
  });
  it("excludes ineligible claims and distinguishes no volume", () => {
    const [discount, rebate] = calculateGuaranteePosition([{ ...bucket, discountEligible: false, rebateEligible: false }]);
    expect(discount.status).toBe("No volume");
    expect(rebate.actual).toBeNull();
    expect(calculateGuaranteePosition([])[0].target).toBeNull();
  });
});
