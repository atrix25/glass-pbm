/**
 * Change-console / worker replay must cut at the simulation clock.
 *
 * The engine already accepts `asOf`; the bug was that `/api/replay` and the
 * worker never passed it, so a mid-year pin repriced the rest of the seeded
 * year and invented plan/member deltas. These tests lock the payload helper
 * the worker uses when resolving that cut.
 */

import { describe, expect, it } from "vitest";
import { PLAN_YEAR_END, PLAN_YEAR_START } from "@/lib/clock";
import { resolveReplayAsOf } from "@/lib/engine/replay";

describe("resolveReplayAsOf", () => {
  it("prefers the stamped simulation instant from the job payload", () => {
    const stamped = "2026-06-15T12:00:00.000Z";
    const cut = resolveReplayAsOf(stamped, PLAN_YEAR_END);
    expect(cut.toISOString()).toBe(new Date(stamped).toISOString());
  });

  it("falls back to clamped wall time, never the plan-year end", () => {
    const wall = new Date("2026-03-01T08:00:00.000Z");
    const cut = resolveReplayAsOf(undefined, wall);
    expect(cut.getTime()).toBe(wall.getTime());
    expect(cut.getTime()).toBeLessThan(PLAN_YEAR_END.getTime());
  });

  it("rejects unparseable stamps and clamps out-of-year values", () => {
    const wall = new Date("2026-04-01T00:00:00.000Z");
    expect(resolveReplayAsOf("not-a-date", wall).getTime()).toBe(wall.getTime());
    expect(resolveReplayAsOf("2025-06-01T00:00:00.000Z", wall).getTime()).toBe(
      PLAN_YEAR_START.getTime(),
    );
  });
});
