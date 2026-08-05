/**
 * Apply the corrected formulary parse to an already-seeded database.
 *
 * The ingest is destructive by design: it replaces the drug catalogue, which is
 * fine on a fresh build and impossible once 1.7 million claims point at those
 * drug rows. So when the parser is fixed, the fix has to be able to reach a
 * book that already exists.
 *
 * Three defects are repaired here, all traceable to one cause — `\([^)]*\)` does
 * not match nested brackets, and this document nests them:
 *
 *  1. Product names truncated mid-clause. 42 rows were stored as
 *     "morphine sulfate ER tab )", and several as
 *     "DEXCOM G6 RECEIVER required if member is not currently utilizing
 *     insulin)", where the tail of a utilisation rule became part of the name.
 *  2. `requiredDiagnosisCodes` empty on every row. The ICD-10 code the
 *     restriction exists to name sits in its own brackets — "Diagnosis
 *     Restricted – Type 2 Diabetes (E11)" — so the clause was cut before the
 *     code. The engine reads this field to enforce the restriction, which meant
 *     the edit could never fire on any drug.
 *  3. `diagnosisRawText` holding the specialist restriction instead, because
 *     the two edits shared one column and the diagnosis text was the one that
 *     lost.
 *
 * Rows are matched on the citation each entry already stores, which records the
 * index page and the raw printed name. That is an exact key back to the source
 * line, so nothing here depends on guessing which database row a parsed row
 * became.
 *
 *   npx tsx scripts/repair-formulary.ts          # report only
 *   npx tsx scripts/repair-formulary.ts --write  # apply
 */

import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
import { extractPdfLines } from "./ingest/pdf.js";
import {
  decodeFormularyRow,
  parseFormularyIndex,
  type DecodedFormularyEntry,
} from "./ingest/formulary.js";

const PDF = "data/raw/navitus-etf-formulary-2026.pdf";
const FORMULARY_ID = "navitus-etf-2026";
const WRITE = process.argv.includes("--write");

/** The citation the ingest writes, reproduced so it can be used as a key. */
function citationFor(row: DecodedFormularyEntry): string {
  return `Alphabetical Index page ${row.page}: ${row.drugName.slice(0, 120)}`;
}

async function main() {
  const pages = await extractPdfLines(new Uint8Array(readFileSync(PDF)), {
    maxPages: 106,
  });
  const rows = parseFormularyIndex(pages).map(decodeFormularyRow);
  const byCitation = new Map(rows.map((r) => [citationFor(r), r]));
  console.log(`parsed ${rows.length} rows from the index`);

  const entries = await prisma.formularyEntry.findMany({
    where: { formularyId: FORMULARY_ID },
    include: { drug: { select: { id: true, name: true } } },
  });
  console.log(`${entries.length} formulary entries in the database\n`);

  const renames: { from: string; to: string }[] = [];
  const dxFixed: { name: string; codes: string[]; text: string }[] = [];
  const qlFixed: { name: string; printed: string }[] = [];
  let specialistMoved = 0;
  let unmatched = 0;

  for (const entry of entries) {
    const row = entry.citation ? byCitation.get(entry.citation) : undefined;
    if (!row) {
      unmatched++;
      continue;
    }

    const drugData: { name?: string; genericName?: string | null } = {};
    if (row.cleanName && row.cleanName !== entry.drug.name) {
      renames.push({ from: entry.drug.name, to: row.cleanName });
      drugData.name = row.cleanName;
      drugData.genericName = row.isBrandName ? null : row.cleanName;
    }

    const codes = JSON.stringify(row.requiredDiagnosisCodes);
    if (codes !== entry.requiredDiagnosisCodes && row.requiredDiagnosisCodes.length) {
      dxFixed.push({
        name: row.cleanName,
        codes: row.requiredDiagnosisCodes,
        text: row.diagnosisRawText ?? "",
      });
    }
    if (row.specialistRawText && !entry.specialistRawText) specialistMoved++;

    const qlChanged =
      (row.qlQuantity ?? null) !== entry.qlQuantity ||
      (row.qlDays ?? null) !== entry.qlDays ||
      (row.qlUnit ?? null) !== entry.qlUnit ||
      (row.qlBasis ?? null) !== entry.qlBasis;
    if (qlChanged && row.qlQuantity !== undefined) {
      qlFixed.push({
        name: row.cleanName,
        printed: `${row.qlQuantity} ${row.qlUnit ?? "?"} per ${
          row.qlDays ? `${row.qlDays} days` : "fill"
        } [${row.qlBasis ?? "unclassified unit"}]`,
      });
    }

    if (!WRITE) continue;

    if (drugData.name) {
      await prisma.drug.update({ where: { id: entry.drug.id }, data: drugData });
    }
    await prisma.formularyEntry.update({
      where: { id: entry.id },
      data: {
        requiredDiagnosisCodes: codes,
        diagnosisRawText: row.diagnosisRawText ?? null,
        specialistRawText: row.specialistRawText ?? null,
        diagnosisRestricted: row.diagnosisRestricted,
        specialistRestricted: row.specialistRestricted,
        hasQuantityLimit: row.hasQuantityLimit,
        qlQuantity: row.qlQuantity ?? null,
        qlDays: row.qlDays ?? null,
        qlRawText: row.qlRawText ?? null,
        qlUnit: row.qlUnit ?? null,
        qlBasis: row.qlBasis ?? null,
      },
    });
  }

  console.log(`names corrected:            ${renames.length}`);
  for (const r of renames.slice(0, 12)) {
    console.log(`    ${JSON.stringify(r.from)}\n      -> ${JSON.stringify(r.to)}`);
  }
  console.log(`\ndiagnosis restrictions now carrying ICD-10 codes: ${dxFixed.length}`);
  for (const d of dxFixed) {
    console.log(`    ${d.name.padEnd(34)} [${d.codes.join(", ")}]  ${d.text}`);
  }
  console.log(`\nspecialist text moved to its own column: ${specialistMoved}`);
  console.log(`quantity limits re-read:                 ${qlFixed.length}`);
  for (const q of qlFixed.slice(0, 8)) {
    console.log(`    ${q.name.padEnd(40)} ${q.printed}`);
  }
  console.log(`\nentries with no matching source row:     ${unmatched}`);
  console.log(WRITE ? "\nWritten." : "\nDry run. Pass --write to apply.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
