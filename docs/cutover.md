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
