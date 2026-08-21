import pg from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const r = await c.query("select current_database() as db, 1 as n");
  console.log("connected", r.rows[0]);
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
