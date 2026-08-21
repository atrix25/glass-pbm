# Single-tenant production operations

Glass runs as **one Fly app per plan sponsor / contract**, backed by **Postgres**, a **stateless app tier** (≥2 machines), and a **worker** process for long jobs.

## Topology

- **App** (`processes.app`): Next.js, `min_machines_running = 2`
- **Worker** (`processes.worker`): claims `Job` rows with `FOR UPDATE SKIP LOCKED`
- **Postgres**: managed (Fly MPG recommended) or self-hosted; set `DATABASE_URL` (pooled) and `DATABASE_URL_DIRECT` (migrations)
- **Object storage**: optional for large harness payloads (`HarnessResult.objectKey`)

## Required secrets

| Secret | Purpose |
|--------|---------|
| `DATABASE_URL` | Pooled Postgres URL |
| `DATABASE_URL_DIRECT` | Direct URL for `prisma db push` / migrations |
| `DEMO_PASSWORD` | Keep `AUTH_MODE=basic` for invite-only demos |
| `SESSION_SECRET` | Enables `AUTH_MODE=session` |
| `SERVICE_API_KEY` | Pharmacy POS / switch adapters |
| `DEMO_FEATURES` | `1` demo clock/roles; `0` production |
| `TENANT_CONTRACT_ID` / `TENANT_SPONSOR_ID` | Single-tenant identity |
| `ANTHROPIC_API_KEY` | Optional agent brain |

## Auth modes

- `AUTH_MODE=open` — local only
- `AUTH_MODE=basic` — HTTP Basic (current demo)
- `AUTH_MODE=session` — `/login` + `User` / `Session` tables
- `AUTH_MODE=oidc` — reserved; set `OIDC_ISSUER` when wiring IdP

Bootstrap first admin:

```bash
curl -X PUT "$HOST/api/auth" -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"…","role":"admin"}'
# Requires ALLOW_BOOTSTRAP=1 if users already exist
```

## Deploy

```bash
fly secrets set DATABASE_URL=… DATABASE_URL_DIRECT=… DEMO_FEATURES=1 AUTH_MODE=basic
fly deploy
```

Health:

- `GET /api/health/live` — process up
- `GET /api/health` — Postgres + `BookDay` rollup present (Fly check)

## Backups & restore (RPO/RTO)

1. Enable automated Postgres backups / PITR on the provider.
2. **Restore drill (quarterly):** restore a backup to a new database → point a staging Fly app at it → hit `/api/health` → spot-check sponsor dashboard.
3. **RPO target:** ≤ 24h (or PITR continuous). **RTO target:** recreate app image + restore DB in-region ≤ 2h.
4. Multi-region active-active is out of scope; recreate-in-`ord` is the foundation DR path.

## Book import (SQLite → Postgres)

```bash
DATABASE_URL=postgresql://… npx tsx scripts/import-sqlite-to-pg.ts
```

Do **not** use `scripts/push-book.mjs` for live traffic anymore — that path targeted a volume-mounted SQLite file.

## Jobs

| Type | Purpose |
|------|---------|
| `replay` | Full-book re-adjudication |
| `nps_snapshot` | Persist NPS reading |
| `rollup_refresh` | Rebuild `BookDay` from claims |

Enqueue via `POST /api/replay` (async by default for full runs) or `POST /api/nps/snapshot` with `{ "async": true }`.

## Staging

Clone production DB from backup into a separate Fly Postgres, deploy the same image with `DEMO_FEATURES=1` and a different app name. Never point staging at the production database URL.

## Observability

- Structured `console` logs from worker (`[worker id] claimed|completed|failed`)
- Alert on: health check failures, `Job` rows in `failed`, queue depth (`status=pending` age > 15m), Postgres CPU/storage
- Use provider slow-query insights on claims ledger filters

## Claim growth

See [data-growth.md](./data-growth.md) for partitioning / archive / read replicas.
