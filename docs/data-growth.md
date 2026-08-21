# Data growth path (single-tenant)

Dashboards must stay on **precomputed rollups** (`BookDay`, `BookDayDimension`). Never recompute sponsor YTD from raw `Claim` on page load.

## When to partition

Once `Claim` exceeds ~5–10M rows (or ledger filters slow past ~1–2s p95):

1. Partition `Claim` by fill month (`dateOfService`):

```sql
-- Outline only — run in a maintenance window after taking a backup.
-- Prisma does not manage partitions; keep the parent table name "Claim"
-- so the Prisma client keeps working (PostgreSQL declarative partitioning).

ALTER TABLE "Claim" RENAME TO "Claim_legacy";

CREATE TABLE "Claim" (LIKE "Claim_legacy" INCLUDING ALL)
  PARTITION BY RANGE ("dateOfService");

CREATE TABLE "Claim_2026_q1" PARTITION OF "Claim"
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
-- …repeat per quarter…

INSERT INTO "Claim" SELECT * FROM "Claim_legacy";
```

2. Keep indexes on `(memberId, dateOfService)`, `(dateOfService)`, `(responseStatus)`, `(pharmacyId, drugId, dateOfService)`.

3. Archive cold years to object storage as Parquet/CSV **after** rollups for those days are frozen; restore on demand for audits.

## Rollup refresh

After bulk claim writes or replay commits:

```bash
# Enqueue via SQL or a small admin script
# type = rollup_refresh, payload = { "fromIso": "…", "toIso": "…" }
```

Worker handler: `src/lib/rollups.ts` → `refreshBookDayRollups`.

Re-seed `BookDayDimension` from the enrich pipeline when group-by pages drift.

## Read replicas

When reporting / agents contend with writes:

1. Provision a Postgres read replica.
2. Set `DATABASE_URL_READ` for replica.
3. Point sponsor/report/agent query modules at a read Prisma client (add when metrics show primary saturation).

Primary remains authoritative for PA decide, changes commit, jobs, and sessions.

## Ingest (production)

Replace laptop `npm run setup` with scheduled workers:

- Eligibility file load
- NADAC / formulary deltas
- Nightly rollup verification vs claim sums (invariant suite)

Synthetic seed/enrich remains for demo books only.
