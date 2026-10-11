import './migrate-member-service.mjs';
import pg from 'pg';
import fs from 'node:fs';
const c=new pg.Client({connectionString:process.env.DATABASE_URL_DIRECT??process.env.DATABASE_URL??'postgresql://localhost:5432/glass'});
await c.connect();
try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(876241014)');await c.query('CREATE TABLE IF NOT EXISTS "GlassMigration" ("id" TEXT PRIMARY KEY,"appliedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');if(!(await c.query('SELECT id FROM "GlassMigration" WHERE id=$1',['20261011_gemma'])).rowCount){await c.query(fs.readFileSync(new URL('../prisma/migrations/20261011_gemma/migration.sql',import.meta.url),'utf8'));await c.query('INSERT INTO "GlassMigration" (id) VALUES ($1)',['20261011_gemma']);}await c.query('COMMIT');console.log('Gemma additive migration ready. Monitoring remains disabled until explicitly enabled.')}catch(e){await c.query('ROLLBACK');throw e}finally{await c.end()}
