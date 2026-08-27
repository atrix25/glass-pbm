/**
 * The PA-intake demo must honour the simulation clock: future chart notes
 * are not pickable, and stored determinations stay hidden until decidedAt.
 */

import { describe, expect, it } from "vitest";
import {
  intakeOnFileAsOf,
  paDecisionRevealedAsOf,
} from "@/lib/pa/status";

const NOW = new Date("2026-01-16T12:00:00.000Z");

describe("paDecisionRevealedAsOf", () => {
  it("hides a determination whose decidedAt is still in the future", () => {
    expect(
      paDecisionRevealedAsOf(new Date("2026-01-17T14:00:00.000Z"), NOW),
    ).toBe(false);
  });

  it("reveals a determination at or before the pin", () => {
    expect(
      paDecisionRevealedAsOf(new Date("2026-01-16T12:00:00.000Z"), NOW),
    ).toBe(true);
    expect(
      paDecisionRevealedAsOf(new Date("2026-01-15T08:00:00.000Z"), NOW),
    ).toBe(true);
  });

  it("treats a null decidedAt as not yet revealed", () => {
    expect(paDecisionRevealedAsOf(null, NOW)).toBe(false);
    expect(paDecisionRevealedAsOf(undefined, NOW)).toBe(false);
  });
});

describe("intakeOnFileAsOf", () => {
  const decided = {
    determination: "Approved",
    decidingStepNumber: 3,
    decidedBy: "pa-intake",
    decidedAt: new Date("2026-01-17T14:00:00.000Z"),
  };

  it("returns nulls while the decision is still ahead of the pin", () => {
    expect(intakeOnFileAsOf(decided, NOW)).toEqual({
      determination: null,
      decidingStep: null,
      decidedBy: null,
    });
  });

  it("returns the stored outcome once decidedAt has passed", () => {
    const later = new Date("2026-01-18T00:00:00.000Z");
    expect(intakeOnFileAsOf(decided, later)).toEqual({
      determination: "Approved",
      decidingStep: 3,
      decidedBy: "pa-intake",
    });
  });
});
