/**
 * Integrity overview must cut signals at the simulation clock. Seeded
 * IntegritySignal rows cover the full plan year; claimsScreened already does
 * not. Reading the table early reports future exposure against a partial book.
 */

import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";
import {
  claimAsOfSql,
  storedIntegritySignalsAreCurrent,
} from "@/lib/integrity/detectors";

describe("integrity as-of clock cut", () => {
  it("embeds the clock instant in detector SQL so future fills cannot score", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    expect(claimAsOfSql(clock.now)).toBe(
      `c.dateOfService <= ${clock.now.getTime()}`,
    );
    expect(claimAsOfSql(clock.now, "claim")).toBe(
      `claim.dateOfService <= ${clock.now.getTime()}`,
    );
    expect(claimAsOfSql(undefined)).toBe("1=1");
  });

  it("rejects stored year-end signals while the clock is still mid-year", () => {
    const midYear = resolveClock("2026-08-18T11:00:00.000Z");
    const yearEndWindow = new Date("2026-12-20T00:00:00.000Z");
    expect(
      storedIntegritySignalsAreCurrent(midYear.now, yearEndWindow),
    ).toBe(false);
  });

  it("allows the seeded table once every stored window has closed", () => {
    const yearEnd = resolveClock("2026-12-31T23:59:59.000Z");
    const lastFill = new Date("2026-12-20T00:00:00.000Z");
    expect(storedIntegritySignalsAreCurrent(yearEnd.now, lastFill)).toBe(true);
  });

  it("forces a re-score when there are no stored windows to trust", () => {
    const clock = resolveClock("2026-08-18T11:00:00.000Z");
    expect(storedIntegritySignalsAreCurrent(clock.now, null)).toBe(false);
  });

  it("does not treat windowEnd <= clock as sufficient without re-score logic", () => {
    /*
     * A subject whose last fill is before the clock can still be shown from
     * storage only when EVERY subject window has closed. A single late-year
     * window means the peer medians and severity ranks in the table were
     * computed with fills the clock has not reached yet.
     */
    const early = resolveClock("2026-03-15T12:00:00.000Z");
    const earlySubjectEnd = new Date("2026-02-01T00:00:00.000Z");
    const lateSubjectEnd = new Date("2026-11-01T00:00:00.000Z");
    expect(
      storedIntegritySignalsAreCurrent(early.now, earlySubjectEnd),
    ).toBe(true);
    expect(
      storedIntegritySignalsAreCurrent(early.now, lateSubjectEnd),
    ).toBe(false);
  });
});
