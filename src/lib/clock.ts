/**
 * The simulation clock.
 *
 * The book is seeded across the whole 2026 plan year, but a claim dated next
 * month has not happened yet. "Now" is a cut line through that year: rows on
 * the past side are history, rows on the future side do not exist. Nothing is
 * generated at request time and no job writes rows on a timer — the plan is
 * fully determined in advance and the clock only decides how much of it has
 * come true.
 *
 * That buys three things a background generator would not. The book advances
 * on its own, one simulated day per real day, with no infrastructure. Any
 * moment is reproducible, because pinning the clock to a timestamp reproduces
 * exactly what was on screen then. And a prior authorization's state stops
 * being a stored flag: a request received four hours ago against a seventy-two
 * hour standard is in review with sixty-eight hours left, and it becomes a
 * decision at the moment its decision time passes, whether or not anyone is
 * watching.
 *
 * This module is client-safe. The server-side accessor that reads the pin
 * cookie lives in session.ts, for the same reason the role helpers do.
 */

export const PLAN_YEAR = 2026;

export const PLAN_YEAR_START = new Date(Date.UTC(PLAN_YEAR, 0, 1, 0, 0, 0, 0));
export const PLAN_YEAR_END = new Date(
  Date.UTC(PLAN_YEAR, 11, 31, 23, 59, 59, 999),
);

/** Cookie holding an ISO instant when the clock is pinned rather than live. */
export const CLOCK_COOKIE = "glass_clock";

export const DAY_MS = 86_400_000;

/**
 * Keep the clock inside the seeded year.
 *
 * Before the year starts there is no book to show, and after it ends the
 * demo would present a finished year as though it were live. Both ends clamp.
 */
export function clampToPlanYear(instant: Date): Date {
  const t = instant.getTime();
  if (t < PLAN_YEAR_START.getTime()) return new Date(PLAN_YEAR_START);
  if (t > PLAN_YEAR_END.getTime()) return new Date(PLAN_YEAR_END);
  return instant;
}

/** Resolve a clock from a pin value, falling back to the real clock. */
export function resolveClock(pinned: string | null | undefined): SimulationClock {
  if (pinned) {
    const parsed = new Date(pinned);
    if (!Number.isNaN(parsed.getTime())) {
      return buildClock(clampToPlanYear(parsed), true);
    }
  }
  return buildClock(clampToPlanYear(new Date()), false);
}

export interface SimulationClock {
  /** The current simulated instant. */
  now: Date;
  /** Midnight UTC on the current simulated day. */
  today: Date;
  /** The first instant of tomorrow, i.e. the exclusive end of today. */
  tomorrow: Date;
  /** True when the clock has been pinned rather than tracking real time. */
  pinned: boolean;
  /** Days elapsed since the plan year began, 1 on January 1st. */
  dayOfPlanYear: number;
  /** Fraction of the plan year elapsed, used to pro-rate annual guarantees. */
  yearElapsed: number;
}

function buildClock(now: Date, pinned: boolean): SimulationClock {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const elapsedMs = now.getTime() - PLAN_YEAR_START.getTime();
  const totalMs = PLAN_YEAR_END.getTime() - PLAN_YEAR_START.getTime();
  return {
    now,
    today,
    tomorrow: new Date(today.getTime() + DAY_MS),
    pinned,
    dayOfPlanYear: Math.floor(elapsedMs / DAY_MS) + 1,
    yearElapsed: Math.min(1, Math.max(0, elapsedMs / totalMs)),
  };
}

/** Offsets the on-stage clock control can jump to. */
export const CLOCK_JUMPS: Array<{ label: string; days: number }> = [
  { label: "+1 day", days: 1 },
  { label: "+1 week", days: 7 },
  { label: "+1 month", days: 30 },
];

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}
