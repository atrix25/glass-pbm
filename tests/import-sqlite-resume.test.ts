/**
 * Resume decisions for SQLite → Postgres import.
 *
 * Remittance / sponsor / rebate / book-day aggregates keep a fixed cardinality
 * even when Claim money changes. Skipping them on count alone after a Claim
 * rewrite leaves settlement screens on durable stale dollars.
 */

import { describe, expect, it } from "vitest";
import {
  CLAIM_DERIVED_AGGREGATES,
  shouldSkipResume,
} from "../scripts/import-sqlite-resume";

describe("import-sqlite-to-pg resume", () => {
  it("skips when Postgres already holds every SQLite row and Claim is untouched", () => {
    expect(
      shouldSkipResume({
        table: "RemittanceRun",
        pgCount: 24,
        sqliteCount: 24,
        claimReloaded: false,
      }),
    ).toBe(true);
    expect(
      shouldSkipResume({
        table: "Claim",
        pgCount: 1_000_000,
        sqliteCount: 1_000_000,
        claimReloaded: false,
      }),
    ).toBe(true);
  });

  it("reloads when Postgres is behind SQLite", () => {
    expect(
      shouldSkipResume({
        table: "Claim",
        pgCount: 900_000,
        sqliteCount: 1_000_000,
        claimReloaded: false,
      }),
    ).toBe(false);
  });

  it("force-reloads Claim-derived aggregates after Claim is rewritten", () => {
    for (const table of CLAIM_DERIVED_AGGREGATES) {
      expect(
        shouldSkipResume({
          table,
          pgCount: 24,
          sqliteCount: 24,
          claimReloaded: true,
        }),
        table,
      ).toBe(false);
    }
  });

  it("does not force-reload unrelated tables after Claim is rewritten", () => {
    expect(
      shouldSkipResume({
        table: "Drug",
        pgCount: 50_000,
        sqliteCount: 50_000,
        claimReloaded: true,
      }),
    ).toBe(true);
    expect(
      shouldSkipResume({
        table: "Member",
        pgCount: 10_000,
        sqliteCount: 10_000,
        claimReloaded: true,
      }),
    ).toBe(true);
  });

  it("treats empty SQLite tables as nothing to load", () => {
    expect(
      shouldSkipResume({
        table: "RemittanceRun",
        pgCount: 0,
        sqliteCount: 0,
        claimReloaded: true,
      }),
    ).toBe(true);
  });

  it("covers every settlement aggregate named in the stale-resume failure mode", () => {
    for (const table of [
      "RemittanceRun",
      "RemittanceLine",
      "SponsorInvoice",
      "RebateInvoice",
      "BookDay",
      "BookDayDimension",
    ]) {
      expect(CLAIM_DERIVED_AGGREGATES.has(table), table).toBe(true);
    }
  });
});
