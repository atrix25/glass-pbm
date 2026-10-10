import { describe, expect, it } from "vitest";
import {
  claimMoneyFrom,
  negateClaimMoney,
  planB2Sync,
  REVERSAL_MONEY_COLUMNS,
  type ClaimMoney,
} from "../scripts/reprocess-b2-sync";

function money(overrides: Partial<ClaimMoney> = {}): ClaimMoney {
  const base = {} as ClaimMoney;
  for (const column of REVERSAL_MONEY_COLUMNS) {
    base[column] = 0;
  }
  return { ...base, ...overrides };
}

describe("negateClaimMoney", () => {
  it("negates every reversal money column", () => {
    const b1 = money({
      planPaidCents: 12_345,
      patientPayCents: 2_000,
      totalBilledCents: 14_345,
      pharmacyPaidCents: 14_345,
      estimatedRebateCents: 500,
    });
    const negated = negateClaimMoney(b1);
    for (const column of REVERSAL_MONEY_COLUMNS) {
      expect(negated[column]).toBe(-b1[column]);
    }
  });
});

describe("planB2Sync", () => {
  it("does nothing when the B1 was never reversed", () => {
    expect(
      planB2Sync({
        b1ResponseStatus: "P",
        b1Money: money({ planPaidCents: 100 }),
        b2: null,
      }),
    ).toEqual({ action: "none" });
  });

  it("rewrites the B2 to negate a still-paid cost-changed B1", () => {
    const b1Money = money({
      planPaidCents: 8_000,
      patientPayCents: 1_500,
      totalBilledCents: 9_500,
      pharmacyPaidCents: 9_500,
    });
    expect(
      planB2Sync({
        b1ResponseStatus: "P",
        b1Money,
        b2: { id: "b2-1" },
      }),
    ).toEqual({
      action: "update",
      b2Id: "b2-1",
      data: negateClaimMoney(b1Money),
    });
  });

  it("deletes the B2 when reprocessing newly rejects the original", () => {
    // Trigger: formulary/QL fix flips a paid+reversed fill to R. Leaving the
    // old −plan/−member B2 invents a phantom clawback against a $0 B1.
    expect(
      planB2Sync({
        b1ResponseStatus: "R",
        b1Money: money(),
        b2: { id: "b2-orphan" },
      }),
    ).toEqual({ action: "delete", b2Id: "b2-orphan" });
  });

  it("copies money off a row-shaped object without extra keys", () => {
    const row = {
      ...money({ planPaidCents: 42 }),
      id: "claim-1",
      responseStatus: "P",
    };
    expect(claimMoneyFrom(row)).toEqual(money({ planPaidCents: 42 }));
  });
});
