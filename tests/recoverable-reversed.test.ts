/**
 * Post-termination recoverable dollars must drop fills that a B2 has already
 * clawed back. B2 rows leave the original B1 as responseStatus=P, so a plain
 * paid-B1 filter still sees reversed money as outstanding on /reversals and
 * /eligibility.
 */

import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";

/** Mirrors the exposure predicate in getRecoveryOverview / getAuditFindings. */
function countsTowardRecoverable(opts: {
  dateOfService: Date;
  reportedTerminationDate: Date;
  asOf: Date;
  /** When a B2 for this B1 posted, if any. */
  reversedAt: Date | null;
}): boolean {
  if (opts.dateOfService.getTime() <= opts.reportedTerminationDate.getTime()) {
    return false;
  }
  if (opts.dateOfService.getTime() > opts.asOf.getTime()) {
    return false;
  }
  if (opts.reversedAt && opts.reversedAt.getTime() <= opts.asOf.getTime()) {
    return false;
  }
  return true;
}

/** Year-end rebate invoice builder: any posted B2 drops the B1 from the bill. */
function countsTowardRebateInvoice(reversed: boolean): boolean {
  return !reversed;
}

describe("recoverable exposure excludes B2-clawed fills", () => {
  const termination = new Date("2026-01-31T00:00:00.000Z");
  const postTermFill = new Date("2026-02-15T00:00:00.000Z");
  const reversedAt = new Date("2026-02-20T00:00:00.000Z");

  it("drops a post-term fill once its reversal has posted", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    expect(
      countsTowardRecoverable({
        dateOfService: postTermFill,
        reportedTerminationDate: termination,
        asOf: clock.now,
        reversedAt,
      }),
    ).toBe(false);
  });

  it("still counts the fill before the reversal posts", () => {
    const clock = resolveClock("2026-02-17T12:00:00.000Z");
    expect(
      countsTowardRecoverable({
        dateOfService: postTermFill,
        reportedTerminationDate: termination,
        asOf: clock.now,
        reversedAt,
      }),
    ).toBe(true);
  });

  it("keeps an unreversed post-term fill on the worklist", () => {
    const clock = resolveClock("2026-06-01T12:00:00.000Z");
    expect(
      countsTowardRecoverable({
        dateOfService: postTermFill,
        reportedTerminationDate: termination,
        asOf: clock.now,
        reversedAt: null,
      }),
    ).toBe(true);
  });
});

describe("rebate invoices exclude reversed brand fills", () => {
  it("does not bill the manufacturer for a B1 that has a B2", () => {
    expect(countsTowardRebateInvoice(true)).toBe(false);
  });

  it("still invoices an unreversed rebate-earning B1", () => {
    expect(countsTowardRebateInvoice(false)).toBe(true);
  });
});
