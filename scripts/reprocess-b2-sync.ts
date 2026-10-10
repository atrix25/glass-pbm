/**
 * Keep linked B2 reversals as the exact negation of a reprocessed B1.
 *
 * `reprocess-claims --write` updates disagreed B1 rows from replay diffs.
 * Replay never pushes B2 ids into those diffs (a reversal is defined as the
 * negation of its original, not an independent re-price). Updating the B1
 * alone therefore leaves the stored B2 clawing back the *old* dollars:
 * a newly-rejected fill nets a phantom recovery, and a cost change leaves a
 * nonzero net on an already-reversed fill.
 */

export const REVERSAL_MONEY_COLUMNS = [
  "totalBilledCents",
  "totalAllowedCents",
  "planPaidCents",
  "patientPayCents",
  "pharmacyPaidCents",
  "billedIngredientCostCents",
  "billedDispensingFeeCents",
  "allowedIngredientCostCents",
  "allowedDispensingFeeCents",
  "appliedToDeductibleCents",
  "copayCoinsuranceCents",
  "brandSelectionPenaltyCents",
  "estimatedRebateCents",
] as const;

export type ReversalMoneyColumn = (typeof REVERSAL_MONEY_COLUMNS)[number];
export type ClaimMoney = Record<ReversalMoneyColumn, number>;

export function negateClaimMoney(b1: ClaimMoney): ClaimMoney {
  const out = {} as ClaimMoney;
  for (const column of REVERSAL_MONEY_COLUMNS) {
    out[column] = -b1[column];
  }
  return out;
}

export type B2SyncPlan =
  | { action: "none" }
  | { action: "delete"; b2Id: string }
  | { action: "update"; b2Id: string; data: ClaimMoney };

/**
 * Decide how to repair a linked B2 after its B1 has been rewritten.
 *
 * - No B2 → nothing to do.
 * - B1 no longer paid → delete the B2 (reversals must point at a paid B1;
 *   the corrected history never moved money, so the clawback must not either).
 * - B1 still paid → rewrite every money column to −B1.
 */
export function planB2Sync(args: {
  b1ResponseStatus: string;
  b1Money: ClaimMoney;
  b2: { id: string } | null;
}): B2SyncPlan {
  if (!args.b2) return { action: "none" };
  if (args.b1ResponseStatus !== "P") {
    return { action: "delete", b2Id: args.b2.id };
  }
  return {
    action: "update",
    b2Id: args.b2.id,
    data: negateClaimMoney(args.b1Money),
  };
}

export function claimMoneyFrom(row: {
  [K in ReversalMoneyColumn]: number;
}): ClaimMoney {
  const out = {} as ClaimMoney;
  for (const column of REVERSAL_MONEY_COLUMNS) {
    out[column] = row[column];
  }
  return out;
}
