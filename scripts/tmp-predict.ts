/**
 * Predict the book's drug mix from the pools alone.
 *
 * A full rebuild is eighteen minutes, which is too slow to tune a distribution
 * against. The mix a member draws is decided entirely by the weighted pools, so
 * the expected level, brand and price mix can be computed from the weights
 * directly. Adjudication changes what each fill costs the member but not which
 * drug was reached, so this predicts spend per fill closely enough to aim with.
 */
import { PrismaClient } from "../src/generated/prisma/index.js";
import { moleculeKey } from "../src/lib/clinical/molecules.js";
import {
  dispensingWeightForProduct,
  dosageFormShare,
  UNLISTED_MOLECULE_WEIGHT,
} from "../src/lib/clinical/dispensing-volume.js";

const prisma = new PrismaClient();

const BRAND_SHARE_WITHIN_MOLECULE = Number(
  process.env.BRAND_SHARE ?? "0.08",
);

const SPECIALTY_PRICE_THRESHOLD_PER_UNIT = 100;

interface Cand {
  id: string;
  name: string;
  nadacDescription: string | null;
  isBrandLabel: boolean;
  isSpecialty: boolean;
  level: string;
  perUnit: number;
  cls: string;
  notCovered: boolean;
}

async function main() {
  const entries = await prisma.formularyEntry.findMany({
    include: {
      drug: {
        select: {
          id: true,
          name: true,
          nadacDescription: true,
          isBrandLabel: true,
          isSpecialty: true,
          therapeuticClass: true,
        },
      },
    },
  });
  const prices = new Map(
    (await prisma.drugPrice.findMany()).map((p) => [p.drugId, p.unitPrice]),
  );

  const all: Cand[] = entries.map((e) => ({
    id: e.drug.id,
    name: e.drug.name,
    nadacDescription: e.drug.nadacDescription,
    isBrandLabel: e.drug.isBrandLabel,
    isSpecialty: e.drug.isSpecialty,
    level: e.level,
    perUnit: prices.get(e.drug.id) ?? 0,
    cls: e.drug.therapeuticClass ?? "Unclassified",
    notCovered: e.notCovered || !["1", "2", "3", "4", "$0"].includes(e.level),
  }));

  // The routine pool, mirroring isRoutineTherapy.
  const routine = all.filter(
    (d) =>
      !d.notCovered &&
      !d.isSpecialty &&
      d.level !== "4" &&
      d.perUnit < SPECIALTY_PRICE_THRESHOLD_PER_UNIT,
  );

  // Weights, mirroring buildWeightedPool.
  const byMolecule = new Map<string, Cand[]>();
  for (const d of routine) {
    const k = moleculeKey(d.nadacDescription, d.name);
    const l = byMolecule.get(k);
    if (l) l.push(d);
    else byMolecule.set(k, [d]);
  }
  const weight = new Map<string, number>();
  for (const [, products] of byMolecule) {
    const first = products[0]!;
    const volume = dispensingWeightForProduct(first.name, first.nadacDescription);
    const brands = products.filter((p) => p.isBrandLabel);
    const generics = products.filter((p) => !p.isBrandLabel);
    const share = (group: Cand[], pool: number) => {
      const forms = group.map((p) => dosageFormShare(p.name));
      const denom = forms.reduce((a, b) => a + b, 0);
      group.forEach((p, i) => {
        weight.set(p.id, denom > 0 ? (pool * forms[i]!) / denom : 0);
      });
    };
    if (brands.length === 0 || generics.length === 0) {
      share(products, volume);
      continue;
    }
    share(brands, volume * BRAND_SHARE_WITHIN_MOLECULE);
    share(generics, volume * (1 - BRAND_SHARE_WITHIN_MOLECULE));
  }

  const total = routine.reduce(
    (s, d) => s + (weight.get(d.id) ?? UNLISTED_MOLECULE_WEIGHT),
    0,
  );

  // Expected mix over the routine pool.
  const level = new Map<string, number>();
  let brandShare = 0;
  let expectedUnitPrice = 0;
  for (const d of routine) {
    const p = (weight.get(d.id) ?? UNLISTED_MOLECULE_WEIGHT) / total;
    level.set(d.level, (level.get(d.level) ?? 0) + p);
    if (d.isBrandLabel) brandShare += p;
    expectedUnitPrice += p * d.perUnit;
  }

  // A 30-day fill of an oral solid is the modal claim, so unit price times
  // thirty is a usable proxy for what a fill bills at.
  const spendProxy = routine.reduce(
    (s, d) =>
      s +
      ((weight.get(d.id) ?? UNLISTED_MOLECULE_WEIGHT) / total) * d.perUnit * 30,
    0,
  );

  console.log(`BRAND_SHARE_WITHIN_MOLECULE = ${BRAND_SHARE_WITHIN_MOLECULE}`);
  console.log(
    `expected billed per routine fill (proxy): $${spendProxy.toFixed(2)}`,
  );
  console.log(`routine pool: ${routine.length} products\n`);
  console.log("expected level mix of a routine fill:");
  for (const [k, v] of [...level.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  L${k.padEnd(6)} ${(v * 100).toFixed(1).padStart(5)}%`);
  }
  console.log(
    `\nexpected brand share of routine fills: ${(brandShare * 100).toFixed(1)}%  (need ~12% overall for an 88% generic rate)`,
  );
  console.log(
    `expected NADAC per unit of a routine fill: $${expectedUnitPrice.toFixed(2)}`,
  );

  // The 25 products carrying the most weight, as a realism check.
  const top = routine
    .map((d) => ({
      d,
      p: (weight.get(d.id) ?? UNLISTED_MOLECULE_WEIGHT) / total,
    }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 25);
  console.log("\nheaviest routine products:");
  for (const { d, p } of top) {
    console.log(
      `  ${(p * 100).toFixed(2).padStart(5)}%  ${d.name.slice(0, 34).padEnd(36)} L${d.level.padEnd(3)} $${d.perUnit.toFixed(2)}/unit`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
