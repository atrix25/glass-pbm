# Glass

Transparent PBM proof of concept (Wisconsin ETF / Navitus ETG0013), evolving into a **single-tenant production** deploy.

## Codebase map

Labeled areas for onboarding and ownership — start here when sharing the repo:

**[docs/codebase-map.md](docs/codebase-map.md)**

| Label | Path | Owns |
|-------|------|------|
| **surface** | `src/app/` | Routes / pages |
| **ui** | `src/components/` | Shared React UI |
| **read-model** | `src/lib/queries/` | Page data / SQL |
| **engine** | `src/lib/engine/` | Adjudication |
| **platform** | `src/lib/db.ts`, `pg-sql.ts`, auth | DB, auth, jobs |
| **schema** | `prisma/` | Data model |
| **ops** | `scripts/`, `fly.toml`, `docs/` | Deploy / restore |
| **proof** | `tests/` | Harness / golden tests |

## Architecture (foundation)

- **Postgres** book (not SQLite-on-volume)
- **Stateless Fly app** + **worker** for replay / NPS / rollups
- **Session or Basic auth**, durable copy overrides + harness results in DB
- Ops: [docs/ops-runbook.md](docs/ops-runbook.md) · Cutover: [docs/cutover.md](docs/cutover.md) · Growth: [docs/data-growth.md](docs/data-growth.md)

## Local

```bash
brew services start postgresql@16   # or: docker compose up -d postgres
cp .env.example .env                # DATABASE_URL=postgresql://…
npm install
npm run db:generate && npm run db:push
# Optional import from existing SQLite book:
npm run db:import
npm run dev
# Separate terminal:
npm run worker
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run worker` | Job worker |
| `npm run db:import` | SQLite → Postgres import |
| `npm run harness:publish` | Push `tests/results.json` into `HarnessResult` |
| `npm run deploy` | `fly deploy` + health wait |
