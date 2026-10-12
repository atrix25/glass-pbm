import { describe, expect, it } from "vitest";
import {
  REPROCESS_MONEY_COLUMNS,
  b1MoneyWriteFromDiff,
  claimMoneyFromOutcome,
  type DiffMoneyAfter,
  type ReprocessClaimMoney,
} from "../scripts/reprocess-claim-money";

function money(overrides: Partial<ReprocessClaimMoney> = {}): ReprocessClaimMoney {
  const base = {} as ReprocessClaimMoney;
  for (const column of REPROCESS_MONEY_COLUMNS) {
    base[column] = 0;
  }
  return { ...base, ...overrides };
}

describe("b1MoneyWriteFromDiff", () => {
  it("writes pharmacy/allowed/rebate on a cost-changed still-paid fill", () => {
    // Old bug: only plan/member/billed were updated, so pharmacyPaid stayed at
    // the pre-correction $80 while planPaid became $60 → remittance overpay and
    // pharmacyPaid + patientPay ≠ totalAllowed.
    const after: DiffMoneyAfter = {
      status: "P",
      rejectCode: null,
      ...money({
        totalBilledCents: 10_000,
        planPaidCents: 6_000,
        patientPayCents: 4_000,
        totalAllowedCents: 10_000,
        pharmacyPaidCents: 6_000,
        allowedIngredientCostCents: 9_500,
        allowedDispensingFeeCents: 500,
        billedIngredientCostCents: 9_500,
        billedDispensingFeeCents: 500,
        appliedToDeductibleCents: 0,
        copayCoinsuranceCents: 4_000,
        brandSelectionPenaltyCents: 0,
        estimatedRebateCents: 1_200,
      }),
    };

    const data = b1MoneyWriteFromDiff(after);
    expect(data.responseStatus).toBe("P");
    expect(data.planPaidCents).toBe(6_000);
    expect(data.patientPayCents).toBe(4_000);
    expect(data.pharmacyPaidCents).toBe(6_000);
    expect(data.totalAllowedCents).toBe(10_000);
    expect(data.estimatedRebateCents).toBe(1_200);
    expect(data.pharmacyPaidCents + data.patientPayCents).toBe(
      data.totalAllowedCents,
    );
    expect(data.planPaidCents + data.patientPayCents).toBe(data.totalBilledCents);
    for (const column of REPROCESS_MONEY_COLUMNS) {
      expect(data[column]).toBe(after[column]);
    }
  });

  it("zeros every money column when a fill is newly refused", () => {
    const after: DiffMoneyAfter = {
      status: "R",
      rejectCode: "76",
      ...money(),
    };
    const data = b1MoneyWriteFromDiff(after);
    expect(data.responseStatus).toBe("R");
    expect(data.rejectCodes).toBe(JSON.stringify(["76"]));
    for (const column of REPROCESS_MONEY_COLUMNS) {
      expect(data[column]).toBe(0);
    }
  });

  it("restores pharmacy dollars on a newly-paid former reject", () => {
    // Old bug: newly-paid wrote plan/member/billed but left pharmacyPaid at 0
    // (reject residue), so in-flight remittance missed the fill entirely.
    const after: DiffMoneyAfter = {
      status: "P",
      rejectCode: null,
      ...money({
        totalBilledCents: 25_000,
        planPaidCents: 25_000,
        patientPayCents: 0,
        totalAllowedCents: 25_000,
        pharmacyPaidCents: 25_000,
        allowedIngredientCostCents: 24_250,
        allowedDispensingFeeCents: 750,
        billedIngredientCostCents: 24_250,
        billedDispensingFeeCents: 750,
        estimatedRebateCents: 3_000,
      }),
    };
    const data = b1MoneyWriteFromDiff(after);
    expect(data.pharmacyPaidCents).toBe(25_000);
    expect(data.estimatedRebateCents).toBe(3_000);
    expect(data.planPaidCents).toBe(data.pharmacyPaidCents);
  });
});

describe("claimMoneyFromOutcome", () => {
  it("copies only the reprocess money columns", () => {
    const out = {
      ...money({ planPaidCents: 42, pharmacyPaidCents: 42 }),
      responseStatus: "P",
      channel: "Retail",
    };
    expect(claimMoneyFromOutcome(out)).toEqual(
      money({ planPaidCents: 42, pharmacyPaidCents: 42 }),
    );
  });
});
