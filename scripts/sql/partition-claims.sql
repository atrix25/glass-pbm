-- Claim monthly partitioning outline (run after backup; see docs/data-growth.md)
-- Prisma keeps talking to parent table "Claim".

-- ALTER TABLE "Claim" RENAME TO "Claim_legacy";
-- CREATE TABLE "Claim" (LIKE "Claim_legacy" INCLUDING ALL) PARTITION BY RANGE ("dateOfService");
-- CREATE TABLE "Claim_2026_q1" PARTITION OF "Claim" FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
-- CREATE TABLE "Claim_2026_q2" PARTITION OF "Claim" FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
-- CREATE TABLE "Claim_2026_q3" PARTITION OF "Claim" FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
-- CREATE TABLE "Claim_2026_q4" PARTITION OF "Claim" FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
-- INSERT INTO "Claim" SELECT * FROM "Claim_legacy";
