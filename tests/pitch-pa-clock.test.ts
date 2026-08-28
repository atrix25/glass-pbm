/**
 * Pitch member beats cut PAs on receivedAt, but must also hide the stored
 * determination until decidedAt. Otherwise pinning during the review window
 * narrates "approved" / "denied" while the live queue still shows in review.
 */

import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";
import { pitchPaOutcomeAsOf } from "@/lib/pitch/experiences";

describe("pitch PA outcome as of the simulation clock", () => {
  // Matches demo seed: David Krueger PA received day 15, decided ~26h later.
  const seeded = {
    determination: "Approved" as string | null,
    decidedAt: new Date("2026-01-17T02:00:00.000Z"),
  };

  it("hides the eventual determination while the request is still open", () => {
    const midReview = resolveClock("2026-01-16T12:00:00.000Z");
    const asOf = pitchPaOutcomeAsOf(seeded, midReview.now);

    expect(asOf.determination).toBeNull();
    expect(asOf.decidedAt).toBeNull();
  });

  it("reveals the stored determination once the pin passes decidedAt", () => {
    const after = resolveClock("2026-01-17T12:00:00.000Z");
    expect(pitchPaOutcomeAsOf(seeded, after.now)).toEqual(seeded);
  });

  it("keeps escalated requests (no decidedAt) in review", () => {
    const yearEnd = resolveClock("2026-12-15T12:00:00.000Z");
    const escalated = {
      determination: "Escalated" as string | null,
      decidedAt: null as Date | null,
    };
    expect(pitchPaOutcomeAsOf(escalated, yearEnd.now)).toEqual({
      determination: null,
      decidedAt: null,
    });
  });
});
