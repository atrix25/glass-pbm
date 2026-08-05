/**
 * Reference data ingestion.
 *
 * Loads the source registry, the CMS NADAC price file, and the Navitus
 * formulary into the database, joining the two so that every drug the engine
 * can price carries both a published acquisition cost and a published benefit
 * level.
 *
 * Run with: npm run ingest
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { Prisma } from "../../src/generated/prisma/index.js";
import { prisma } from "../../src/lib/db.js";
import { SOURCES } from "../../src/lib/sources.js";
import { extractPdfLines } from "./pdf.js";
import {
  decodeFormularyRow,
  formatParseCoverage,
  parseCoverage,
  parseFormularyIndex,
} from "./formulary.js";
import { buildNadacCatalog, resolveNadac, toIso } from "./nadac.js";


const FORMULARY_PDF = "data/raw/navitus-etf-formulary-2026.pdf";
const NADAC_CSV = "data/raw/nadac-2026-07-29.csv";
const FORMULARY_ID = "navitus-etf-2026";

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pad11(ndc: string): string {
  return ndc.replace(/\D/g, "").padStart(11, "0").slice(-11);
}

/**
 * The formulary category is a therapeutic class, which is what the specialty
 * flag and the AI agent's "what else treats this" question both key off.
 */
function isSpecialty(level: string, code: string): boolean {
  return level === "4" || /MSP|LMSP|LD/.test(code);
}

async function main() {
  const started = Date.now();
  console.log("Glass reference data ingestion\n");

  for (const path of [FORMULARY_PDF, NADAC_CSV]) {
    if (!existsSync(path)) {
      console.error(`Missing ${path}. See data/README.md for how to fetch it.`);
      process.exit(1);
    }
  }

  // -----------------------------------------------------------------------
  // Source documents
  // -----------------------------------------------------------------------
  console.log("Registering source documents...");
  const localPaths: Record<string, string> = {
    "navitus-etf-formulary-2026": FORMULARY_PDF,
    "cms-nadac": NADAC_CSV,
  };

  for (const src of SOURCES) {
    const localPath = localPaths[src.id];
    const contentHash =
      localPath && existsSync(localPath) ? sha256File(localPath) : null;

    await prisma.sourceDocument.upsert({
      where: { id: src.id },
      create: {
        id: src.id,
        title: src.title,
        publisher: src.publisher,
        url: src.url,
        kind: src.kind,
        publishedDate: src.publishedDate ?? null,
        retrievedAt: localPath && existsSync(localPath)
          ? statSync(localPath).mtime
          : new Date(),
        contentHash,
        localPath: localPath ?? null,
        locator: src.locator ?? null,
        notes: src.notes ?? null,
      },
      update: {
        title: src.title,
        url: src.url,
        contentHash,
        localPath: localPath ?? null,
        notes: src.notes ?? null,
      },
    });
  }
  console.log(`  ${SOURCES.length} documents registered\n`);

  // -----------------------------------------------------------------------
  // NADAC
  // -----------------------------------------------------------------------
  console.log("Building NADAC catalog...");
  const catalog = await buildNadacCatalog(NADAC_CSV);
  console.log(
    `  ${catalog.total.toLocaleString()} price rows collapsed to ${catalog.strict.size.toLocaleString()} products\n`,
  );

  // -----------------------------------------------------------------------
  // Formulary
  // -----------------------------------------------------------------------
  console.log("Parsing formulary (259 pages)...");
  const pages = await extractPdfLines(
    new Uint8Array(readFileSync(FORMULARY_PDF)),
    { maxPages: 106 },
  );
  const parsed = parseFormularyIndex(pages);
  const rows = parsed.map(decodeFormularyRow);
  console.log(`  ${rows.length} rows parsed from the alphabetical index`);
  console.log(formatParseCoverage(parseCoverage(pages, rows)) + "\n");

  await prisma.formulary.upsert({
    where: { id: FORMULARY_ID },
    create: {
      id: FORMULARY_ID,
      name: "State of Wisconsin Group Health Insurance Program Formulary",
      version: "2026-07-01",
      effectiveDate: new Date("2026-07-01T00:00:00Z"),
    },
    update: {},
  });

  // -----------------------------------------------------------------------
  // Join and load
  // -----------------------------------------------------------------------
  console.log("Joining formulary to NADAC...");
  const seenNdc = new Set<string>();
  const tierCounts: Record<string, number> = {
    exact: 0,
    "form-relaxed": 0,
    "ingredient-only": 0,
  };
  let unmatched = 0;

  const drugRows: Prisma.DrugCreateManyInput[] = [];
  const priceRows: Prisma.DrugPriceCreateManyInput[] = [];
  const entryRows: Prisma.FormularyEntryCreateManyInput[] = [];

  for (const row of rows) {
    const match = resolveNadac(catalog, row.cleanName, row.isBrandName);
    if (!match) {
      unmatched++;
      continue;
    }
    tierCounts[match.tier]++;

    const ndc11 = pad11(match.drug.ndc);
    if (seenNdc.has(ndc11)) continue;
    seenNdc.add(ndc11);

    const drugId = `drug-${ndc11}`;
    const specialty = isSpecialty(row.level, row.specialCode);

    drugRows.push({
      id: drugId,
      ndc11,
      name: row.cleanName,
      genericName: row.isBrandName ? null : row.cleanName,
      labeler: null,
      nadacDescription: match.drug.description,
      // The formulary legend states the convention explicitly:
      // "generic = small letters, BRANDS = CAPITAL LETTERS".
      monyCode: match.drug.isBrand ? "N" : "Y",
      isBrandLabel: match.drug.isBrand,
      isSpecialty: specialty,
      isBiosimilar: /-[a-z]{4}\b/i.test(row.cleanName),
      therapeuticClass: row.category || null,
      unitOfMeasure: match.drug.pricingUnit,
      isOtc: match.drug.otc,
    });

    priceRows.push({
      drugId,
      priceType: "NADAC",
      unitPrice: match.drug.perUnit,
      effectiveDate: new Date(toIso(match.drug.effectiveDate)),
      source: "CMS NADAC",
      isSimulated: false,
      sourceDocumentId: "cms-nadac",
    });

    entryRows.push({
      formularyId: FORMULARY_ID,
      drugId,
      level: row.level,
      specialCode: row.specialCode === "-" ? null : row.specialCode,
      category: row.category || null,
      requiresPA: row.requiresPA,
      requiresStep: row.requiresStep,
      hasQuantityLimit: row.hasQuantityLimit,
      diagnosisRestricted: row.diagnosisRestricted,
      specialistRestricted: row.specialistRestricted,
      mandatorySpecialty: row.mandatorySpecialty,
      limitedDistribution: row.limitedDistribution,
      notCovered: row.notCovered,
      planExclusion: row.planExclusion,
      isVaccine: row.isVaccine,
      qlQuantity: row.qlQuantity ?? null,
      qlDays: row.qlDays ?? null,
      qlRawText: row.qlRawText ?? null,
      qlUnit: row.qlUnit ?? null,
      qlBasis: row.qlBasis ?? null,
      requiredDiagnosisCodes: JSON.stringify(row.requiredDiagnosisCodes),
      diagnosisRawText: row.diagnosisRawText ?? null,
      specialistRawText: row.specialistRawText ?? null,
      sourceDocumentId: "navitus-etf-formulary-2026",
      citation: `Alphabetical Index page ${row.page}: ${row.drugName.slice(0, 120)}`,
    });
  }

  console.log("Writing drugs, prices, and formulary entries...");
  await prisma.formularyEntry.deleteMany({ where: { formularyId: FORMULARY_ID } });
  await prisma.drugPrice.deleteMany({});
  await prisma.drug.deleteMany({});

  const CHUNK = 500;
  for (let i = 0; i < drugRows.length; i += CHUNK) {
    await prisma.drug.createMany({ data: drugRows.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < priceRows.length; i += CHUNK) {
    await prisma.drugPrice.createMany({ data: priceRows.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < entryRows.length; i += CHUNK) {
    await prisma.formularyEntry.createMany({ data: entryRows.slice(i, i + CHUNK) });
  }

  const levelCounts = await prisma.formularyEntry.groupBy({
    by: ["level"],
    _count: true,
    orderBy: { level: "asc" },
  });

  console.log(`\n  drugs loaded:            ${drugRows.length.toLocaleString()}`);
  console.log(`  formulary rows matched:  ${(rows.length - unmatched).toLocaleString()} of ${rows.length.toLocaleString()}`);
  console.log(`    exact form + ingredient: ${tierCounts.exact}`);
  console.log(`    form relaxed:            ${tierCounts["form-relaxed"]}`);
  console.log(`    ingredient only:         ${tierCounts["ingredient-only"]}`);
  console.log(`  not in NADAC:            ${unmatched.toLocaleString()}`);
  console.log("\n  benefit levels loaded:");
  for (const l of levelCounts) {
    console.log(`    Level ${l.level.padEnd(8)} ${String(l._count).padStart(5)}`);
  }
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
