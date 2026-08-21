/**
 * Eligibility audit recoverable dollars must use the same DOS cut as the
 * reversals recovery worklist. Audits that have already processed can still
 * join future post-termination fills in the seeded book; counting those as
 * recoverable while the clock is mid-year overstates exposure on /eligibility.
 */

import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";

/** Mirrors the exposure predicate in getAuditFindings / getRecoveryOverview. */
function countsTowardRecoverable(
  dateOfService: Date,
  reportedTerminationDate: Date,
  asOf: Date,
): boolean {
  return (
    dateOfService.getTime() > reportedTerminationDate.getTime() &&
    dateOfService.getTime() <= asOf.getTime()
  );
}

describe("eligibility audit exposure as of the simulation clock", () => {
  const termination = new Date("2026-01-31T00:00:00.000Z");
  const fills = [
    new Date("2026-02-15T00:00:00.000Z"),
    new Date("2026-06-01T00:00:00.000Z"),
    new Date("2026-11-01T00:00:00.000Z"),
  ];

  it("excludes post-termination fills that have not happened yet", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    const visible = fills.filter((dos) =>
      countsTowardRecoverable(dos, termination, clock.now),
    );
    expect(visible).toEqual([fills[0]]);
  });

  it("includes later fills once the pin advances past them", () => {
    const clock = resolveClock("2026-12-01T12:00:00.000Z");
    const visible = fills.filter((dos) =>
      countsTowardRecoverable(dos, termination, clock.now),
    );
    expect(visible).toHaveLength(3);
  });

  it("never counts a fill on or before the reported termination", () => {
    const clock = resolveClock("2026-12-31T23:59:59.000Z");
    expect(
      countsTowardRecoverable(termination, termination, clock.now),
    ).toBe(false);
    expect(
      countsTowardRecoverable(
        new Date("2026-01-15T00:00:00.000Z"),
        termination,
        clock.now,
      ),
    ).toBe(false);
  });
});
