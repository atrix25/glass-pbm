/**
 * Rebuild pharmacy accumulators from prior paid fills.
 *
 * Seed and empty-override replay do not store a running balance on each claim.
 * They fold each fill's `accumulatorDeltas` into the member's position before
 * pricing the next one. Those deltas credit the post-cap patient pay — including
 * any brand selection penalty — to every accumulator the fill's cost-share rule
 * accumulates to (see `computeCostShare` in adjudicate.ts).
 *
 * Reproduce and POS have to reconstruct that same prefix from the ledger. Doing
 * it with a different formula (subtracting the brand penalty from Rx OOP, or
 * copying Rx into federal) understates the position and overcharges later fills
 * that sit near an out-of-pocket limit.
 */

export interface PriorClaimAccumulatorFields {
  formularyLevel: string | null;
  patientPayCents: number;
  appliedToDeductibleCents: number;
}

export function rebuildPharmacyAccumulators(
  claims: readonly PriorClaimAccumulatorFields[],
  opts: {
    rxOopLevels: ReadonlySet<string>;
    federalOopLevels: ReadonlySet<string>;
  },
): { rxOopCents: number; federalOopCents: number; deductibleCents: number } {
  let rxOopCents = 0;
  let federalOopCents = 0;
  let deductibleCents = 0;

  for (const c of claims) {
    deductibleCents += c.appliedToDeductibleCents;
    const level = c.formularyLevel ?? "";
    // An empty level set means "every fill counts," matching the historical
    // rebuild loops this replaces.
    if (opts.rxOopLevels.size === 0 || opts.rxOopLevels.has(level)) {
      rxOopCents += c.patientPayCents;
    }
    if (opts.federalOopLevels.size === 0 || opts.federalOopLevels.has(level)) {
      federalOopCents += c.patientPayCents;
    }
  }

  return { rxOopCents, federalOopCents, deductibleCents };
}
