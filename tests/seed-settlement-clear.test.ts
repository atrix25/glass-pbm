/**
 * Re-seed must wipe Claim-derived settlement tables.
 *
 * RemittanceRun / RemittanceLine / SponsorInvoice / RebateInvoice have no FK
 * to Claim. Leaving them after `npm run seed` keeps prior remittance and
 * invoice dollars while Claim (and B2 clawbacks) are rebuilt — Paid-cycle
 * settlement reads the stale RemittanceRun rows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SEED = readFileSync(
  resolve(__dirname, "../scripts/seed/index.ts"),
  "utf8",
);

/** Slice of main() that clears simulated data before rewriting the book. */
function clearBlock(source: string): string {
  const start = source.indexOf('console.log("Clearing simulated data...")');
  const end = source.indexOf('console.log("Seeding contracts and rate cards...")');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("seed clear — settlement money tables", () => {
  it("deletes remittance, sponsor invoices, and rebate invoices before Claim rebuild", () => {
    const block = clearBlock(SEED);

    for (const model of [
      "remittanceLine",
      "remittanceRun",
      "sponsorInvoice",
      "rebateInvoice",
    ] as const) {
      expect(block).toMatch(
        new RegExp(`prisma\\.${model}\\.deleteMany\\(\\)`),
      );
    }

    // Lines before runs (FK). Claim wipe is not enough on its own.
    expect(block.indexOf("remittanceLine.deleteMany")).toBeLessThan(
      block.indexOf("remittanceRun.deleteMany"),
    );
    expect(block.indexOf("remittanceRun.deleteMany")).toBeLessThan(
      block.indexOf("claim.deleteMany"),
    );
    expect(block.indexOf("sponsorInvoice.deleteMany")).toBeLessThan(
      block.indexOf("claim.deleteMany"),
    );
    expect(block.indexOf("rebateInvoice.deleteMany")).toBeLessThan(
      block.indexOf("claim.deleteMany"),
    );
  });
});
