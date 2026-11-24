/**
 * Accrued PMPM fees must track the simulation clock.
 *
 * The sponsor dashboard once multiplied membership by a full twelve months
 * while every claim dollar on the same page was year-to-date. That invented
 * administrative fees the sponsor had not been invoiced for yet. The helper
 * under test is what both /sponsor and /reports now share.
 */

import { describe, expect, it } from "vitest";
import { accruedPmpmCents } from "@/lib/money";
import { WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";

const PMPM = WISCONSIN_CONTRACT.adminFeePmpmCommercialCents;

describe("accruedPmpmCents", () => {
  it("bills only elapsed months against a mid-year clock", () => {
    const members = 100_000;
    // July 1 ≈ half the plan year.
    const midYear = 0.5;
    const accrued = accruedPmpmCents(members, midYear, PMPM);
    const fullYear = members * 12 * PMPM;

    expect(accrued).toBe(Math.round(members * 6 * PMPM));
    expect(accrued).toBeLessThan(fullYear);
    // Half-year must not quietly show the annual total.
    expect(accrued).toBe(fullYear / 2);
  });

  it("matches a full-year accrual when the clock reaches year end", () => {
    const members = 48_250;
    expect(accruedPmpmCents(members, 1, PMPM)).toBe(members * 12 * PMPM);
  });

  it("never bills less than one month early in the year", () => {
    const members = 10_000;
    expect(accruedPmpmCents(members, 0, PMPM)).toBe(members * 1 * PMPM);
  });
});
