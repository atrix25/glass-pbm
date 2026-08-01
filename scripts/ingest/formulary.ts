/**
 * Parser for the State of Wisconsin Group Health Insurance Program Formulary.
 *
 * The document is a 259-page fixed-width table. Pages 1 through 106 are the
 * Alphabetical Index, which is the authoritative drug-to-level mapping;
 * everything after is the same data reorganized by category, plus appendices.
 * We parse the index.
 *
 * Three things make this harder than a column split:
 *
 *  1. Long drug names wrap, and because the special code is vertically
 *     centered against the wrapped block, the code line is emitted BEFORE the
 *     name lines it belongs to.
 *  2. Long category names wrap onto following lines.
 *  3. When a drug name is long enough it runs straight into the special code
 *     column with no separating space, e.g. "...28 days)MSP-PA-QL".
 *
 * So rather than slicing at fixed offsets, we anchor on the level token, walk
 * left to find the special code, and treat everything to its left as the name.
 */

export interface ParsedFormularyRow {
  drugName: string;
  specialCode: string;
  level: string;
  category: string;
  page: number;
}

export interface DecodedFormularyEntry extends ParsedFormularyRow {
  /** Formulary convention: BRANDS are capitalized, generics are lower case. */
  isBrandName: boolean;
  /** "(LIPITOR equiv)" — the brand this generic references. */
  referenceBrand?: string;
  requiresPA: boolean;
  requiresStep: boolean;
  hasQuantityLimit: boolean;
  mandatorySpecialty: boolean;
  limitedDistribution: boolean;
  specialistRestricted: boolean;
  diagnosisRestricted: boolean;
  notCovered: boolean;
  planExclusion: boolean;
  isVaccine: boolean;
  isOtc: boolean;
  qlQuantity?: number;
  qlDays?: number;
  qlRawText?: string;
  specialistRawText?: string;
  limitedDistributionPharmacies?: string;
  /** The drug name with all trailing parentheticals removed. */
  cleanName: string;
}

/** Levels as printed in the Level column. */
const LEVEL_TOKENS = [
  "1",
  "2",
  "3",
  "4",
  "NC",
  "EXC",
  "$0",
  "NC/3P",
  "100%/EX",
];

const LEVEL_RE = /^(100%\/EX|NC\/3P|\$0|NC|EXC|[1-4]|\d{1,3}%)$/;

/** Special code tokens from the legend on every page footer. */
const CODE_TOKENS = new Set([
  "EXC",
  "INF",
  "LD",
  "LMSP",
  "MSP",
  "OTC",
  "PA",
  "QL",
  "RDX",
  "RS",
  "SF",
  "SMKG",
  "ST",
  "VAC",
  "NC",
  "3P",
  "¢",
]);

const SKIP_PATTERNS = [
  /State of Wisconsin Group Health Insurance Program Formulary/,
  /Alphabetical Index/,
  /Category\/Class/,
  /Last Updated/,
  /^\s*Drug ?Name\s+Special Code/,
  /^\s*Page \d+ of \d+/,
  /Coverage of medications, including those not otherwise/,
  /transaction processing\.\*\* Products listed/,
  /NC = Not Covered/,
  /NC\/3P= Not Covered/,
  /Plan Exclusion\s+INF/,
  /Lumicera Mandatory Specialty/,
  /Prior Authorization\s+QL\s+Quantity Limit/,
  /Restricted to Specialist\s+SF/,
  /Step Therapy\s+VAC\s+Vaccine Program/,
  /Search Tip:/,
  /This is a large document/,
  /your keyboard\. It will then display/,
  /can startyour search/,
];

function shouldSkip(line: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(line));
}

interface ColumnLayout {
  nameCol: number;
  codeCol: number;
  levelCol: number;
  categoryCol: number;
}

function detectLayout(line: string): ColumnLayout | null {
  const nameCol = line.indexOf("Drug Name");
  const codeCol = line.indexOf("Special Code");
  const levelCol = line.indexOf("Level");
  const categoryCol = line.indexOf("Category");
  if (nameCol < 0 || codeCol < 0 || levelCol < 0 || categoryCol < 0) return null;
  return { nameCol, codeCol, levelCol, categoryCol };
}

/**
 * Given a line and the layout, try to read it as a complete record row.
 * Returns null when the line is a continuation or noise.
 */
function parseRecordLine(
  line: string,
  layout: ColumnLayout,
): { name: string; code: string; level: string; category: string } | null {
  // Anchor on the level token. Search a window around the Level column so a
  // slightly shifted row still matches, but not so wide that a category word
  // is mistaken for a level.
  const windowStart = Math.max(0, layout.levelCol - 6);
  const windowEnd = Math.min(line.length, layout.levelCol + 12);
  const window = line.slice(windowStart, windowEnd);

  const tokenRe = /\S+/g;
  let levelStart = -1;
  let levelToken = "";
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(window)) !== null) {
    if (LEVEL_RE.test(m[0])) {
      levelStart = windowStart + m.index;
      levelToken = m[0];
      break;
    }
  }
  if (levelStart < 0) return null;

  const beforeLevel = line.slice(0, levelStart);
  const afterLevel = line.slice(levelStart + levelToken.length);

  // Walk left from the level to pick up the special code token.
  const trimmedBefore = beforeLevel.trimEnd();
  const codeMatch = /(?:^|[\s)])([A-Z¢]{1,4}(?:[-/][A-Z0-9¢]{1,4})*|-)$/.exec(
    trimmedBefore,
  );
  if (!codeMatch) return null;

  const code = codeMatch[1];
  // A bare "-" is the no-special-code marker. Anything else must decode to
  // known legend tokens, otherwise we have mis-detected a word from the name.
  if (code !== "-") {
    const parts = code.split(/[-/]/);
    if (!parts.every((p) => CODE_TOKENS.has(p))) return null;
  }

  const codeStart = trimmedBefore.length - code.length;
  const name = line.slice(0, codeStart).trim();
  const category = afterLevel.trim();

  return { name, code, level: levelToken, category };
}

export function parseFormularyIndex(
  pages: { pageNumber: number; lines: string[] }[],
  opts: { lastIndexPage?: number } = {},
): ParsedFormularyRow[] {
  const lastPage = opts.lastIndexPage ?? 106;
  const rows: ParsedFormularyRow[] = [];
  let layout: ColumnLayout | null = null;

  for (const page of pages) {
    if (page.pageNumber > lastPage) break;

    // A record whose name wrapped: the code line arrived first and is waiting
    // for its name lines.
    let pendingNameless: ParsedFormularyRow | null = null;
    let lastComplete: ParsedFormularyRow | null = null;

    for (const line of page.lines) {
      const maybeLayout = detectLayout(line);
      if (maybeLayout) {
        layout = maybeLayout;
        continue;
      }
      if (!layout) continue;
      if (shouldSkip(line)) continue;

      const record = parseRecordLine(line, layout);

      if (record) {
        // Flush a nameless record that never found its name.
        if (pendingNameless && pendingNameless.drugName) {
          rows.push(pendingNameless);
        }
        pendingNameless = null;

        const row: ParsedFormularyRow = {
          drugName: record.name,
          specialCode: record.code,
          level: record.level,
          category: record.category,
          page: page.pageNumber,
        };

        if (!record.name) {
          // Name wrapped; the following lines carry it.
          pendingNameless = row;
          lastComplete = null;
        } else {
          rows.push(row);
          lastComplete = row;
        }
        continue;
      }

      // Continuation line. Which column it starts in tells us what it is.
      const firstChar = line.search(/\S/);
      if (firstChar < 0) continue;

      if (pendingNameless && firstChar < layout.codeCol) {
        pendingNameless.drugName = [pendingNameless.drugName, line.trim()]
          .filter(Boolean)
          .join(" ");
        continue;
      }

      if (lastComplete && firstChar >= layout.categoryCol - 6) {
        lastComplete.category = [lastComplete.category, line.trim()]
          .filter(Boolean)
          .join(" ");
        continue;
      }

      if (lastComplete && firstChar < layout.codeCol) {
        // A name that wrapped downward rather than upward.
        lastComplete.drugName = [lastComplete.drugName, line.trim()]
          .filter(Boolean)
          .join(" ");
      }
    }

    if (pendingNameless && pendingNameless.drugName) rows.push(pendingNameless);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** "(QL= 2 inj/28 days)" and friends. */
const QL_RE = /QL=\s*([\d.]+)\s*([a-zA-Z]+)\s*\/\s*(\d+)?\s*(day|days|fill|plan year|lifetime|month|months|hours)/i;
const EQUIV_RE = /\(([A-Z][A-Z0-9 ./%-]+?)\s+equiv\)/;
const LD_RE = /Only available through ([^)]+)/i;
const RS_RE = /Restricted to ([A-Za-z ]+?(?:Specialist|Specialists))/i;
const DIAGNOSIS_RE = /Diagnosis Restricted[^)]*|Restricted to (?:the )?(?:diagnosis|treatment) of ([^)]+)/i;

function normalizeQlDays(count: string | undefined, unit: string): number {
  const n = count ? parseInt(count, 10) : 1;
  switch (unit.toLowerCase()) {
    case "day":
    case "days":
      return n;
    case "month":
    case "months":
      return n * 30;
    case "plan year":
      return 365;
    case "lifetime":
      return 36500;
    case "fill":
      // A per-fill limit is expressed against the fill's own days supply.
      return 30;
    default:
      return n;
  }
}

export function decodeFormularyRow(
  row: ParsedFormularyRow,
): DecodedFormularyEntry {
  const codes = row.specialCode === "-" ? [] : row.specialCode.split(/[-/]/);
  const has = (c: string) => codes.includes(c);

  const name = row.drugName;

  const qlMatch = QL_RE.exec(name);
  const equivMatch = EQUIV_RE.exec(name);
  const ldMatch = LD_RE.exec(name);
  const rsMatch = RS_RE.exec(name);
  const dxMatch = DIAGNOSIS_RE.exec(name);

  // Formulary convention from the legend: "generic = small letters,
  // BRANDS = CAPITAL LETTERS". Measure on the part before any parenthetical,
  // since "(LIPITOR equiv)" is capitalized on generic rows.
  const base = name.split("(")[0].trim();
  const letters = base.replace(/[^A-Za-z]/g, "");
  const upperCount = (base.match(/[A-Z]/g) ?? []).length;
  const isBrandName =
    letters.length > 0 && upperCount / letters.length > 0.6;

  let qlQuantity: number | undefined;
  let qlDays: number | undefined;
  if (qlMatch) {
    qlQuantity = parseFloat(qlMatch[1]);
    qlDays = normalizeQlDays(qlMatch[3], qlMatch[4]);
  }

  const cleanName = name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const level = row.level;

  return {
    ...row,
    isBrandName,
    referenceBrand: equivMatch?.[1]?.trim(),
    requiresPA: has("PA"),
    requiresStep: has("ST") || /Step Therapy/i.test(name),
    hasQuantityLimit: has("QL") || Boolean(qlMatch),
    mandatorySpecialty: has("MSP") || has("LMSP"),
    limitedDistribution: has("LD") || Boolean(ldMatch),
    specialistRestricted: has("RS") || Boolean(rsMatch),
    diagnosisRestricted: has("RDX") || Boolean(dxMatch),
    notCovered: level === "NC" || level === "NC/3P",
    planExclusion: level === "EXC" || has("EXC"),
    isVaccine: has("VAC"),
    isOtc: has("OTC"),
    qlQuantity,
    qlDays,
    qlRawText: qlMatch?.[0],
    specialistRawText: rsMatch?.[0],
    limitedDistributionPharmacies: ldMatch?.[1]?.trim(),
    cleanName,
  };
}

export { LEVEL_TOKENS };
