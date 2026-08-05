import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  const cross = await prisma.$queryRaw<
    Array<{ level: string; brand: number; n: number }>
  >`
    SELECT f.level AS level, d.isBrandLabel AS brand, COUNT(*) AS n
    FROM FormularyEntry f JOIN Drug d ON d.id = f.drugId
    GROUP BY f.level, d.isBrandLabel ORDER BY f.level, brand
  `;
  console.log("formulary entries by level and brand flag:");
  for (const r of cross) {
    console.log(
      `  L${String(r.level).padEnd(8)} brand=${r.brand ? "Y" : "N"}  ${Number(r.n)}`,
    );
  }

  const mony = await prisma.$queryRaw<
    Array<{ monyCode: string; brand: number; n: number }>
  >`
    SELECT d.monyCode AS monyCode, d.isBrandLabel AS brand, COUNT(*) AS n
    FROM FormularyEntry f JOIN Drug d ON d.id = f.drugId
    GROUP BY d.monyCode, d.isBrandLabel
  `;
  console.log("\nby MONY code:");
  for (const r of mony) {
    console.log(
      `  ${String(r.monyCode).padEnd(4)} brand=${r.brand ? "Y" : "N"}  ${Number(r.n)}`,
    );
  }

  // Products whose name is upper case (the formulary's brand convention) but
  // which are not flagged as brands.
  const suspect = await prisma.$queryRaw<
    Array<{ name: string; level: string; mony: string }>
  >`
    SELECT d.name AS name, f.level AS level, d.monyCode AS mony
    FROM FormularyEntry f JOIN Drug d ON d.id = f.drugId
    WHERE d.isBrandLabel = 0 AND d.name = UPPER(d.name) AND f.level IN ('2','3')
    LIMIT 25
  `;
  console.log(
    `\nupper-case names at L2/L3 not flagged brand (${suspect.length} shown):`,
  );
  for (const r of suspect) {
    console.log(`  ${r.name.slice(0, 44).padEnd(46)} L${r.level} mony=${r.mony}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
