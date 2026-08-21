# Cutover: SQLite demo → single-tenant Postgres foundation

1. Provision Postgres (Fly MPG or `docker compose up -d postgres`).
2. Set secrets: `DATABASE_URL`, `DATABASE_URL_DIRECT`, keep `DEMO_PASSWORD` / `AUTH_MODE=basic` for demos.
3. `npx prisma db push`
4. `npx tsx scripts/import-sqlite-to-pg.ts` (from a machine that can read `prisma/dev.db`).
5. Deploy this branch (`fly deploy`). Confirm `min_machines_running=2` and a worker machine.
6. Hit `/api/health` and `/api/health/live`.
7. Detach / destroy the `glass_book` volume after a soak period.
8. Flip `DEMO_FEATURES=0` and `AUTH_MODE=session` when ready for real auth; bootstrap an admin via `PUT /api/auth`.

Until step 5, the previous SQLite+volume image remains the live demo.

## MPG book reload (staging)

`fly mpg proxy` + local `pg_restore` is unreliable for the full book (WireGuard drops mid-COPY). Prefer restore **inside** the Fly private network:

1. `pg_dump --no-owner --no-acl -Fc -d glass -f /tmp/glass-local.dump` (local Postgres 16).
2. `fly ssh sftp put -a glass-pbm-foundation --machine <id> /tmp/glass-local.dump /tmp/glass-local.dump`
3. On the app machine: install `postgresql-client-16`, connect to the MPG **Direct IP** (not pgbouncer) with `?sslmode=disable`.
4. Drop FKs → truncate → `pg_restore --data-only` → `DATABASE_URL=…?sslmode=disable npx prisma db push`.
5. Verify: Claim ≈ 1.62M, Member ≈ 103k, BookDay = 365. `/api/health` alone is not enough (it only checks BookDay).

Helpers: `scripts/restore-mpg.ts`, `scripts/restore-mpg-tables.ts` (local/proxy with retries).
