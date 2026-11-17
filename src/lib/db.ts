import { PrismaClient } from "@/generated/prisma";
import {
  adaptSqliteDialect,
  quotePgSql,
  sqlitePlaceholdersToPg,
} from "@/lib/pg-sql";

/**
 * Shared Prisma client for Postgres.
 *
 * Prefer DATABASE_URL pointing at a pooler (PgBouncer / Fly Postgres pooler)
 * for the app tier. Direct URLs are fine for workers and migrations
 * (set DATABASE_URL_DIRECT when migrating).
 *
 * Raw SQL written for SQLite (unquoted PascalCase identifiers, `?` binds)
 * is adapted on the way in so the existing query surface keeps working.
 */
function connectionUrl(): string {
  const raw =
    process.env.DATABASE_URL_DIRECT ??
    process.env.DATABASE_URL ??
    "postgresql://localhost:5432/glass";
  try {
    const url = new URL(raw);
    // Keep Prisma pools small behind PgBouncer so multiple Fly machines
    // don't exhaust MPG (Experience/NPS holds connections for a long time).
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set(
        "connection_limit",
        process.env.PRISMA_CONNECTION_LIMIT ?? "2",
      );
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT ?? "60");
    }
    if (
      !url.searchParams.has("pgbouncer") &&
      /pgbouncer|pooler/i.test(url.hostname)
    ) {
      url.searchParams.set("pgbouncer", "true");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/*
 * Prisma builds the interactive-transaction client by cloning this one, so the
 * overrides below are inherited by the `tx` handed to a `$transaction`
 * callback. They must therefore forward to the original on `this` rather than
 * on a captured client: binding them to the long-lived client sends raw SQL
 * out on a pooled connection of its own, outside the caller's transaction,
 * where it commits on its own and takes no part in the rollback. That silently
 * defeated `SELECT … FOR UPDATE SKIP LOCKED` in claimNextJob, because the row
 * lock was released the instant the statement returned.
 */
function wrapClient(client: PrismaClient): PrismaClient {
  const raw = client.$queryRaw;
  const rawUnsafe = client.$queryRawUnsafe;
  const exec = client.$executeRaw;
  const execUnsafe = client.$executeRawUnsafe;

  function adapt(strings: TemplateStringsArray): TemplateStringsArray {
    const adapted = strings.map((part) => quotePgSql(adaptSqliteDialect(part)));
    return Object.assign([...adapted], { raw: adapted }) as unknown as TemplateStringsArray;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).$queryRaw = function (
    this: PrismaClient | undefined,
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) {
    return raw.call(this ?? client, adapt(strings), ...values);
  };

  (client as any).$executeRaw = function (
    this: PrismaClient | undefined,
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) {
    return exec.call(this ?? client, adapt(strings), ...values);
  };

  (client as any).$queryRawUnsafe = function (
    this: PrismaClient | undefined,
    query: string,
    ...values: unknown[]
  ) {
    return rawUnsafe.call(this ?? client, sqlitePlaceholdersToPg(query), ...values);
  };

  (client as any).$executeRawUnsafe = function (
    this: PrismaClient | undefined,
    query: string,
    ...values: unknown[]
  ) {
    return execUnsafe.call(this ?? client, sqlitePlaceholdersToPg(query), ...values);
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return client;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  wrapClient(
    new PrismaClient({
      datasources: { db: { url: connectionUrl() } },
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    }),
  );

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
