/**
 * Full B1 money written by `reprocess-claims --write`.
 *
 * Replay diffs historically carried only plan/member/billed. The write path
 * persisted those three and, on refuse, zeroed the pharmacy-side columns. On a
 * cost change or newly-paid fill the pharmacy/allowed/rebate columns were left
 * at their pre-correction values (or at zero for a prior reject), so
 * remittance (`pharmacyPaidCents`) and pass-through invariants drifted from
 * the corrected plan/member dollars even when linked B2s were later re-negated.
 */

export const REPROCESS_MONEY_COLUMNS = [
  "totalBilledCents",
  "planPaidCents",
  "patientPayCents",
  "totalAllowedCents",
  "pharmacyPaidCents",
  "allowedIngredientCostCents",
  "allowedDispensingFeeCents",
  "billedIngredientCostCents",
  "billedDispensingFeeCents",
  "appliedToDeductibleCents",
  "copayCoinsuranceCents",
  "brandSelectionPenaltyCents",
  "estimatedRebateCents",
] as const;

export type ReprocessMoneyColumn = (typeof REPROCESS_MONEY_COLUMNS)[number];
export type ReprocessClaimMoney = Record<ReprocessMoneyColumn, number>;

/** Money snapshot carried on a replay diff's `after` (and usable for writes). */
export type DiffMoneyAfter = ReprocessClaimMoney & {
  status: string;
  rejectCode: string | null;
};

export function claimMoneyFromOutcome(out: {
  [K in ReprocessMoneyColumn]: number;
}): ReprocessClaimMoney {
  const money = {} as ReprocessClaimMoney;
  for (const column of REPROCESS_MONEY_COLUMNS) {
    money[column] = out[column];
  }
  return money;
}

/**
 * Prisma `data` payload for rewriting a B1 from a corrected adjudication.
 * Always writes every money column so paid/cost paths cannot leave stale
 * pharmacy or rebate cents behind.
 */
export function b1MoneyWriteFromDiff(after: DiffMoneyAfter): {
  responseStatus: string;
  rejectCodes: string;
} & ReprocessClaimMoney {
  return {
    responseStatus: after.status,
    rejectCodes: after.rejectCode ? JSON.stringify([after.rejectCode]) : "[]",
    ...claimMoneyFromOutcome(after),
  };
}
