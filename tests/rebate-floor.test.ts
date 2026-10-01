import { describe, expect, it } from "vitest";
import {
  computeBrandRebateFloor,
  minRebateFloorForChannel,
} from "@/lib/contracts/rebate-floor";

describe("computeBrandRebateFloor", () => {
  it("uses Exhibit C per-channel floors, not retail alone", () => {
    expect(minRebateFloorForChannel("Retail")).toBe(10_000);
    expect(minRebateFloorForChannel("Retail90")).toBe(21_000);
    expect(minRebateFloorForChannel("Mail")).toBe(26_000);
    expect(minRebateFloorForChannel("Specialty")).toBe(75_000);

    // 1,000 retail @ $100 + 100 specialty @ $750 = $100k + $75k = $175k.
    // The bug multiplied all 1,100 brand claims by retail $100 → $110k and
    // would report a $150k book as "met" when it is $25k short of the floor.
    const floor = computeBrandRebateFloor([
      { channel: "Retail", claims: 1_000 },
      { channel: "Specialty", claims: 100 },
    ]);

    expect(floor.brandClaims).toBe(1_100);
    expect(floor.minGuaranteeCents).toBe(17_500_000);
    expect(floor.blendedFloorPerClaimCents).toBe(
      Math.round(17_500_000 / 1_100),
    );

    const buggyRetailOnlyFloor = 1_100 * 10_000;
    expect(buggyRetailOnlyFloor).toBe(11_000_000);
    expect(floor.minGuaranteeCents).toBeGreaterThan(buggyRetailOnlyFloor);

    const grossRebateCents = 15_000_000;
    expect(grossRebateCents >= buggyRetailOnlyFloor).toBe(true);
    expect(grossRebateCents >= floor.minGuaranteeCents).toBe(false);
  });

  it("ignores zero-claim channels and unknown channels without a floor", () => {
    const floor = computeBrandRebateFloor([
      { channel: "Retail", claims: 10 },
      { channel: "Mail", claims: 0 },
      { channel: "Unknown", claims: 5 },
    ]);
    expect(floor.brandClaims).toBe(15);
    expect(floor.minGuaranteeCents).toBe(10 * 10_000);
  });

  it("weights retail-90 and mail above retail", () => {
    const floor = computeBrandRebateFloor([
      { channel: "Retail90", claims: 2 },
      { channel: "Mail", claims: 2 },
    ]);
    expect(floor.minGuaranteeCents).toBe(2 * 21_000 + 2 * 26_000);
    expect(floor.blendedFloorPerClaimCents).toBe(
      Math.round((2 * 21_000 + 2 * 26_000) / 4),
    );
  });
});
