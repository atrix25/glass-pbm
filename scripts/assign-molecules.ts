/**
 * Resolves every formulary product to its active ingredient.
 *
 *   npx tsx scripts/assign-molecules.ts
 */

import { prisma } from "../src/lib/db.js";
import { moleculeKey } from "../src/lib/clinical/molecules.js";

async function main() {
  const drugs = await prisma.drug.findMany({
    select: { id: true, name: true, nadacDescription: true },
  });

  const updates = drugs.map((d) => ({
    id: d.id,
    molecule: moleculeKey(d.nadacDescription, d.name),
  }));

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _Mol`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE _Mol (id TEXT PRIMARY KEY, molecule TEXT)`,
  );
  for (let i = 0; i < updates.length; i += 500) {
    const slice = updates.slice(i, i + 500);
    const params: string[] = [];
    for (const u of slice) params.push(u.id, u.molecule);
    await prisma.$executeRawUnsafe(
      `INSERT INTO _Mol (id, molecule) VALUES ${slice.map(() => "(?,?)").join(",")}`,
      ...params,
    );
  }
  await prisma.$executeRawUnsafe(
    `UPDATE Drug SET molecule = (SELECT molecule FROM _Mol WHERE _Mol.id = Drug.id)`,
  );
  await prisma.$executeRawUnsafe(`DROP TABLE _Mol`);

  const distinct = new Set(updates.map((u) => u.molecule));
  console.log(
    `${drugs.length} products resolved to ${distinct.size} molecules`,
  );

  const collapsed = await prisma.$queryRaw<
    Array<{ molecule: string; products: number; names: string }>
  >`
    SELECT molecule, COUNT(*) AS products, GROUP_CONCAT(name, ' / ') AS names
    FROM Drug WHERE molecule IS NOT NULL
    GROUP BY molecule HAVING COUNT(*) > 2
    ORDER BY products DESC LIMIT 12
  `;
  console.log("\nProducts collapsed onto one molecule:");
  for (const c of collapsed) {
    console.log(`  ${c.molecule.padEnd(24)} ${c.products}  ${c.names.slice(0, 90)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
