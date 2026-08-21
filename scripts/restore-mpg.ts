/**
 * Restore local glass dump into Fly MPG without superuser trigger privileges.
 *
 * 1) Drop all FKs
 * 2) Truncate all tables
 * 3) pg_restore --data-only
 * 4) prisma db push to recreate FKs
 *
 * Requires DATABASE_URL pointing at the target (usually via fly mpg proxy).
 */

import { spawnSync } from "node:child_process";
import pg from "pg";

const URL = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const DUMP = process.env.BOOK_DUMP ?? "/tmp/glass-local.dump";

if (!URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

async function main() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  console.log("Connected");

  console.log("Dropping foreign keys…");
  await client.query(`
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

  console.log("Truncating all public tables…");
  await client.query(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE format('TRUNCATE TABLE %I CASCADE', r.tablename);
      END LOOP;
    END $$;
  `);
  await client.end();

  console.log(`Restoring ${DUMP}…`);
  const restore = spawnSync(
    "pg_restore",
    ["--no-owner", "--no-acl", "--data-only", "-d", URL, DUMP],
    { encoding: "utf8" },
  );
  if (restore.stderr) process.stderr.write(restore.stderr);
  if (restore.status !== 0) {
    throw new Error(`pg_restore exited ${restore.status}`);
  }
  console.log("pg_restore ok");

  console.log("Recreating schema / FKs via prisma db push…");
  run("npx", ["prisma", "db", "push", "--skip-generate"], {
    DATABASE_URL: URL,
  });

  const verify = new pg.Client({ connectionString: URL });
  await verify.connect();
  const counts = await verify.query<{ t: string; n: string }>(`
    SELECT 'Claim' AS t, COUNT(*)::text AS n FROM "Claim"
    UNION ALL SELECT 'Member', COUNT(*)::text FROM "Member"
    UNION ALL SELECT 'BookDay', COUNT(*)::text FROM "BookDay"
    UNION ALL SELECT 'Pharmacy', COUNT(*)::text FROM "Pharmacy"
  `);
  for (const row of counts.rows) console.log(`  ${row.t}: ${row.n}`);
  await verify.end();

  const claim = Number(counts.rows.find((r) => r.t === "Claim")?.n ?? 0);
  const members = Number(counts.rows.find((r) => r.t === "Member")?.n ?? 0);
  const days = Number(counts.rows.find((r) => r.t === "BookDay")?.n ?? 0);
  if (claim < 1_000_000 || members < 50_000 || days < 300) {
    throw new Error(
      `Restore looks incomplete: Claim=${claim} Member=${members} BookDay=${days}`,
    );
  }
  console.log("Restore complete and verified");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
