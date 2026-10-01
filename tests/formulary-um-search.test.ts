/**
 * Formulary UM search must apply the drug-name filter to both the count and
 * the result set. Counting every PA product and then filtering an alphabetical
 * prefix in memory inflated totals and dropped real matches (e.g. Zytiga).
 */

import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dbPath = path.resolve("prisma/test-formulary-um-search.db");
const FORMULARY_ID = "navitus-etf-2026";

describe("formulary UM search respects the drug name filter", () => {
  let searchFormularyUtilizationManagement: typeof import("@/lib/queries/formulary-um").searchFormularyUtilizationManagement;
  let prisma: import("@/generated/prisma").PrismaClient;

  beforeAll(async () => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    process.env.DATABASE_URL = `file:${dbPath}`;
    execFileSync(
      "npx",
      ["prisma", "db", "push", "--skip-generate"],
      {
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      },
    );

    vi.resetModules();
    ({ searchFormularyUtilizationManagement } = await import(
      "@/lib/queries/formulary-um"
    ));
    ({ prisma } = await import("@/lib/db"));

    await prisma.formulary.create({
      data: {
        id: FORMULARY_ID,
        name: "Test formulary",
        version: "test",
        effectiveDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    // Enough earlier alphabetical PA rows that a trailing name falls past the
    // old in-memory take(500) window.
    const early = Array.from({ length: 510 }, (_, i) => {
      const n = String(i).padStart(3, "0");
      return {
        id: `drug-early-${n}`,
        ndc11: `11111111${n}`,
        name: `AAA EARLY ${n}`,
      };
    });
    await prisma.drug.createMany({
      data: [
        ...early,
        { id: "drug-zytiga", ndc11: "99999999999", name: "ZYTIGA TAB 250MG" },
      ],
    });
    await prisma.formularyEntry.createMany({
      data: [
        ...early.map((d) => ({
          formularyId: FORMULARY_ID,
          drugId: d.id,
          level: "3",
          requiresPA: true,
        })),
        {
          formularyId: FORMULARY_ID,
          drugId: "drug-zytiga",
          level: "4",
          requiresPA: true,
        },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("counts and returns only name matches, including late alphabet drugs", async () => {
    const clock = {
      today: new Date("2026-06-01T00:00:00.000Z"),
      now: new Date("2026-06-01T12:00:00.000Z"),
    };
    const result = await searchFormularyUtilizationManagement(clock as never, {
      flag: "pa",
      query: "Zytiga",
      limit: 25,
    });

    expect(result.totalMatching).toBe(1);
    expect(result.returned).toBe(1);
    expect(result.drugs.map((d) => d.name)).toEqual(["ZYTIGA TAB 250MG"]);
  });

  it("still reports the full flag total when no name filter is supplied", async () => {
    const clock = {
      today: new Date("2026-06-01T00:00:00.000Z"),
      now: new Date("2026-06-01T12:00:00.000Z"),
    };
    const result = await searchFormularyUtilizationManagement(clock as never, {
      flag: "pa",
      limit: 25,
    });

    expect(result.totalMatching).toBe(511);
    expect(result.returned).toBe(25);
  });
});
