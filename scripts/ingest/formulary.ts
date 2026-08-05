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

import {
  basisForUnit,
  periodInDays,
  type QuantityLimitBasis,
} from "../../src/lib/engine/quantity-limit.js";

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
  /** The noun the limit counts, as printed: "caps", "tubes", "days". */
  qlUnit?: string;
  /**
   * What that noun means for enforcement. Carried from the parse rather than
   * inferred later, because "12 tubes" and "12 caps" are the same number and
   * not the same limit, and the engine cannot tell them apart without this.
   */
  qlBasis?: QuantityLimitBasis;
  specialistRawText?: string;
  /** "Diagnosis Restricted – Type 2 Diabetes (E11)", as printed. */
  diagnosisRawText?: string;
  /** ICD-10-CM codes named by that clause, e.g. ["E11"]. */
  requiredDiagnosisCodes: string[];
  limitedDistributionPharmacies?: string;
  /** The product name with rule clauses removed and designators kept. */
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

/**
 * The special-code legend, exactly as printed in the footer of every page.
 *
 * Kept as a token-to-meaning map rather than a bare set of strings for two
 * reasons. It is the authority for whether a token found next to the level
 * column is really a code or a word from a drug name that happens to be in
 * capitals, and it is the only place that records what each code means, which
 * the methodology page prints so a reader can check the decoding rather than
 * trust it.
 *
 * Note the RxCENTS token is the cent sign. The legend reads "¢     RxCENTS",
 * so the glyph is the code and RxCENTS is its expansion; searching the document
 * for the string "RxCENTS" in the code column finds nothing.
 */
export const CODE_LEGEND: Record<string, string> = {
  EXC: "Plan Exclusion",
  INF: "Infertility",
  LD: "Limited Distribution",
  LMSP: "Lumicera Mandatory Specialty",
  MSP: "Mandatory Specialty",
  OTC: "Over the Counter",
  PA: "Prior Authorization",
  QL: "Quantity Limit",
  RDX: "Restricted to Diagnosis",
  RS: "Restricted to Specialist",
  SF: "Limited to two 15 day fills per month for the first 3 months",
  SMKG: "Smoking Cessation",
  ST: "Step Therapy",
  VAC: "Vaccine Program",
  NC: "Not Covered",
  "3P": "Not Covered, Third Party Reviewer",
  "¢": "RxCENTS",
};

const CODE_TOKENS = new Set(Object.keys(CODE_LEGEND));

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

/**
 * "(QL= 2 inj/28 days)" and friends.
 *
 * The period unit list has to be generous. This document writes limits per day,
 * per fill, per 28 days, per 26 weeks, per year and per plan year, and a unit
 * missing from the alternation does not fail loudly — the QL flag stays set,
 * the numbers come back undefined, and the edit silently stops being
 * enforceable. That is why the coverage report counts coded-but-unparsed limits
 * as a defect rather than reporting the parsed ones and stopping.
 */
const QL_RE =
  /QL=\s*([\d.]+)\s*([a-zA-Z]+)\s*\/\s*(\d+)?\s*(days?|fills?|plan years?|years?|weeks?|lifetime|months?|hours?)/i;

/**
 * "(Limited to 180 days/plan year)" — the smoking-cessation phrasing.
 *
 * A different kind of limit from the QL= form despite the shared bracket: the
 * number counts days of therapy or fills, not units of drug, so it is not
 * comparable to a dispensed quantity at all.
 */
const QL_LIMITED_RE =
  /Limited to\s+(\d+)\s+(days?|fills?)\s*\/\s*(plan year|year|month)/i;
const EQUIV_RE = /\(([A-Z][A-Z0-9 ./%()-]+?)\s+equiv\)/;
const LD_RE = /Only available through ([^)]+)/i;
const RS_RE = /Restricted to ([A-Za-z ]+?(?:Specialist|Specialists))/i;

/**
 * The diagnosis restriction, e.g.
 * "Diagnosis Restricted – Type 2 Diabetes (E11)".
 *
 * Anchored on the phrase and run to the end of the enclosing clause rather than
 * to the next close bracket, because the ICD-10 code the restriction exists to
 * name is itself parenthesised and stopping at the first ")" throws it away.
 * The dash is an en dash in the source; both are accepted so a reprinted
 * document with a hyphen still parses.
 */
const DIAGNOSIS_RE =
  /(?:Diagnosis Restricted\s*[–—-]?\s*|Restricted to (?:the )?(?:diagnosis|treatment) of\s*)([^;]+)/i;

/**
 * ICD-10-CM codes as they appear in the formulary: a letter, two characters,
 * and an optional decimal extension. "U" is excluded because U-codes are
 * provisional WHO assignments that do not appear in a commercial formulary and
 * the letter is common at the start of capitalised words.
 */
const ICD10_RE = /\b([A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?)\b/g;

/**
 * A parenthetical that carries a rule rather than part of the product's name.
 *
 * The list is explicit rather than a heuristic on length or capitalisation
 * because both kinds of bracket look alike and guessing wrong is visible either
 * way: strip too much and "HUMULIN R U-500 (CONCENTRATE)" becomes a different
 * insulin, strip too little and a cost-share sentence ends up printed as part
 * of a drug name on the member's claim history.
 */
const RULE_PARENTHETICAL =
  /QL\s*=|Diagnosis Restricted|Restricted to|Step Therapy|Only available through|Prior authorization|Not Covered|\bequiv\b|Limited to|fills per month|copays? |covered at|per Rx/i;

/**
 * Split a drug name into text and its top-level parenthesised groups.
 *
 * Written as a depth counter rather than a regular expression because these
 * groups nest — "(SYMFI (LO) equiv)" and "(QL= 4 inj/28 days; Diagnosis
 * Restricted – Type 2 Diabetes (E11))" both do — and `\([^)]*\)` stops at the
 * inner bracket. Doing that silently truncated 42 names in this document,
 * leaving entries stored as "morphine sulfate ER tab )" and, worse,
 * "DEXCOM G6 RECEIVER required if member is not currently utilizing insulin)",
 * where the tail of a rule became part of the product name.
 */
function splitParentheticals(
  name: string,
): { text: string; group: boolean }[] {
  const parts: { text: string; group: boolean }[] = [];
  let buffer = "";
  let depth = 0;

  for (const ch of name) {
    if (ch === "(") {
      if (depth === 0) {
        if (buffer) parts.push({ text: buffer, group: false });
        buffer = "";
      } else {
        buffer += ch;
      }
      depth++;
      continue;
    }
    if (ch === ")") {
      if (depth === 1) {
        parts.push({ text: buffer, group: true });
        buffer = "";
        depth = 0;
        continue;
      }
      // An unbalanced closer, which the wrapped-row joining occasionally
      // produces. Dropping it is right either way: it is not part of a name.
      if (depth === 0) continue;
      depth--;
      buffer += ch;
      continue;
    }
    buffer += ch;
  }
  if (buffer) parts.push({ text: buffer, group: depth > 0 });
  return parts;
}

/**
 * The product name with rule clauses removed and product designators kept.
 *
 * The distinction matters because both arrive in brackets. "(QL= 2 sensors/30
 * days)" is a rule and belongs in its own columns; "(15-DAY)" distinguishes two
 * genuinely different DEXCOM sensors and belongs in the name. Stripping every
 * bracket would merge products that the formulary lists separately.
 */
export function cleanDrugName(name: string): string {
  return splitParentheticals(name)
    .filter((p) => !p.group || !RULE_PARENTHETICAL.test(p.text))
    .map((p) => (p.group ? `(${p.text.trim()})` : p.text))
    .join(" ")
    .replace(/\s*\(\s*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;])/g, "$1")
    .trim();
}

/** The diagnosis clause and the ICD-10 codes named inside it. */
export function parseDiagnosisRestriction(name: string): {
  rawText?: string;
  codes: string[];
} {
  const match = DIAGNOSIS_RE.exec(name);
  if (!match) return { codes: [] };

  // Trim the trailing brackets left over from the enclosing group, so the
  // stored text reads as the document prints it.
  const clause = match[0].replace(/\)+\s*$/, (tail) => {
    // Keep a bracket that belongs to the code itself, e.g. "(E11)".
    const opens = (match[0].match(/\(/g) ?? []).length;
    const closes = (match[0].match(/\)/g) ?? []).length;
    return ")".repeat(Math.max(0, tail.length - (closes - opens)));
  });

  const codes = [...clause.matchAll(ICD10_RE)].map((m) => m[1]);
  return {
    rawText: clause.trim(),
    codes: [...new Set(codes)],
  };
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
  const diagnosis = parseDiagnosisRestriction(name);

  // Formulary convention from the legend: "generic = small letters,
  // BRANDS = CAPITAL LETTERS". Measure on the part before any parenthetical,
  // since "(LIPITOR equiv)" is capitalized on generic rows.
  const base = name.split("(")[0].trim();
  const letters = base.replace(/[^A-Za-z]/g, "");
  const upperCount = (base.match(/[A-Z]/g) ?? []).length;
  const isBrandName =
    letters.length > 0 && upperCount / letters.length > 0.6;

  const limitedMatch = QL_LIMITED_RE.exec(name);

  let qlQuantity: number | undefined;
  let qlDays: number | undefined;
  let qlUnit: string | undefined;
  let qlBasis: QuantityLimitBasis | undefined;
  if (qlMatch) {
    qlQuantity = parseFloat(qlMatch[1]);
    qlUnit = qlMatch[2];
    qlDays = periodInDays(qlMatch[3], qlMatch[4]) ?? undefined;
    qlBasis = basisForUnit(qlUnit) ?? undefined;
  } else if (limitedMatch) {
    // "180 days per plan year" is a ceiling on days of therapy, not on any
    // quantity, so the number is the days and the unit says so.
    qlQuantity = parseFloat(limitedMatch[1]);
    qlUnit = limitedMatch[2];
    qlDays = periodInDays(undefined, limitedMatch[3]) ?? undefined;
    qlBasis = basisForUnit(qlUnit) ?? undefined;
  }

  /*
   * A quantity whose unit could not be classified is withheld rather than
   * recorded.
   *
   * Sixty doses, three sensors, four cartridges: the numbers parse cleanly and
   * mean nothing until something says what they count. Stored as a bare
   * quantity the limit looks configured, and it will either sit inert or fire
   * against a dispensed quantity measured in something else. Withholding it
   * keeps the raw clause and the flag, so the limit shows up as coded and
   * unparsed in the coverage report — a gap somebody can close — instead of as
   * a rule nobody can audit.
   */
  if (qlBasis === undefined) {
    qlQuantity = undefined;
    qlDays = undefined;
  }

  const cleanName = cleanDrugName(name);

  const level = row.level;

  return {
    ...row,
    isBrandName,
    referenceBrand: equivMatch?.[1]?.trim(),
    requiresPA: has("PA"),
    requiresStep: has("ST") || /Step Therapy/i.test(name),
    hasQuantityLimit: has("QL") || Boolean(qlMatch) || Boolean(limitedMatch),
    mandatorySpecialty: has("MSP") || has("LMSP"),
    limitedDistribution: has("LD") || Boolean(ldMatch),
    specialistRestricted: has("RS") || Boolean(rsMatch),
    diagnosisRestricted: has("RDX") || Boolean(diagnosis.rawText),
    notCovered: level === "NC" || level === "NC/3P",
    planExclusion: level === "EXC" || has("EXC"),
    isVaccine: has("VAC"),
    isOtc: has("OTC"),
    qlQuantity,
    qlDays,
    qlUnit,
    qlBasis,
    qlRawText: qlMatch?.[0] ?? limitedMatch?.[0],
    specialistRawText: rsMatch?.[0],
    diagnosisRawText: diagnosis.rawText,
    requiredDiagnosisCodes: diagnosis.codes,
    limitedDistributionPharmacies: ldMatch?.[1]?.trim(),
    cleanName,
  };
}

export { LEVEL_TOKENS };

// ---------------------------------------------------------------------------
// Parse coverage
// ---------------------------------------------------------------------------

export interface ParseCoverage {
  /** Non-blank lines on the index pages, excluding headers and legend noise. */
  candidateLines: number;
  /** Rows the parser produced. */
  rows: number;
  /** Rows that decoded to a level the legend recognises. */
  levelled: number;
  /** Rows whose special code decoded entirely to legend tokens. */
  codeDecoded: number;
  /**
   * Rows carrying a quantity limit code, and the ones where a limit the engine
   * can actually evaluate came out of it.
   *
   * A number without a classified unit does not count as parsed. It would
   * overstate what the parser achieved and understate the work left to do.
   */
  qlCoded: number;
  qlParsed: number;
  /** Units that appeared in a clause but were not recognised, for the next pass. */
  qlUnknownUnits: string[];
  /** How the enforceable limits break down, since each is enforced differently. */
  qlByBasis: Record<string, number>;
  /** Rows carrying a diagnosis restriction where ICD-10 codes were extracted. */
  diagnosisCoded: number;
  diagnosisWithCodes: number;
  /**
   * Names where a rule clause leaked into the product name.
   *
   * Not merely "contains a bracket": plenty of legitimate names do, because
   * "(2 PEN) KIT" and "(LS)" are how the manufacturer distinguishes packagings
   * and they belong in the name. Leakage is an unbalanced bracket, or a bracket
   * carrying rule language, which is what nested groups used to produce.
   */
  namesWithResidue: string[];
}

/** Whether a cleaned name still carries part of a rule clause. */
function hasRuleResidue(cleanName: string): boolean {
  const opens = (cleanName.match(/\(/g) ?? []).length;
  const closes = (cleanName.match(/\)/g) ?? []).length;
  return opens !== closes || RULE_PARENTHETICAL.test(cleanName);
}

/**
 * How much of the document the parser actually accounted for.
 *
 * A parser over a 259-page PDF that reports only the number of rows it produced
 * is telling you how much it found, not how much it missed, and those are
 * different claims. The interesting figures here are the ratios: a row carrying
 * the QL code whose numbers did not parse, or the RDX code with no ICD-10 code
 * extracted, is a silent hole — the flag is set, the edit looks configured, and
 * there is nothing behind it for the engine to enforce. That is precisely the
 * defect this document had until the bracket nesting was handled, so it is
 * worth measuring rather than assuming.
 */
export function parseCoverage(
  pages: { pageNumber: number; lines: string[] }[],
  rows: DecodedFormularyEntry[],
  opts: { lastIndexPage?: number } = {},
): ParseCoverage {
  const lastPage = opts.lastIndexPage ?? 106;

  let candidateLines = 0;
  for (const page of pages) {
    if (page.pageNumber > lastPage) break;
    for (const line of page.lines) {
      if (!line.trim()) continue;
      if (shouldSkip(line)) continue;
      if (detectLayout(line)) continue;
      candidateLines++;
    }
  }

  const qlCoded = rows.filter((r) => r.hasQuantityLimit).length;
  const diagnosisCoded = rows.filter((r) => r.diagnosisRestricted).length;

  const qlByBasis: Record<string, number> = {};
  for (const r of rows) {
    if (r.qlBasis) qlByBasis[r.qlBasis] = (qlByBasis[r.qlBasis] ?? 0) + 1;
  }

  return {
    candidateLines,
    rows: rows.length,
    levelled: rows.filter((r) => LEVEL_RE.test(r.level)).length,
    codeDecoded: rows.filter(
      (r) =>
        r.specialCode === "-" ||
        r.specialCode.split(/[-/]/).every((p) => CODE_LEGEND[p] !== undefined),
    ).length,
    qlCoded,
    qlParsed: rows.filter(
      (r) => r.hasQuantityLimit && r.qlQuantity !== undefined,
    ).length,
    qlUnknownUnits: [
      ...new Set(
        rows
          .filter((r) => r.qlUnit !== undefined && r.qlBasis === undefined)
          .map((r) => r.qlUnit as string),
      ),
    ],
    qlByBasis,
    diagnosisCoded,
    diagnosisWithCodes: rows.filter(
      (r) => r.diagnosisRestricted && r.requiredDiagnosisCodes.length > 0,
    ).length,
    namesWithResidue: rows
      .filter((r) => hasRuleResidue(r.cleanName))
      .map((r) => r.cleanName),
  };
}

export function formatParseCoverage(c: ParseCoverage): string {
  const pct = (n: number, d: number) =>
    d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—";
  const lines = [
    `  index lines considered:   ${c.candidateLines.toLocaleString()}`,
    `  rows parsed:              ${c.rows.toLocaleString()} (${pct(c.rows, c.candidateLines)} of lines, the rest being wraps)`,
    `  level recognised:         ${c.levelled.toLocaleString()} / ${c.rows.toLocaleString()}  ${pct(c.levelled, c.rows)}`,
    `  special code decoded:     ${c.codeDecoded.toLocaleString()} / ${c.rows.toLocaleString()}  ${pct(c.codeDecoded, c.rows)}`,
    `  quantity limits parsed:   ${c.qlParsed.toLocaleString()} / ${c.qlCoded.toLocaleString()} coded  ${pct(c.qlParsed, c.qlCoded)}`,
    `      by basis:             ${Object.entries(c.qlByBasis)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
    `  diagnosis codes parsed:   ${c.diagnosisWithCodes.toLocaleString()} / ${c.diagnosisCoded.toLocaleString()} coded  ${pct(c.diagnosisWithCodes, c.diagnosisCoded)}`,
    `  names with rule residue:  ${c.namesWithResidue.length}`,
  ];
  if (c.qlUnknownUnits.length > 0) {
    lines.push(`  unrecognised limit units: ${c.qlUnknownUnits.join(", ")}`);
  }
  for (const n of c.namesWithResidue.slice(0, 5)) lines.push(`      ${n}`);
  return lines.join("\n");
}
