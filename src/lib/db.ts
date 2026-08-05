import { PrismaClient } from "@/generated/prisma";

/**
 * One connection to SQLite, and a patient one.
 *
 * Prisma sizes its pool for a network database, which is wrong for a file.
 * SQLite admits a single writer, and in write-ahead-log mode each pooled
 * connection carries its own read snapshot, so a pool turns ordinary contention
 * into errors that look like defects in the data:
 *
 *   - rows written on one connection are invisible to a sibling whose snapshot
 *     predates the commit, so inserting a child row fails a foreign key check
 *     against a parent that plainly exists;
 *   - two connections writing at once leave one waiting on a lock until it
 *     times out mid-batch.
 *
 * Both appeared while seeding a million and a half claims, only once the file
 * was large enough for commits to take real time, and both moved to a different
 * table on each run — the signature of a race rather than a bug in what is being
 * written. Serialising costs nothing here, because the writes were already
 * serialised by the engine underneath; the pool only obscured it.
 */
function connectionUrl(): string {
  const base = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  if (base.includes("connection_limit=")) return base;
  return `${base}${base.includes("?") ? "&" : "?"}connection_limit=1&socket_timeout=120`;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: connectionUrl() } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
