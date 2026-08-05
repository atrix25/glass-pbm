/**
 * Attach FDA package sizes to the drugs in this book.
 *
 * Without these, every formulary limit written in packages — twelve tubes a
 * year, one inhaler per thirty days, four vials per fill — is a number the
 * engine cannot compare to anything. Seventy-five of the 687 parsed limits are
 * written that way, and they cover the inhalers and topicals that a benefit
 * manager most wants a limit on.
 *
 *   npx tsx scripts/attach-packages.ts          # report only
 *   npx tsx scripts/attach-packages.ts --write  # apply
 */

import { prisma } from "../src/lib/db.js";
import { loadPackages } from "./ingest/ndc-packages.js";
import { resolvePackage } from "../src/lib/engine/quantity-limit.js";

const PACKAGE_FILE = "data/raw/ndc/package.txt";
const WRITE = process.argv.includes("--write");

async function main() {
  console.log("Reading package descriptions from the FDA NDC Directory...");
  const { byNdc11, byProduct, rows, unparsed } = await loadPackages(PACKAGE_FILE);
  console.log(
    `  ${rows.toLocaleString()} package rows, ${byNdc11.size.toLocaleString()} with a measurable size` +
      ` (${unparsed.toLocaleString()} count tablets or capsules and need no conversion)\n`,
  );

  const drugs = await prisma.drug.findMany({
    select: {
      id: true,
      ndc11: true,
      name: true,
      unitOfMeasure: true,
      formularyEntries: {
        select: { qlBasis: true, qlUnit: true, qlRawText: true },
      },
    },
  });
  console.log(`${drugs.length.toLocaleString()} drugs in the book`);

  let matchedExact = 0;
  let matchedProduct = 0;
  let unmatched = 0;
  let unitMismatch = 0;
  const packageLimitsResolved: string[] = [];
  const packageLimitsStillOpen: string[] = [];

  for (const drug of drugs) {
    const contents =
      byNdc11.get(drug.ndc11) ?? byProduct.get(drug.ndc11.slice(0, 9));
    const exact = byNdc11.has(drug.ndc11);

    const packageLimit = drug.formularyEntries.find(
      (e) => e.qlBasis === "package",
    );

    if (!contents) {
      unmatched++;
      if (packageLimit) {
        packageLimitsStillOpen.push(
          `${drug.name} — ${packageLimit.qlRawText} — no FDA package row for NDC ${drug.ndc11}`,
        );
      }
      continue;
    }

    if (exact) matchedExact++;
    else matchedProduct++;

    /*
     * A total is only meaningful in the unit the pharmacy bills in. Where the
     * FDA measures a package in millilitres and NADAC prices the drug per each,
     * the two are describing the same package at different granularities: the
     * each is the vial. The container map still holds — it says a vial exists
     * and what is in it — so it is recorded either way, and only the total is
     * withheld, because a total in the wrong unit is worse than no total.
     */
    const unitsAgree = contents.unit === drug.unitOfMeasure;
    if (!unitsAgree) unitMismatch++;

    if (packageLimit) {
      // Asked of the engine's own resolver, so this report cannot claim a limit
      // is enforceable that adjudication will then decline to enforce.
      const conversion = resolvePackage(packageLimit.qlUnit, {
        containers: Object.fromEntries(contents.byContainer),
        packageSize: unitsAgree ? contents.total : null,
        unitOfMeasure: drug.unitOfMeasure,
      });
      if (conversion) {
        packageLimitsResolved.push(
          `${drug.name.slice(0, 38).padEnd(40)} ${String(packageLimit.qlRawText).padEnd(24)} ${conversion.basis}`,
        );
      } else {
        packageLimitsStillOpen.push(
          `${drug.name} — ${packageLimit.qlRawText} — FDA describes ${[...contents.byContainer.keys()].join(", ")}, and nothing maps those onto ${packageLimit.qlUnit}`,
        );
      }
    }

    if (!WRITE) continue;

    await prisma.drug.update({
      where: { id: drug.id },
      data: {
        ...(unitsAgree ? { packageSize: contents.total } : {}),
        packageContainers: JSON.stringify(
          Object.fromEntries(contents.byContainer),
        ),
        packageDescription: contents.description,
      },
    });
  }

  console.log(`  matched on the full 11-digit NDC:   ${matchedExact.toLocaleString()}`);
  console.log(`  matched on labeler and product:     ${matchedProduct.toLocaleString()}`);
  console.log(`  no FDA package row:                 ${unmatched.toLocaleString()}`);
  console.log(
    `  containers kept but total withheld: ${unitMismatch.toLocaleString()} (FDA and NADAC measure these differently)`,
  );

  console.log(
    `\nPackage-written limits now enforceable: ${packageLimitsResolved.length}`,
  );
  for (const line of packageLimitsResolved) console.log(`    ${line}`);

  console.log(
    `\nPackage-written limits still unenforceable: ${packageLimitsStillOpen.length}`,
  );
  for (const line of packageLimitsStillOpen) console.log(`    ${line}`);

  console.log(WRITE ? "\nWritten." : "\nDry run. Pass --write to apply.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
