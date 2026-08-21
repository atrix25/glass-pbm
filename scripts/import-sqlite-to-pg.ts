/**
 * Fast SQLite → Postgres import using COPY, with resume support.
 *
 *   DATABASE_URL=postgresql://… npx tsx scripts/import-sqlite-to-pg.ts
 *
 * Skips tables already fully loaded. Partially loaded tables are truncated and
 * reloaded.
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (
    path: string,
    opts?: { readOnly?: boolean },
  ) => {
    prepare: (sql: string) => {
      all: (...params: unknown[]) => Record<string, unknown>[];
      get: (...params: unknown[]) => Record<string, unknown>;
      iterate: (...params: unknown[]) => IterableIterator<Record<string, unknown>>;
    };
    close: () => void;
  };
};

const SQLITE = process.env.BOOK_PATH ?? "prisma/dev.db";
const DATABASE_URL =
  process.env.DATABASE_URL_DIRECT ??
  process.env.DATABASE_URL ??
  "postgresql://localhost:5432/glass";

const DATE_HINT =
  /At$|Date$|^date$|retrievedAt|publishedDate|decidedAt|receivedAt|submittedAt|processedAt|adjudicatedAt|createdAt|updatedAt|startedAt|finishedAt|expiresAt|lastUsedAt|retroReportedAt|reportedTerminationDate|effectiveDate|terminationDate|adjustedAt/i;

const SKIP_TABLES = new Set([
  "Job",
  "JobRun",
  "User",
  "Session",
  "ApiKey",
  "AuditEvent",
  "CopyOverride",
  "HarnessResult",
  "TenantConfig",
]);

/** Parent → child order when FK checks cannot be deferred (Fly MPG). */
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

function orderedTables(available: string[]): string[] {
  const ordered = TABLE_ORDER.filter((t) => available.includes(t));
  const rest = available.filter((t) => !TABLE_ORDER.includes(t)).sort();
  return [...ordered, ...rest];
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function csvEscape(
  v: unknown,
  col: string,
  type: string,
): string {
  if (v === null || v === undefined) return "\\N";

  if (type === "boolean") {
    if (v === true || v === 1 || v === "1" || v === "t" || v === "true") return "t";
    return "f";
  }

  if (type.startsWith("timestamp") || type === "date") {
    if (typeof v === "number") {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return "\\N";
      return d.toISOString();
    }
    if (typeof v === "string" && /^-?\d+$/.test(v)) {
      const d = new Date(Number(v));
      if (Number.isNaN(d.getTime())) return "\\N";
      return d.toISOString();
    }
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string") return v;
  }

  if (typeof v === "boolean") return v ? "t" : "f";
  if (typeof v === "bigint") return String(v);
  if (typeof v === "number") {
    if (DATE_HINT.test(col)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return String(v);
  }
  if (v instanceof Date) return v.toISOString();

  let s = String(v);
  s = s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return s;
}

async function columnTypes(
  client: pg.Client,
  table: string,
): Promise<Map<string, string>> {
  const res = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Map(res.rows.map((r) => [r.column_name, r.data_type]));
}

async function main() {
  console.log(`Pushing schema to Postgres…`);
  run("npx", ["prisma", "db", "push", "--skip-generate"]);

  const sqlite = new DatabaseSync(SQLITE, { readOnly: true });
  const tables = orderedTables(
    sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name`,
      )
      .all()
      .map((r: Record<string, unknown>) => String(r.name))
      .filter((t) => !SKIP_TABLES.has(t)),
  );

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query("SET session_replication_role = replica");
  } catch {
    console.log("session_replication_role unavailable — using FK-safe table order");
  }
  try {
    await client.query("SET synchronous_commit = off");
  } catch {
    /* optional */
  }

  console.log(`Importing ${tables.length} tables from ${SQLITE}`);

  for (const table of tables) {
    const total = Number(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n,
    );
    if (total === 0) {
      console.log(`  ${table}: empty`);
      continue;
    }

    const pgCount = Number(
      (await client.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${table}"`)).rows[0]
        .n,
    );

    if (pgCount >= total) {
      console.log(`  ${table}: already loaded (${pgCount})`);
      continue;
    }

    if (pgCount > 0) {
      console.log(`  ${table}: partial (${pgCount}/${total}) — truncating and reloading`);
      await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
    }

    const sample = sqlite.prepare(`SELECT * FROM "${table}" LIMIT 1`).get() as
      | Record<string, unknown>
      | undefined;
    if (!sample) continue;

    const types = await columnTypes(client, table);
    const cols = Object.keys(sample).filter((c) => types.has(c));
    const colList = cols.map((c) => `"${c}"`).join(", ");

    console.log(`  ${table}: copying ${total} rows…`);
    const started = Date.now();
    let loaded = 0;
    const iter = sqlite.prepare(`SELECT * FROM "${table}"`).iterate();

    async function* lines() {
      for (const row of iter) {
        yield (
          cols
            .map((c) => csvEscape(row[c], c, types.get(c) ?? "text"))
            .join("\t") + "\n"
        );
        loaded += 1;
        if (loaded % 50_000 === 0) {
          console.log(`  ${table}: ${loaded}/${total}`);
        }
      }
    }

    const stream = client.query(
      copyFrom(`COPY "${table}" (${colList}) FROM STDIN WITH (FORMAT text, NULL '\\N')`),
    );
    await pipeline(Readable.from(lines()), stream);

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ${table}: done ${total} in ${secs}s`);
  }

  try {
    await client.query("SET session_replication_role = DEFAULT");
  } catch {
    /* optional */
  }
  try {
    await client.query("SET synchronous_commit = on");
  } catch {
    /* optional */
  }

  await client.query(`
    INSERT INTO "TenantConfig" (id, "contractId", "sponsorId", "defaultMemberId", "displayName", "demoFeatures", "updatedAt")
    VALUES ('default', 'etg0013', 'steel-potatoes', 'mbr-DEMO-0001-01', 'Glass', TRUE, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  try {
    const payload = readFileSync("tests/results.json", "utf8");
    await client.query(
      `INSERT INTO "HarnessResult" (id, payload, "objectKey", "commitSha", "createdAt")
       VALUES ($1, $2, NULL, $3, NOW())`,
      [`hr_${Date.now().toString(36)}`, payload, process.env.GIT_SHA ?? null],
    );
    console.log("Published harness results");
  } catch (e) {
    console.warn("Harness publish skipped:", e);
  }

  await client.end();
  sqlite.close();
  console.log("Import complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
