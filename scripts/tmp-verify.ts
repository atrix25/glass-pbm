import { PrismaClient } from "../src/generated/prisma/index.js";
import { moleculeKey } from "../src/lib/clinical/molecules.js";
import {
  DISPENSING_VOLUME,
  UNLISTED_MOLECULE_WEIGHT,
  dispensingWeightForProduct,
} from "../src/lib/clinical/dispensing-volume.js";

const prisma = new PrismaClient();

async function main() {
  const entries = await prisma.formularyEntry.findMany({
    include: {
      drug: { select: { id: true, name: true, nadacDescription: true } },
    },
  });

  // How much published volume now finds a home in the formulary?
  const matchedVolume = new Set<number>();
  let productsMatched = 0;
  for (const e of entries) {
    const w = dispensingWeightForProduct(e.drug.name, e.drug.nadacDescription);
    if (w !== UNLISTED_MOLECULE_WEIGHT) {
      productsMatched++;
      matchedVolume.add(w);
    }
  }
  const publishedTotal = [...DISPENSING_VOLUME.values()].reduce((a, b) => a + b, 0);
  const claimed = [...matchedVolume].reduce((a, b) => a + b, 0);
  console.log(
    `${productsMatched} of ${entries.length} formulary products matched a published molecule`,
  );
  console.log(
    `published volume reachable: ${((claimed / publishedTotal) * 100).toFixed(1)}%`,
  );

  const stillMissing = [...DISPENSING_VOLUME.entries()]
    .filter(([, v]) => !matchedVolume.has(v))
    .sort((a, b) => b[1] - a[1]);
  console.log(`\n${stillMissing.length} published molecules still unmatched; largest:`);
  for (const [k, v] of stillMissing.slice(0, 25)) {
    console.log(`  ${(v / 1e6).toFixed(1).padStart(6)}M  ${k}`);
  }

  // Spot-check the ones that were broken before.
  console.log("\nspot checks:");
  for (const n of [
    "LANTUS INJ",
    "TRULICITY INJ",
    "MOUNJARO INJ",
    "JANUVIA TAB",
    "OZEMPIC INJ",
    "JARDIANCE TAB",
    "SINGULAIR TAB",
  ]) {
    const e = entries.find((x) => x.drug.name.toUpperCase().startsWith(n.split(" ")[0]!));
    if (!e) {
      console.log(`  ${n.padEnd(18)} not in formulary`);
      continue;
    }
    const w = dispensingWeightForProduct(e.drug.name, e.drug.nadacDescription);
    console.log(
      `  ${e.drug.name.slice(0, 26).padEnd(28)} key=${moleculeKey(e.drug.nadacDescription, e.drug.name).padEnd(22)} weight=${(w / 1e6).toFixed(1)}M${w === UNLISTED_MOLECULE_WEIGHT ? "  (FLOOR)" : ""}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
