# Local Postgres for Glass foundation

```bash
brew services start postgresql@16
createdb glass
cp .env.example .env   # set DATABASE_URL

npm run db:generate
npm run db:push

# Optional: import existing SQLite book
npx tsx scripts/import-sqlite-to-pg.ts

npm run dev
# Worker (separate terminal):
npm run worker
```

Docker Compose alternative:

```bash
docker compose up -d postgres
```
