import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { sqlitePlaceholdersToPg } from "@/lib/pg-sql";

/**
 * Locks the build-financials settlement/rebate SQL shapes that used to wipe
 * remittance, sponsor-invoice, and rebate-invoice tables on Postgres then abort.
 *
 * Requires a local Postgres accepting peer/passwordless `psql` as the
 * postgres OS user (the cloud agent fixture). Skips when unavailable.
 */

const TEST_DB = "glass_financials_sql_test";

function psql(sql: string, db = TEST_DB): string {
  return execFileSync(
    "sudo",
    ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function pgAvailable(): boolean {
  try {
    execFileSync(
      "sudo",
      ["-u", "postgres", "psql", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-c", "SELECT 1"],
      { encoding: "utf8" },
    );
    return true;
  } catch {
    return false;
  }
}

const hasPg = pgAvailable();

function setupFixtureDb() {
  execFileSync(
    "sudo",
    [
      "-u",
      "postgres",
      "psql",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DROP DATABASE IF EXISTS ${TEST_DB}`,
      "-c",
      `CREATE DATABASE ${TEST_DB}`,
    ],
    { encoding: "utf8" },
  );
  psql(`
    CREATE TABLE "Claim" (
      "pharmacyId" text,
      "responseStatus" text,
      "transactionCode" text,
      "pharmacyPaidCents" int,
      "planPaidCents" int,
      "estimatedRebateCents" int,
      "scenarioTag" text,
      "drugId" text,
      "dateOfService" timestamp
    );
    CREATE TABLE "Drug" (id text PRIMARY KEY, labeler text);
    CREATE TABLE "EligibilitySpan" (
      "effectiveDate" timestamp,
      "terminationDate" timestamp
    );
    CREATE TABLE "RebateInvoice" (
      "collectedAt" timestamp,
      "collectedCents" int
    );
    INSERT INTO "Drug" VALUES ('d1', 'Acme');
    INSERT INTO "Claim" VALUES
      ('ph1', 'P', 'B1', 1000, 800, 50, NULL, 'd1', '2026-01-05');
  `);
}

describe("build-financials Postgres SQL shapes", () => {
  it.skipIf(!hasPg)("rejects SQLite epoch-ms compares against timestamp columns", () => {
    setupFixtureDb();
    expect(() =>
      psql(`SELECT 1 FROM "Claim" WHERE "dateOfService" >= 1735689600000`),
    ).toThrow(/operator does not exist/);
  });

  it.skipIf(!hasPg)("rejects HAVING on a SELECT alias", () => {
    setupFixtureDb();
    expect(() =>
      psql(
        `SELECT SUM("estimatedRebateCents") AS amount FROM "Claim" GROUP BY "drugId" HAVING amount > 0`,
      ),
    ).toThrow(/column "amount" does not exist/);
  });

  it.skipIf(!hasPg)("accepts ISO timestamp literals for settlement date windows", () => {
    setupFixtureDb();
    const start = new Date(Date.UTC(2026, 0, 1)).toISOString();
    const end = new Date(Date.UTC(2026, 0, 15)).toISOString();
    const adapted = sqlitePlaceholdersToPg(`
      SELECT pharmacyId,
             SUM(CASE WHEN transactionCode = 'B1' THEN 1 ELSE 0 END) AS claims,
             SUM(CASE WHEN transactionCode = 'B1' THEN pharmacyPaidCents ELSE 0 END) AS gross
      FROM Claim
      WHERE (responseStatus = 'P' OR responseStatus = 'A')
        AND dateOfService >= '${start}'
        AND dateOfService <= '${end}'
      GROUP BY pharmacyId
    `);
    expect(psql(adapted)).toBe("ph1|1|1000");
  });

  it.skipIf(!hasPg)("accepts HAVING SUM(...) for the rebate invoice aggregation", () => {
    setupFixtureDb();
    const adapted = sqlitePlaceholdersToPg(`
      SELECT
        (CAST(STRFTIME('%m', c.dateOfService / 1000, 'unixepoch') AS INTEGER) - 1) / 3 AS quarter,
        COALESCE(d.labeler, 'Unattributed labeler') AS manufacturer,
        COUNT(*) AS claims,
        SUM(c.estimatedRebateCents) AS amount
      FROM Claim c JOIN Drug d ON d.id = c.drugId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND c.estimatedRebateCents > 0 AND c.scenarioTag IS NULL
      GROUP BY quarter, manufacturer
      HAVING SUM(c.estimatedRebateCents) > 0
    `);
    expect(psql(adapted)).toBe("0|Acme|1|50");
  });

  it("keeps settlement SQL free of epoch-ms integer literals", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../scripts/build-financials.ts", import.meta.url),
      "utf8",
    );
    // Strip block comments so historical notes do not trip the guards.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/function sqlTimestamp/);
    expect(code).toMatch(/HAVING SUM\(c\.estimatedRebateCents\) > 0/);
    expect(code).not.toMatch(/dateOfService >= \$\{[^}]*\.getTime\(\)/);
    expect(code).not.toMatch(/HAVING amount > 0/);
  });
});
