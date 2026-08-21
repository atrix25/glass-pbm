import "server-only";
import { prisma } from "@/lib/db";

/**
 * Durable copy overrides stored in Postgres (survives deploys and scales
 * across app machines). Falls back to empty when the table is unreachable.
 */

export type CopyOverrides = Record<string, string>;

export async function getCopyOverrides(): Promise<CopyOverrides> {
  try {
    const rows = await prisma.copyOverride.findMany();
    return Object.fromEntries(
      rows
        .filter((r) => r.replacement !== r.original)
        .map((r) => [r.original, r.replacement]),
    );
  } catch {
    return {};
  }
}

export async function saveCopyOverride(
  original: string,
  replacement: string | null,
  updatedById?: string | null,
): Promise<boolean> {
  try {
    if (replacement === null || replacement === original) {
      await prisma.copyOverride.deleteMany({ where: { original } });
      return true;
    }
    await prisma.copyOverride.upsert({
      where: { original },
      create: {
        original,
        replacement,
        updatedById: updatedById ?? null,
      },
      update: {
        replacement,
        updatedById: updatedById ?? null,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function copyIsPersistable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "CopyOverride" LIMIT 0`;
    return true;
  } catch {
    return false;
  }
}
