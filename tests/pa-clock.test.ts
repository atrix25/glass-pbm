/**
 * The PA queue derives live state from timestamps. Detail pages, member
 * history, and agent tools must hide determinations that have not happened
 * yet at the pin, or a mid-year clock leaks the eventual step and outcome.
 */

import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";
import {
  asOfPriorAuth,
  paDecisionRevealedAsOf,
  paLiveState,
} from "@/lib/pa/status";

describe("prior-auth visibility as of the simulation clock", () => {
  const receivedAt = new Date("2026-03-01T10:00:00.000Z");
  const decidedAt = new Date("2026-03-10T16:00:00.000Z");

  const seeded = {
    receivedAt,
    decisionDueAt: new Date("2026-03-04T10:00:00.000Z"),
    decidedAt,
    prescriberStatementAt: null as Date | null,
    determination: "Approved" as string | null,
    decidedBy: "AI" as string | null,
    decidingStepNumber: 7 as number | null,
    denyReason: null as string | null,
    approvedDays: 365 as number | null,
    approvedEffectiveDate: decidedAt as Date | null,
    approvedTerminationDate: new Date("2027-03-10T00:00:00.000Z") as Date | null,
    status: "Approved",
    decisionSteps: [{ seq: 1 }, { seq: 2 }],
  };

  it("treats a future decidedAt as not yet revealed", () => {
    const midReview = resolveClock("2026-03-05T12:00:00.000Z");
    expect(paDecisionRevealedAsOf(seeded.decidedAt, midReview.now)).toBe(false);

    const live = paLiveState(seeded, midReview.now);
    expect(live.inFlight).toBe(true);
    expect(live.status).toBe("InReview");
  });

  it("strips the eventual determination until decidedAt passes", () => {
    const midReview = resolveClock("2026-03-05T12:00:00.000Z");
    const asOf = asOfPriorAuth(seeded, midReview.now);

    expect(asOf.determination).toBeNull();
    expect(asOf.decidedAt).toBeNull();
    expect(asOf.decidedBy).toBeNull();
    expect(asOf.decidingStepNumber).toBeNull();
    expect(asOf.approvedDays).toBeNull();
    expect(asOf.decisionSteps).toEqual([]);
    expect(asOf.status).toBe("InReview");
  });

  it("reveals the stored determination once the pin passes decidedAt", () => {
    const after = resolveClock("2026-03-11T09:00:00.000Z");
    expect(paDecisionRevealedAsOf(seeded.decidedAt, after.now)).toBe(true);
    expect(asOfPriorAuth(seeded, after.now)).toEqual(seeded);
  });

  it("hides requests that have not been received yet", () => {
    const before = resolveClock("2026-02-15T12:00:00.000Z");
    const live = paLiveState(seeded, before.now);
    expect(live.status).toBe("NotYetReceived");

    const arrived = [seeded].filter(
      (pa) => pa.receivedAt.getTime() <= before.now.getTime(),
    );
    expect(arrived).toHaveLength(0);
  });
});
