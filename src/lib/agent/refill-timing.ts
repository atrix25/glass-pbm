/**
 * Pure refill-timing math for the member-service agent.
 *
 * Kept free of Next/server imports so unit tests can lock the clock behavior
 * without loading Prisma or `server-only`.
 */

export function computeRefillWindow(
  lastFilled: Date,
  daysSupply: number,
  asOf: Date,
  threshold = 0.75,
): {
  thresholdPercent: number;
  eligibleForRefillOn: string;
  eligibleNow: boolean;
  daysToWait: number;
} {
  const requiredDays = Math.ceil(daysSupply * threshold);
  const eligible = new Date(
    lastFilled.getTime() + requiredDays * 86_400_000,
  );
  return {
    thresholdPercent: threshold * 100,
    eligibleForRefillOn: eligible.toISOString().slice(0, 10),
    eligibleNow: asOf.getTime() >= eligible.getTime(),
    daysToWait: Math.max(
      0,
      Math.ceil((eligible.getTime() - asOf.getTime()) / 86_400_000),
    ),
  };
}
