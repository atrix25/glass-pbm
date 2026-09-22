import { describe, expect, it } from "vitest";
import { invoiceDifference, measuredCheck, type AssuranceCheck } from "../src/lib/assurance";
const input: Omit<AssuranceCheck, "status"> = { id: "test", group: "Charges & fees", title: "Test", result: "Matches", method: "Compare", source: "Claims", href: "/claims", records: 10, exceptions: 0, differenceCents: 0, limit: "Internal", nextStep: "Confirm" };
describe("assurance evidence", () => {
  it("requires an observed population before clearing a check", () => {
    expect(measuredCheck(input).status).toBe("Clear");
    expect(measuredCheck({ ...input, records: 0 })).toMatchObject({ status: "Not verified", result: "No eligible records to check." });
    expect(measuredCheck({ ...input, records: null }).status).toBe("Not verified");
    expect(measuredCheck({ ...input, exceptions: null }).status).toBe("Not verified");
  });
  it("flags even one exception", () => {
    expect(measuredCheck({ ...input, exceptions: 1 }).status).toBe("Review");
  });
  it("uses the issued invoice equation without double counting rebate fees", () => {
    expect(invoiceDifference({ drugCostCents: 10000, adminFeeCents: 500, rebateCreditCents: 2000, totalDueCents: 8500 })).toBe(0);
  });
  it("preserves both positive and negative discrepancies", () => {
    const base = { drugCostCents: 10000, adminFeeCents: 500, rebateCreditCents: 2000 };
    expect([8400, 8600].reduce((sum, totalDueCents) => sum + invoiceDifference({ ...base, totalDueCents }), 0)).toBe(200);
  });
});
