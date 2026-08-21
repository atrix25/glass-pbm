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
  return (
    process.env.DATABASE_URL_DIRECT ??
    process.env.DATABASE_URL ??
    "postgresql://localhost:5432/glass"
  );
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
