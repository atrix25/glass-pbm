// Explicit additive migration. Does not run schema synchronization.
import pg from 'pg';
import fs from 'node:fs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL_DIRECT??process.env.DATABASE_URL??'postgresql://localhost:5432/glass'});
await client.connect();
try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(876241013)");await client.query(fs.readFileSync(new URL('../prisma/migrations/20261011_member_service/migration.sql',import.meta.url),'utf8'));await client.query('COMMIT');console.log('Member service tables ready. Existing tables preserved.');}catch(e){await client.query('ROLLBACK');throw e}finally{await client.end()}
