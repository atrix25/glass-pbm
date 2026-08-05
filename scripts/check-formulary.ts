/**
 * Parse the formulary and report coverage without writing anything.
 *
 * The ingest is destructive — it replaces the drug catalogue — so the parser
 * needs a way to be checked against the real 259-page document on its own. This
 * prints the coverage table and the rows where a rule was coded but nothing was
 * extracted behind it, which is the failure mode that matters: a flag set with
 * no numbers under it looks configured and enforces nothing.
 *
 *   npx tsx scripts/check-formulary.ts
 */

import { readFileSync } from "node:fs";
import { extractPdfLines } from "./ingest/pdf.js";
import {
  CODE_LEGEND,
  decodeFormularyRow,
  formatParseCoverage,
  parseCoverage,
  parseFormularyIndex,
} from "./ingest/formulary.js";

const PDF = "data/raw/navitus-etf-formulary-2026.pdf";

async function main() {
  const pages = await extractPdfLines(new Uint8Array(readFileSync(PDF)), {
    maxPages: 106,
  });
  const rows = parseFormularyIndex(pages).map(decodeFormularyRow);
  const coverage = parseCoverage(pages, rows);

  console.log("PARSE COVERAGE");
  console.log(formatParseCoverage(coverage));

  console.log("\nLEGEND AS DECODED");
  for (const [token, meaning] of Object.entries(CODE_LEGEND)) {
    console.log(`  ${token.padEnd(5)} ${meaning}`);
  }

  const dx = rows.filter((r) => r.diagnosisRestricted);
  console.log(`\nDIAGNOSIS RESTRICTIONS (${dx.length})`);
  for (const r of dx) {
    console.log(`  ${r.cleanName}`);
    console.log(`    codes: [${r.requiredDiagnosisCodes.join(", ")}]`);
    console.log(`    text:  ${r.diagnosisRawText ?? "(none)"}`);
  }

  const specialist = rows.filter((r) => r.specialistRawText);
  console.log(`\nSPECIALIST RESTRICTIONS (${specialist.length}), first 5`);
  for (const r of specialist.slice(0, 5)) {
    console.log(`  ${r.cleanName.padEnd(42)} ${r.specialistRawText}`);
  }

  // A quantity-limit code with no numbers behind it is unenforceable.
  const qlHoles = rows.filter(
    (r) => r.hasQuantityLimit && r.qlQuantity === undefined,
  );
  console.log(`\nQUANTITY LIMITS CODED BUT NOT PARSED (${qlHoles.length})`);
  for (const r of qlHoles.slice(0, 12)) {
    console.log(`  ${r.specialCode.padEnd(12)} ${r.drugName.slice(0, 96)}`);
  }

  console.log("\nNAMES PREVIOUSLY CORRUPTED BY NESTED BRACKETS");
  for (const probe of [
    "MOUNJARO",
    "morphine sulfate ER",
    "DEXCOM G6 RECEIVER",
    "DEXCOM G7 SENSOR",
    "FREESTYLE LIBRE SENSOR",
    "ketorolac ophth",
    "efavirenz/lamivudine",
  ]) {
    for (const r of rows.filter((x) => x.drugName.includes(probe)).slice(0, 2)) {
      console.log(`  ${JSON.stringify(r.cleanName)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
