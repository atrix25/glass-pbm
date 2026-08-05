/**
 * What the engine measured, and what it implies.
 *
 * Every number here comes from a benchmark row written by
 * scripts/benchmark-throughput.ts on named hardware. Nothing is projected from
 * a vendor datasheet, and the comparisons below are arithmetic on the measured
 * rate rather than a claim about what the software could do if it were faster.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { PLAN_YEAR_START } from "@/lib/clock";

export interface RunSummary {
  kind: string;
  ranAt: Date;
  sample: number;
  elapsedMs: number;
  claimsPerSecond: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  p999Ms: number;
  maxMs: number;
  histogram: { upperMs: number; count: number }[];
  machine: string;
  cores: number;
  memoryGb: number;
  runtime: string;
  notes: string;
}

export interface ThroughputOverview {
  adjudication: RunSummary | null;
  pointOfSale: RunSummary | null;
  /** The book's own volume, to put the rate against something real. */
  claimsThisYear: number;
  busiestDay: { date: Date; claims: number } | null;
  /** Seconds of single-threaded work the busiest day represents. */
  busiestDaySeconds: number;
  /** Seconds to re-adjudicate the entire plan year, single threaded. */
  wholeYearSeconds: number;
  /**
   * Every prescription dispensed in the United States in a year, against this
   * rate. Roughly 6.9 billion, per IQVIA's 2024 use-of-medicines report.
   */
  nationalScripts: number;
  nationalHours: number;
  /**
   * How many times over the engine could absorb the busiest day's arrival
   * rate, assuming the day's fills land across a fourteen-hour pharmacy day.
   */
  peakHeadroom: number;
  members: number;
}

const NATIONAL_SCRIPTS = 6_900_000_000;

function toSummary(row: {
  kind: string;
  ranAt: Date;
  sample: number;
  elapsedMs: number;
  claimsPerSecond: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  p999Ms: number;
  maxMs: number;
  histogram: string;
  machine: string;
  cores: number;
  memoryGb: number;
  runtime: string;
  notes: string;
}): RunSummary {
  return { ...row, histogram: JSON.parse(row.histogram) };
}

export async function getThroughput(
  clock: SimulationClock,
): Promise<ThroughputOverview> {
  const [runs, claimsThisYear, busiest, members] = await Promise.all([
    prisma.throughputRun.findMany({ orderBy: { ranAt: "desc" } }),
    prisma.claim.count({
      where: { transactionCode: "B1", dateOfService: { lte: clock.now } },
    }),
    prisma.bookDay.findFirst({
      where: { date: { gte: PLAN_YEAR_START, lte: clock.today } },
      orderBy: { claimsSubmitted: "desc" },
      select: { date: true, claimsSubmitted: true },
    }),
    prisma.member.count(),
  ]);

  const adjudication = runs.find((r) => r.kind === "Adjudication") ?? null;
  const pointOfSale = runs.find((r) => r.kind === "PointOfSale") ?? null;
  const rate = adjudication?.claimsPerSecond ?? 0;

  /*
   * Annualising from the book to date rather than assuming twelve equal
   * months, because the clock is usually somewhere in the middle of the year.
   */
  const yearFraction = Math.max(0.01, clock.yearElapsed);
  const annualClaims = claimsThisYear / yearFraction;

  return {
    adjudication: adjudication ? toSummary(adjudication) : null,
    pointOfSale: pointOfSale ? toSummary(pointOfSale) : null,
    claimsThisYear,
    busiestDay: busiest
      ? { date: busiest.date, claims: busiest.claimsSubmitted }
      : null,
    busiestDaySeconds: rate > 0 && busiest ? busiest.claimsSubmitted / rate : 0,
    wholeYearSeconds: rate > 0 ? annualClaims / rate : 0,
    nationalScripts: NATIONAL_SCRIPTS,
    nationalHours: rate > 0 ? NATIONAL_SCRIPTS / rate / 3_600 : 0,
    peakHeadroom:
      rate > 0 && busiest
        ? Math.round(rate / (busiest.claimsSubmitted / (14 * 3_600)))
        : 0,
    members,
  };
}
