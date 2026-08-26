/**
 * refillEligibility must answer against the simulation clock. A mid-year pin
 * that still sees December 79-rejects (and wall-clock eligibleNow) tells the
 * member agent a future rejection already happened and that a refill is due
 * months early.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";
import { computeRefillWindow } from "@/lib/agent/refill-timing";

describe("computeRefillWindow against the simulation clock", () => {
  const lastFilled = new Date("2026-02-01T00:00:00.000Z");
  const daysSupply = 30;
  // 75% of 30 = 23 days → eligible 2026-02-24

  it("reports not yet eligible when the pin is still inside the supply window", () => {
    const clock = resolveClock("2026-02-10T12:00:00.000Z");
    const w = computeRefillWindow(lastFilled, daysSupply, clock.now);
    expect(w.eligibleForRefillOn).toBe("2026-02-24");
    expect(w.eligibleNow).toBe(false);
    expect(w.daysToWait).toBeGreaterThan(0);
  });

  it("reports eligible once the pin passes the 75% date", () => {
    const clock = resolveClock("2026-03-01T12:00:00.000Z");
    const w = computeRefillWindow(lastFilled, daysSupply, clock.now);
    expect(w.eligibleForRefillOn).toBe("2026-02-24");
    expect(w.eligibleNow).toBe(true);
    expect(w.daysToWait).toBe(0);
  });

  it("does not use wall time: early pin stays ineligible even if real today is later", () => {
    const early = resolveClock("2026-02-10T12:00:00.000Z");
    const wall = new Date("2026-08-26T12:00:00.000Z");
    const againstPin = computeRefillWindow(lastFilled, daysSupply, early.now);
    const againstWall = computeRefillWindow(lastFilled, daysSupply, wall);
    expect(againstPin.eligibleNow).toBe(false);
    expect(againstWall.eligibleNow).toBe(true);
    expect(againstPin.eligibleNow).not.toBe(againstWall.eligibleNow);
  });
});

describe("refillEligibility wiring", () => {
  it("cuts 79 rejects and eligibility against getClock, not wall new Date()", () => {
    const source = readFileSync("src/lib/agent/tools.ts", "utf8");
    const start = source.indexOf("export async function refillEligibility");
    const end = source.indexOf("export const findPharmaciesSchema", start);
    const fn = source.slice(start, end);
    expect(fn).toContain("getClock");
    expect(fn).toContain("clock.today");
    expect(fn).toContain("clock.now");
    expect(fn).toContain("computeRefillWindow");
    expect(fn).toContain('dateOfService: { lte: clock.today }');
    expect(fn).not.toMatch(/const now = new Date\(\)/);
  });
});
