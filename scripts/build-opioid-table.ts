/**
 * Builds the opioid dosing table by reading strengths out of the CMS NADAC
 * file and pairing them with the CDC conversion factors.
 *
 *   npx tsx scripts/build-opioid-table.ts
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { prisma } from "../src/lib/db.js";
import { parseOpioid } from "../src/lib/clinical/opioids.js";

const NADAC_PATH = "data/raw/nadac-2026-07-29.csv";

/** Minimal CSV field split; NADAC quotes any description containing a comma. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  const opioidDrugs = await prisma.drug.findMany({
    where: { therapeuticClass: "ANALGESICS - OPIOID" },
    select: { id: true, name: true },
  });
  const wanted = new Map(opioidDrugs.map((d) => [d.id.replace(/^drug-/, ""), d]));
  console.log(`${wanted.size} opioid products in the formulary`);

  const descriptions = new Map<string, string>();
  const rl = createInterface({
    input: createReadStream(NADAC_PATH),
    crlfDelay: Infinity,
  });
  let header: string[] | null = null;
  for await (const line of rl) {
    if (!header) {
      header = splitCsv(line);
      continue;
    }
    const cols = splitCsv(line);
    const ndc = cols[1]?.trim();
    if (ndc && wanted.has(ndc) && !descriptions.has(ndc)) {
      descriptions.set(ndc, cols[0].trim());
    }
  }
  console.log(`${descriptions.size} matched in the NADAC file`);

  const rows: Array<{
    drugId: string;
    molecule: string;
    strengthMg: number;
    mmeFactor: number;
    isTransdermal: boolean;
    convertible: boolean;
    exclusionReason: string | null;
    sourceDescription: string;
  }> = [];
  const skipped: string[] = [];

  for (const [ndc, desc] of descriptions) {
    const parsed = parseOpioid(desc);
    if (!parsed) {
      skipped.push(`${ndc}  ${desc}`);
      continue;
    }
    rows.push({
      drugId: `drug-${ndc}`,
      molecule: parsed.molecule,
      strengthMg: parsed.strengthMg,
      mmeFactor: parsed.mmeFactor,
      isTransdermal: parsed.isTransdermal,
      convertible: parsed.convertible,
      exclusionReason: parsed.exclusionReason,
      sourceDescription: desc,
    });
  }

  await prisma.opioidProduct.deleteMany({});
  await prisma.opioidProduct.createMany({ data: rows });

  console.log(`\nWrote ${rows.length} opioid products:`);
  for (const r of rows.sort((a, b) => a.molecule.localeCompare(b.molecule))) {
    const dose = r.isTransdermal
      ? `${r.strengthMg} mcg/hr`
      : `${r.strengthMg} mg`;
    const conv = r.convertible ? `x${r.mmeFactor}` : "not converted";
    console.log(`  ${r.molecule.padEnd(15)} ${dose.padEnd(14)} ${conv.padEnd(14)} ${r.sourceDescription}`);
  }

  if (skipped.length > 0) {
    console.log(`\nNot parsed (${skipped.length}), left out rather than guessed:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
