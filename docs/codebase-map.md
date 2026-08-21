# Codebase map

Glass is a **single-tenant PBM demo / production foundation**: Next.js UI + adjudication engine + Postgres book, deployed on Fly.

Use this file when onboarding someone or deciding where a change belongs.

## Labels (quick index)

| Label | Path | Own when you are changing… |
|-------|------|----------------------------|
| **surface** | `src/app/` | Routes, layouts, page composition |
| **ui** | `src/components/` | Shared React UI / demo chrome |
| **read-model** | `src/lib/queries/` | Page data loaders (SQL + Prisma) |
| **engine** | `src/lib/engine/` | Claim adjudication, pricing, replay |
| **clinical** | `src/lib/clinical/`, `src/lib/pa/` | DUR, opioids, prior auth |
| **nps** | `src/lib/nps/` | Member-experience model / survey proxy |
| **integrity** | `src/lib/integrity/`, `src/lib/agents/` | Detectors and agent workflows |
| **platform** | `src/lib/db.ts`, `src/lib/pg-sql.ts`, `src/lib/auth.ts`, `src/middleware.ts` | DB dialect, auth, config, jobs |
| **schema** | `prisma/` | Data model |
| **book-build** | `scripts/` (seed/build/ingest) | Synthetic book construction |
| **ops** | `scripts/` (restore/import/worker), `fly.toml`, `docs/` | Deploy, restore, runbooks |
| **proof** | `tests/` | Determinism / golden / harness |

---

## Runtime shape

```
Browser ──► Fly app (Next.js) ──► Postgres (MPG / local)
                 │
                 └──► Fly worker (scripts/worker.ts) ──► same Postgres
```

- **App** serves UI + API routes; readiness is `/api/health` (book present).
- **Worker** runs long jobs (replay, NPS rebuild, rollups) from the `Job` table.
- **Auth**: Basic or session (`AUTH_MODE`); demo clock/role cookies gated by `DEMO_FEATURES`.

Deploy configs:

| File | App |
|------|-----|
| `fly.toml` | Live demo `glass-pbm-demo` |
| `fly.foundation.toml` | Staging `glass-pbm-foundation` (optional canary) |

---

## `src/app` — **surface**

| Area | Routes | Notes |
|------|--------|-------|
| Marketing / home | `/` | Entry |
| Sponsor / claims / settlement | `/(app)/sponsor`, `claims`, `settlement` | Core demo path |
| Clinical / PA / MAC | `clinical`, `pa`, `mac` | Benefit operations |
| Experience | `experience`, `methodology` | NPS model UI |
| Integrity / agents | `integrity`, `agents`, `data-agent` | Oversight |
| Ops surfaces | `operations`, `throughput`, `reversals`, `reconciliation` | |
| Pitch | `/(pitch)/pitch` | Separate layout |
| Auth | `/login` | |
| API | `/api/**` | Health, auth, mutations, NPS snapshot |

Pages are mostly **server components** that call **read-model** loaders. Prefer putting SQL in `src/lib/queries/`, not in the page file.

---

## `src/lib` — domain + platform

### **engine** — adjudication core

`adjudicate.ts`, `pricing.ts`, `quantity-limit.ts`, `pos.ts`, `replay.ts`, `trace.ts`

Deterministic claim processing. Changes here need **proof** tests (`tests/golden.test.ts`, `determinism.test.ts`).

### **read-model** — `queries/`

One module per product surface (`sponsor.ts`, `claims.ts`, `nps.ts`, …).  
Raw SQL is adapted for Postgres via **platform** (`pg-sql.ts`). When adding SQL:

1. Prefer Prisma where simple.
2. For aggregates, use Postgres-safe `GROUP BY` / `MAX(...)` / `EXTRACT(EPOCH …)`.
3. Pass `Date` values into SQL — never epoch milliseconds as bare numbers.

### **clinical** / **pa** / **nps** / **integrity**

Domain rules and detectors. Heavy scans (e.g. experience over ~1.6M claims) must stay **sequential** against the Prisma pool behind PgBouncer.

### **platform**

| File | Role |
|------|------|
| `db.ts` | Prisma client + pooler-friendly URL params |
| `pg-sql.ts` | SQLite→Postgres SQL dialect adapter |
| `auth.ts` / `middleware.ts` | Auth gates |
| `config.ts` | Env (`AUTH_MODE`, `DEMO_FEATURES`, …) |
| `jobs.ts` + `scripts/worker.ts` | Async job queue |
| `clock.ts` / `session.ts` | Simulation clock + demo session |

---

## `prisma/` — **schema**

Source of truth for the book and platform tables (`Claim`, `Member`, `Job`, `User`, …).  
Migrate with `npm run db:push` (foundation) / documented cutover steps.

---

## `scripts/` — **book-build** + **ops**

| Kind | Examples |
|------|----------|
| Book construction | `seed/`, `build-*.ts`, `ingest/`, `reprocess-claims.ts` |
| Import / restore | `import-sqlite-to-pg.ts`, `restore-mpg.ts`, `restore-mpg-tables.ts` |
| Runtime | `worker.ts`, `worker-entry.mjs` |
| Checks | `check-*.ts`, `publish-harness.ts` |

Book-build scripts are **not** part of the Next.js typecheck surface (`tsconfig` excludes restore helpers).

---

## `tests/` — **proof**

Vitest suite + `results.json` harness artifacts. Treat failures here as product regressions, not “just CI noise.”

---

## `docs/` — operator manuals

| Doc | When to read |
|-----|----------------|
| [cutover.md](./cutover.md) | SQLite → Postgres / Fly cutover |
| [ops-runbook.md](./ops-runbook.md) | Incidents, health, backups |
| [local-postgres.md](./local-postgres.md) | Laptop Postgres |
| [data-growth.md](./data-growth.md) | Partition / archive strategy |
| [demo-talk-track.md](./demo-talk-track.md) | Narrative for demos |

---

## Where to put a new change

| If you are adding… | Put it in… |
|--------------------|------------|
| A new screen | `src/app/(app)/…` + `src/lib/queries/…` + nav in `components/nav.tsx` |
| Adjudication rule | `src/lib/engine/` + a **proof** test |
| Dashboard metric | `src/lib/queries/` (keep SQL Postgres-safe) |
| Background batch | `Job` type + worker handler in `scripts/worker.ts` / `src/lib/jobs.ts` |
| Deploy / restore procedure | `docs/` + script under `scripts/` |

---

## Environments (shared vocabulary)

| Name | URL / app | Notes |
|------|-----------|--------|
| **Local** | `localhost` + local Postgres | Dev |
| **Staging** | `glass-pbm-foundation` | Optional; often scaled to 0 |
| **Live demo** | `glass-pbm-demo` | Production demo; Postgres MPG |

Live demo and staging may share one MPG database — treat writes carefully.
