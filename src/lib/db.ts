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

function wrapClient(client: PrismaClient): PrismaClient {
  const raw = client.$queryRaw.bind(client);
  const rawUnsafe = client.$queryRawUnsafe.bind(client);
  const exec = client.$executeRaw.bind(client);
  const execUnsafe = client.$executeRawUnsafe.bind(client);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$queryRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const adapted = strings.map((part) => quotePgSql(adaptSqliteDialect(part)));
    const next = Object.assign([...adapted], { raw: adapted }) as TemplateStringsArray;
    return raw(next, ...values);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$executeRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const adapted = strings.map((part) => quotePgSql(adaptSqliteDialect(part)));
    const next = Object.assign([...adapted], { raw: adapted }) as TemplateStringsArray;
    return exec(next, ...values);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$queryRawUnsafe = (query: string, ...values: unknown[]) =>
    rawUnsafe(sqlitePlaceholdersToPg(query), ...values);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$executeRawUnsafe = (query: string, ...values: unknown[]) =>
    execUnsafe(sqlitePlaceholdersToPg(query), ...values);

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
