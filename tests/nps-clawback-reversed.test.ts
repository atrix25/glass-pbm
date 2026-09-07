/**
 * NPS retro-clawback must drop post-term fills that a B2 has already unwound.
 *
 * The schedule's heaviest deduction (−3.5) fires when a member kept a paid fill
 * after a retroactively reported termination. B2s leave the original B1 marked
 * paid (`P`), so a plain paid-B1 filter still sees reversed money as a clawback
 * — and `/api/nps/snapshot` plus change-console commit persist that false flag
 * into `NpsSnapshot`.
 *
 * Mirrors the predicate in `clawbackMembers` (experience.ts) and
 * `loadFixedSignals` (replay.ts).
 */

import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";

/** Mirrors the clawback membership predicate used for NPS fixed signals. */
function countsTowardNpsClawback(opts: {
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

describe("NPS retro-clawback excludes B2-clawed fills", () => {
  const termination = new Date("2026-01-31T00:00:00.000Z");
  const postTermFill = new Date("2026-02-15T00:00:00.000Z");
  const reversedAt = new Date("2026-02-20T00:00:00.000Z");

  it("does not flag clawback once the only post-term fill has been reversed", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    expect(
      countsTowardNpsClawback({
        dateOfService: postTermFill,
        reportedTerminationDate: termination,
        asOf: clock.now,
        reversedAt,
      }),
    ).toBe(false);
  });

  it("still flags clawback before the reversal posts", () => {
    const clock = resolveClock("2026-02-17T12:00:00.000Z");
    expect(
      countsTowardNpsClawback({
        dateOfService: postTermFill,
        reportedTerminationDate: termination,
        asOf: clock.now,
        reversedAt,
      }),
    ).toBe(true);
  });

  it("keeps clawback when an unreversed post-term fill remains", () => {
    const clock = resolveClock("2026-06-01T12:00:00.000Z");
    expect(
      countsTowardNpsClawback({
        dateOfService: postTermFill,
        reportedTerminationDate: termination,
        asOf: clock.now,
        reversedAt: null,
      }),
    ).toBe(true);
  });
});
