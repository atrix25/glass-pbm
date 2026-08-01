/**
 * NADAC ingestion and name matching.
 *
 * NADAC gives us real NDCs, real acquisition costs, and a real brand/generic
 * classification. The formulary gives us levels and utilization management
 * rules, keyed by drug name rather than NDC. Joining them is the only fuzzy
 * step in the pipeline, so it is kept narrow, deterministic, and measurable:
 * we match on normalized ingredient plus dosage form, and report the hit rate.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface NadacRow {
  description: string;
  ndc: string;
  perUnit: number;
  effectiveDate: string;
  pricingUnit: string;
  otc: boolean;
  /** "B" brand or "G" generic, as classified by CMS for rate setting. */
  classification: string;
}

/** Salt and ester words that appear in NADAC but not in formulary names. */
const SALT_WORDS = new Set([
  "hcl",
  "hydrochloride",
  "sodium",
  "calcium",
  "potassium",
  "magnesium",
  "sulfate",
  "sulphate",
  "tartrate",
  "bitartrate",
  "succinate",
  "maleate",
  "mesylate",
  "besylate",
  "fumarate",
  "citrate",
  "acetate",
  "phosphate",
  "bromide",
  "chloride",
  "nitrate",
  "oxalate",
  "tosylate",
  "dihydrate",
  "monohydrate",
  "anhydrous",
  "micronized",
  "base",
  "hyclate",
  "monohydrate",
  "valerate",
  "propionate",
  "dipropionate",
  "furoate",
  "xinafoate",
  "trihydrate",
  "carbonate",
  "gluconate",
  "lactate",
  "malate",
  "pamoate",
  "sesquihydrate",
]);

/** NADAC form words mapped to the abbreviations the formulary uses. */
const FORM_MAP: Array<[RegExp, string]> = [
  [/\bTABLET|\bTABS?\b/i, "tab"],
  [/\bCAPSULE|\bCAPS?\b/i, "cap"],
  [/\bSOLUTION\b|\bSOLN\b/i, "soln"],
  [/\bSUSPENSION\b|\bSUSP\b/i, "susp"],
  [/\bSYRINGE\b|\bINJECTION\b|\bVIAL\b|\bINJ\b|\bPEN\b|\bAUTO-?INJECTOR\b/i, "inj"],
  [/\bCREAM\b/i, "cream"],
  [/\bOINTMENT\b|\bOINT\b/i, "oint"],
  [/\bGEL\b/i, "gel"],
  [/\bLOTION\b/i, "lotion"],
  [/\bPATCH\b|\bTRANSDERMAL\b/i, "patch"],
  [/\bSUPPOSITORY\b|\bSUPP\b/i, "supp"],
  [/\bINHALER\b|\bAEROSOL\b|\bHFA\b|\bINHAL\b/i, "inhaler"],
  [/\bDROPS?\b/i, "drop"],
  [/\bSYRUP\b/i, "syrup"],
  [/\bELIXIR\b/i, "elixir"],
  [/\bPOWDER\b/i, "powder"],
  [/\bFOAM\b/i, "foam"],
  [/\bSHAMPOO\b/i, "shampoo"],
  [/\bSPRAY\b/i, "spray"],
  [/\bLOZENGE\b/i, "lozenge"],
  [/\bFILM\b/i, "film"],
  [/\bKIT\b/i, "kit"],
  [/\bkPACK\b|\bPACK\b/i, "pack"],
  [/\bkCHEWABLE\b|\bCHEW\b/i, "chew"],
];

const RELEASE_MAP: Array<[RegExp, string]> = [
  [/\b(ER|XR|SR|CR|LA|XL|24HR|12HR|EXTENDED[- ]RELEASE)\b/i, "er"],
  [/\b(DR|DELAYED[- ]RELEASE|EC|ENTERIC)\b/i, "dr"],
];

function detectForm(text: string): string | undefined {
  for (const [re, form] of FORM_MAP) {
    if (re.test(text)) return form;
  }
  return undefined;
}

function detectRelease(text: string): string {
  for (const [re, tag] of RELEASE_MAP) {
    if (re.test(text)) return tag;
  }
  return "";
}

/** Strip strengths, package counts, and units, leaving ingredient words. */
function ingredientWords(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    // Strengths like "10 mg", "0.4ml", "500mg/5ml", "10%"
    .replace(/\d+(\.\d+)?\s*(mcg|mg|g|ml|l|unit|units|iu|meq|%)\b/g, " ")
    .replace(/\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?/g, " ")
    .replace(/\b\d+(\.\d+)?\b/g, " ")
    .replace(/[(),.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const formWords = new Set([
    ...FORM_MAP.map(([, f]) => f),
    "tablet",
    "tablets",
    "capsule",
    "capsules",
    "solution",
    "suspension",
    "injection",
    "vial",
    "syringe",
    "pen",
    "oral",
    "cream",
    "ointment",
    "gel",
    "patch",
    "kit",
    "pack",
    "er",
    "xr",
    "sr",
    "cr",
    "la",
    "xl",
    "dr",
    "ec",
    "hfa",
    "odt",
    "sl",
    "chewable",
    "chew",
    "extended",
    "delayed",
    "release",
    "prefilled",
    "auto-injector",
    "autoinjector",
    "ophthalmic",
    "ophth",
    "otic",
    "nasal",
    "topical",
    "inhalation",
    "subcutaneous",
    "intravenous",
    "with",
    "and",
    "in",
    "of",
    "the",
    "equiv",
    "each",
    "ea",
  ]);

  return cleaned
    .split(/[\s/-]+/)
    .filter((w) => w.length > 2)
    .filter((w) => !formWords.has(w))
    .filter((w) => !SALT_WORDS.has(w));
}

/**
 * A join key of ingredient + form + release characteristic.
 * Deliberately coarse on strength: the formulary usually lists one row per
 * ingredient and form, not per strength.
 */
export function matchKey(text: string): string | null {
  const words = ingredientWords(text);
  if (words.length === 0) return null;
  const form = detectForm(text) ?? "";
  const release = detectRelease(text);
  // Combination products key on the first two ingredients, single products on
  // the first.
  const head = words.slice(0, 2).join("+");
  return `${head}|${form}|${release}`;
}

/** A looser key used only when the strict key finds no match. */
export function looseMatchKey(text: string): string | null {
  const words = ingredientWords(text);
  if (words.length === 0) return null;
  const form = detectForm(text) ?? "";
  return `${words[0]}|${form}`;
}

/**
 * Ingredient only, ignoring dosage form.
 *
 * NADAC and the formulary sometimes describe the same product with different
 * form words: NADAC calls acetylcysteine a VIAL where the formulary calls it a
 * soln. Falling back to the ingredient recovers those, at the cost of
 * occasionally attaching a tablet's price to a solution. Matches made at this
 * tier are recorded so the confidence is visible rather than assumed.
 */
export function ingredientKey(text: string): string | null {
  const words = ingredientWords(text);
  if (words.length === 0) return null;
  return words.slice(0, 2).join("+");
}

export async function* streamNadac(path: string): AsyncGenerator<NadacRow> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    if (!line.trim()) continue;

    const cells = splitCsvLine(line);
    if (cells.length < 9) continue;

    const perUnit = parseFloat(cells[2]);
    if (!Number.isFinite(perUnit) || perUnit <= 0) continue;

    yield {
      description: cells[0],
      ndc: cells[1],
      perUnit,
      effectiveDate: cells[3],
      pricingUnit: cells[4],
      otc: cells[6] === "Y",
      classification: cells[8],
    };
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export interface NadacDrug {
  ndc: string;
  description: string;
  perUnit: number;
  effectiveDate: string;
  pricingUnit: string;
  isBrand: boolean;
  otc: boolean;
  strictKey: string | null;
  looseKey: string | null;
}

/**
 * Collapse the 900k-row file to one representative NDC per (key, brand) pair,
 * keeping the most recent effective date. We want a catalog, not every package
 * size of every labeler.
 */
export async function buildNadacCatalog(path: string): Promise<{
  strict: Map<string, NadacDrug>;
  loose: Map<string, NadacDrug>;
  ingredient: Map<string, NadacDrug>;
  total: number;
}> {
  const strict = new Map<string, NadacDrug>();
  const loose = new Map<string, NadacDrug>();
  const ingredient = new Map<string, NadacDrug>();
  let total = 0;

  for await (const row of streamNadac(path)) {
    total++;
    const strictKey = matchKey(row.description);
    const looseKey = looseMatchKey(row.description);
    if (!strictKey) continue;

    const drug: NadacDrug = {
      ndc: row.ndc,
      description: row.description,
      perUnit: row.perUnit,
      effectiveDate: row.effectiveDate,
      pricingUnit: row.pricingUnit,
      isBrand: row.classification === "B",
      otc: row.otc,
      strictKey,
      looseKey,
    };

    const brandTag = drug.isBrand ? "B" : "G";
    const sKey = `${strictKey}|${brandTag}`;
    const existing = strict.get(sKey);
    if (!existing || newer(drug.effectiveDate, existing.effectiveDate)) {
      strict.set(sKey, drug);
    }

    if (looseKey) {
      const lKey = `${looseKey}|${brandTag}`;
      const existingLoose = loose.get(lKey);
      if (!existingLoose || newer(drug.effectiveDate, existingLoose.effectiveDate)) {
        loose.set(lKey, drug);
      }
    }

    const iKey = ingredientKey(row.description);
    if (iKey) {
      const key = `${iKey}|${brandTag}`;
      const existingIng = ingredient.get(key);
      if (!existingIng || newer(drug.effectiveDate, existingIng.effectiveDate)) {
        ingredient.set(key, drug);
      }
    }
  }

  return { strict, loose, ingredient, total };
}

export type MatchTier = "exact" | "form-relaxed" | "ingredient-only";

export interface MatchOutcome {
  drug: NadacDrug;
  tier: MatchTier;
}

/**
 * Resolve a formulary drug name to a NADAC product, most specific tier first.
 * Brand tag is preferred but not required, because CMS and the formulary
 * occasionally disagree on whether an authorized generic is brand.
 */
export function resolveNadac(
  catalog: {
    strict: Map<string, NadacDrug>;
    loose: Map<string, NadacDrug>;
    ingredient: Map<string, NadacDrug>;
  },
  cleanName: string,
  isBrandName: boolean,
): MatchOutcome | null {
  const preferred = isBrandName ? "B" : "G";
  const other = isBrandName ? "G" : "B";

  const sk = matchKey(cleanName);
  if (sk) {
    const hit = catalog.strict.get(`${sk}|${preferred}`);
    if (hit) return { drug: hit, tier: "exact" };
  }

  const lk = looseMatchKey(cleanName);
  if (lk) {
    const hit = catalog.loose.get(`${lk}|${preferred}`);
    if (hit) return { drug: hit, tier: "form-relaxed" };
  }

  if (sk) {
    const hit = catalog.strict.get(`${sk}|${other}`);
    if (hit) return { drug: hit, tier: "form-relaxed" };
  }

  const ik = ingredientKey(cleanName);
  if (ik) {
    const hit =
      catalog.ingredient.get(`${ik}|${preferred}`) ??
      catalog.ingredient.get(`${ik}|${other}`);
    if (hit) return { drug: hit, tier: "ingredient-only" };
  }

  return null;
}

function newer(a: string, b: string): boolean {
  return toIso(a) > toIso(b);
}

function toIso(mmddyyyy: string): string {
  const [m, d, y] = mmddyyyy.split("/");
  if (!y) return mmddyyyy;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export { toIso };
