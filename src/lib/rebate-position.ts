export interface RebatePeriod {
  id: string;
  label: string;
  closed: boolean;
  claims: number;
  estimatedCents: number;
  floorCents: number | null;
}

/** Sensitivity assumptions apply to unreconciled accruals, not a probability model. */
export function rebateSensitivity(period: RebatePeriod, variationPercent: number) {
  if (!Number.isFinite(variationPercent) || variationPercent < 0 || variationPercent > 100) {
    throw new RangeError("Rebate sensitivity must be between 0 and 100 percent");
  }
  const lowCents = Math.round(period.estimatedCents * (1 - variationPercent / 100));
  const highCents = Math.round(period.estimatedCents * (1 + variationPercent / 100));
  const measured = period.claims > 0 && period.floorCents !== null;
  return {
    lowCents, highCents,
    rateCents: period.claims ? period.estimatedCents / period.claims : null,
    lowRateCents: period.claims ? lowCents / period.claims : null,
    highRateCents: period.claims ? highCents / period.claims : null,
    floorRateCents: measured ? period.floorCents! / period.claims : null,
    position: !period.claims ? "No volume" : !measured ? "Contract terms needed" : highCents < period.floorCents! ? "Range below floor" : lowCents > period.floorCents! ? "Range above floor" : "Range includes floor",
  };
}
