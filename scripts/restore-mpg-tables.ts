/**
 * Restore local custom-format dump into MPG table-by-table with FKs off.
 * Retries individual tables when the WireGuard proxy drops.
 *
 *   DATABASE_URL=… npx tsx scripts/restore-mpg-tables.ts
 */

import { spawnSync } from "node:child_process";
import pg from "pg";

const URL = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const DUMP = process.env.BOOK_DUMP ?? "/tmp/glass-local.dump";
const MAX_RETRIES = Number(process.env.RESTORE_RETRIES ?? 5);

if (!URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const TABLE_ORDER = [
  "SourceDocument",
  "PlanSponsor",
  "Contract",
  "Network",
  "Pharmacy",
  "NetworkPharmacy",
  "Drug",
  "DrugPrice",
  "Formulary",
  "FormularyEntry",
  "BenefitPlan",
  "CostShareRule",
  "Member",
  "EligibilitySpan",
  "EligibilityFile",
  "EligibilityTransaction",
  "AccumulatorFile",
  "Accumulator",
  "AccumulatorTransfer",
  "AccumulatorTransaction",
  "Prescriber",
  "ContractRate",
  "RebateContract",
  "RebateTerm",
  "PACriteriaTree",
  "CriteriaStep",
  "ConfigVersion",
  "Claim",
  "BookDay",
  "BookDayDimension",
  "TraceStep",
  "PriorAuthorization",
  "PADecisionStep",
  "NpsSnapshot",
  "ReadjudicationRun",
  "AuditFinding",
  "AuditFindingResult",
  "OpioidProduct",
  "DurAlert",
  "IntegritySignal",
  "MacList",
  "MacPrice",
  "MacPriceChange",
  "MacAppeal",
  "RebateAccrual",
  "RebateInvoice",
  "RemittanceRun",
  "RemittanceLine",
  "SponsorInvoice",
  "AgentPolicy",
  "AgentRun",
  "AgentStep",
  "AgentProposal",
  "ClinicalNote",
  "ChatSession",
  "ChatMessage",
  "EvalCase",
  "EvalResult",
  "ThroughputRun",
  "ServiceIncident",
];

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({
    connectionString: URL,
    keepAlive: true,
    connectionTimeoutMillis: 60_000,
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

function restoreTable(table: string): void {
  const args = [
    "--no-owner",
    "--no-acl",
    "--data-only",
    "--disable-triggers",
    "-t",
    table,
    "-d",
    URL!,
    DUMP,
  ];
  // --disable-triggers will warn/fail on MPG; try without if needed
  let r = spawnSync("pg_restore", args, { encoding: "utf8" });
  if (r.status !== 0 && /permission denied|system trigger/i.test(r.stderr ?? "")) {
    r = spawnSync(
      "pg_restore",
      ["--no-owner", "--no-acl", "--data-only", "-t", table, "-d", URL!, DUMP],
      { encoding: "utf8" },
    );
  }
  if (r.stderr && !/warning/i.test(r.stderr)) {
    // pg_restore writes progress to stderr
  }
  if (r.status !== 0) {
    const err = (r.stderr ?? r.stdout ?? "").slice(-500);
    throw new Error(`pg_restore ${table} failed: ${err}`);
  }
}

async function main() {
  console.log("Dropping FKs + truncating…");
  await withClient(async (c) => {
    await c.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (
          SELECT conname, conrelid::regclass AS tbl
          FROM pg_constraint
          WHERE contype = 'f' AND connamespace = 'public'::regnamespace
        ) LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
        END LOOP;
      END $$;
    `);
    await c.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE format('TRUNCATE TABLE %I CASCADE', r.tablename);
        END LOOP;
      END $$;
    `);
  });

  // Discover which tables exist in the dump
  const listed = spawnSync("pg_restore", ["-l", DUMP], { encoding: "utf8" });
  const dumpTables = new Set(
    [...(listed.stdout ?? "").matchAll(/TABLE DATA public (\S+)/g)].map((m) => m[1]),
  );
  const tables = [
    ...TABLE_ORDER.filter((t) => dumpTables.has(t)),
    ...[...dumpTables].filter((t) => !TABLE_ORDER.includes(t)).sort(),
  ];
  console.log(`Restoring ${tables.length} tables from ${DUMP}`);

  for (const table of tables) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const before = await withClient(async (c) => {
          const r = await c.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM "${table}"`,
          );
          return Number(r.rows[0].n);
        });
        if (before > 0) {
          console.log(`  ${table}: already ${before}`);
          break;
        }
        console.log(`  ${table}: restoring (attempt ${attempt})…`);
        const started = Date.now();
        restoreTable(table);
        const after = await withClient(async (c) => {
          const r = await c.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM "${table}"`,
          );
          return Number(r.rows[0].n);
        });
        console.log(
          `  ${table}: done ${after} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
        break;
      } catch (err) {
        console.error(`  ${table}: ${err instanceof Error ? err.message : err}`);
        if (attempt >= MAX_RETRIES) throw err;
        console.log("  waiting 5s before retry…");
        await new Promise((r) => setTimeout(r, 5000));
        // Truncate partial table before retry
        try {
          await withClient(async (c) => {
            await c.query(`TRUNCATE TABLE "${table}" CASCADE`);
          });
        } catch {
          /* ignore */
        }
      }
    }
  }

  console.log("Recreating FKs via prisma db push…");
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: URL },
  });
  if (push.status !== 0) throw new Error("prisma db push failed");

  const counts = await withClient(async (c) => {
    const r = await c.query<{ t: string; n: string }>(`
      SELECT 'Claim' AS t, COUNT(*)::text AS n FROM "Claim"
      UNION ALL SELECT 'Member', COUNT(*)::text FROM "Member"
      UNION ALL SELECT 'BookDay', COUNT(*)::text FROM "BookDay"
    `);
    return r.rows;
  });
  for (const row of counts) console.log(`  ${row.t}: ${row.n}`);
  const claim = Number(counts.find((r) => r.t === "Claim")?.n ?? 0);
  if (claim < 1_000_000) throw new Error(`Claim count too low: ${claim}`);
  console.log("Restore complete and verified");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
