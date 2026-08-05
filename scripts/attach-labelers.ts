/**
 * Fills in Drug.labeler from the FDA NDC Directory.
 *
 * Run after ingestion, before rebate invoicing, because an invoice needs a
 * payer. Reports the match rate: an exact hit on labeler+product, a fallback
 * to the labeler code, or nothing at all for NDCs the FDA has since delisted.
 *
 *   npx tsx scripts/attach-labelers.ts
 */

import { prisma } from "../src/lib/db.js";
import { loadLabelers, parentCompany } from "./ingest/ndc-labelers.js";

const PRODUCT_FILE = "data/raw/ndc/product.txt";

async function main() {
  console.log("Reading the FDA NDC Directory...");
  const { byProduct, byLabeler } = await loadLabelers(PRODUCT_FILE);
  console.log(
    `  ${byProduct.size.toLocaleString()} products, ` +
      `${byLabeler.size.toLocaleString()} labeler codes`,
  );

  const drugs = await prisma.drug.findMany({
    select: { id: true, ndc11: true, name: true },
  });

  let exact = 0;
  let byCode = 0;
  let missed = 0;
  const updates: Array<{ id: string; labeler: string }> = [];

  for (const d of drugs) {
    const ndc = d.ndc11.replace(/\D/g, "").padStart(11, "0");
    const productKey = ndc.slice(0, 9);
    const codeKey = ndc.slice(0, 5);

    const fdaName = byProduct.get(productKey) ?? byLabeler.get(codeKey);
    if (!fdaName) {
      missed++;
      continue;
    }
    if (byProduct.has(productKey)) exact++;
    else byCode++;
    updates.push({ id: d.id, labeler: parentCompany(fdaName) });
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.drug.update({ where: { id: u.id }, data: { labeler: u.labeler } }),
    ),
  );

  const pct = (n: number) => ((n / drugs.length) * 100).toFixed(1);
  console.log(
    `\nAttributed ${updates.length.toLocaleString()} of ${drugs.length.toLocaleString()} drugs:\n` +
      `  ${exact.toLocaleString()} (${pct(exact)}%) matched on labeler and product\n` +
      `  ${byCode.toLocaleString()} (${pct(byCode)}%) matched on the labeler code alone\n` +
      `  ${missed.toLocaleString()} (${pct(missed)}%) not in the current directory`,
  );

  const top = await prisma.$queryRawUnsafe<
    Array<{ labeler: string; drugs: bigint; rebate: bigint }>
  >(`
    SELECT d.labeler AS labeler, COUNT(DISTINCT d.id) AS drugs,
           COALESCE(SUM(c.estimatedRebateCents), 0) / 100 AS rebate
    FROM Drug d LEFT JOIN Claim c
      ON c.drugId = d.id AND c.estimatedRebateCents > 0 AND c.transactionCode = 'B1'
    WHERE d.labeler IS NOT NULL
    GROUP BY d.labeler HAVING rebate > 0
    ORDER BY rebate DESC LIMIT 12
  `);
  console.log("\nTop manufacturers by rebate accrual:");
  for (const t of top) {
    console.log(
      `  ${t.labeler.padEnd(28)} ${String(t.drugs).padStart(3)} drugs  ` +
        `$${Number(t.rebate).toLocaleString()}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
