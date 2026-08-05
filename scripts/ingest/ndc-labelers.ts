/**
 * Manufacturer attribution from the FDA NDC Directory.
 *
 * NADAC carries prices and NDCs but not who makes the drug, and a rebate
 * invoice has to go to somebody. The FDA publishes the labeler behind every
 * marketed NDC, so attribution is a lookup rather than a guess:
 *
 *   https://www.accessdata.fda.gov/cder/ndctext.zip   (product.txt)
 *
 * Two normalizations happen here, and they are different in kind.
 *
 * The first is mechanical. An NDC is a labeler segment, a product segment and
 * a package segment. FDA prints the first two as PRODUCTNDC in whichever of
 * the 4-4, 5-3 and 5-4 configurations the labeler was assigned, while NADAC
 * prints the padded 11-digit 5-4-2 form. Both collapse onto the same nine
 * digits once padded, which is what the join uses.
 *
 * The second is a judgement, and is kept explicit for that reason. FDA records
 * the labeler, which is the legal entity on the package: "Pharmacia & Upjohn
 * Company LLC", "Greenstone LLC" and "Pfizer Laboratories Div Pfizer Inc" are
 * three labelers and one rebate contract. Invoicing the labeler would produce
 * a receivable ledger no rebate manager would recognize, so the well-known
 * families roll up to the parent that actually signs. The roll-up is a table
 * you can read and argue with rather than a fuzzy match.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Corporate families, keyed by a substring of the FDA labeler name. Order
 * matters: the first match wins, so more specific entries come first. Only
 * families that appear in this book are listed; anything unmatched keeps its
 * FDA name, which is the honest default.
 */
const PARENT_COMPANIES: Array<[needle: string, parent: string]> = [
  // Pfizer absorbed Wyeth, Pharmacia, Parke-Davis, King and Hospira; Greenstone
  // was its authorized-generics arm before the Viatris separation.
  ["pharmacia", "Pfizer"],
  ["parke-davis", "Pfizer"],
  ["roerig", "Pfizer"],
  ["greenstone", "Viatris"],
  ["wyeth", "Pfizer"],
  ["hospira", "Pfizer"],
  ["pfizer", "Pfizer"],

  // Johnson & Johnson's pharmaceutical segment trades as Janssen.
  ["janssen", "Johnson & Johnson"],
  ["ortho-mcneil", "Johnson & Johnson"],

  // Sanofi's US entities plus Genzyme.
  ["genzyme", "Sanofi"],
  ["aventis", "Sanofi"],
  ["sanofi", "Sanofi"],

  // Amgen acquired Immunex (Enbrel) and Horizon; Otezla came from Celgene.
  ["immunex", "Amgen"],
  ["horizon therapeutics", "Amgen"],
  ["amgen", "Amgen"],

  // AbbVie acquired Allergan, which had earlier acquired Forest and Actavis.
  ["allergan", "AbbVie"],
  ["forest laboratories", "AbbVie"],
  ["abbvie", "AbbVie"],

  // Takeda acquired Shire, Sucampo and URL.
  ["shire", "Takeda"],
  ["sucampo", "Takeda"],
  ["takeda", "Takeda"],

  // Novartis retains Sandoz-labeled products from before the 2023 spin-off.
  ["alcon", "Novartis"],
  ["novartis", "Novartis"],

  ["glaxosmithkline", "GSK"],
  ["glaxo", "GSK"],

  ["merck sharp", "Merck"],
  ["organon", "Organon"],

  ["boehringer", "Boehringer Ingelheim"],
  ["astrazeneca", "AstraZeneca"],
  ["bristol-myers", "Bristol Myers Squibb"],
  ["e.r. squibb", "Bristol Myers Squibb"],
  ["celgene", "Bristol Myers Squibb"],
  ["lilly", "Eli Lilly"],
  ["novo nordisk", "Novo Nordisk"],
  ["bayer", "Bayer"],
  ["biogen", "Biogen"],
  ["emd serono", "Merck KGaA"],
  ["teva", "Teva"],
  ["viatris", "Viatris"],
  ["mylan", "Viatris"],
  ["bausch", "Bausch Health"],
  ["salix", "Bausch Health"],
  ["ucb, inc", "UCB"],
  ["gilead", "Gilead Sciences"],
  ["regeneron", "Regeneron"],
  ["vertex", "Vertex Pharmaceuticals"],
  ["sandoz", "Sandoz"],
];

export interface LabelerLookup {
  /** Nine-digit labeler+product key to the FDA labeler name. */
  byProduct: Map<string, string>;
  /** Five-digit labeler code to its most frequently seen FDA name. */
  byLabeler: Map<string, string>;
}

/** Pads an FDA PRODUCTNDC ("0002-1200", "50458-580") to nine digits. */
function normalizeProductNdc(productNdc: string): string | null {
  const [labeler, product] = productNdc.split("-");
  if (!labeler || !product) return null;
  return labeler.padStart(5, "0") + product.padStart(4, "0");
}

/**
 * Rolls an FDA labeler name up to the entity that signs rebate agreements.
 * Unmatched names pass through unchanged.
 */
export function parentCompany(labelerName: string): string {
  const lower = labelerName.toLowerCase();
  for (const [needle, parent] of PARENT_COMPANIES) {
    if (lower.includes(needle)) return parent;
  }
  return tidyLabelerName(labelerName);
}

/** Strips the corporate suffixes that make a ledger unreadable. */
function tidyLabelerName(name: string): string {
  return name
    .replace(
      /,?\s+(inc|llc|l\.l\.c\.|ltd|limited|corp|corporation|co|company|plc|gmbh|a\/s|s\.a\.|pty|lp|l\.p\.|usa|u\.s\.a\.)\.?$/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadLabelers(path: string): Promise<LabelerLookup> {
  const byProduct = new Map<string, string>();
  const counts = new Map<string, Map<string, number>>();

  const stream = createInterface({
    input: createReadStream(path, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  let ndcIdx = -1;
  let labelerIdx = -1;

  for await (const line of stream) {
    const cols = line.split("\t");
    if (!header) {
      header = cols;
      ndcIdx = header.indexOf("PRODUCTNDC");
      labelerIdx = header.indexOf("LABELERNAME");
      if (ndcIdx < 0 || labelerIdx < 0) {
        throw new Error("product.txt is missing PRODUCTNDC or LABELERNAME");
      }
      continue;
    }
    const key = normalizeProductNdc(cols[ndcIdx] ?? "");
    const name = (cols[labelerIdx] ?? "").trim();
    if (!key || !name) continue;

    if (!byProduct.has(key)) byProduct.set(key, name);

    const code = key.slice(0, 5);
    const perCode = counts.get(code) ?? new Map<string, number>();
    perCode.set(name, (perCode.get(name) ?? 0) + 1);
    counts.set(code, perCode);
  }

  // A labeler code can carry several legal names over its life. The one that
  // appears on the most listings is the best answer for products we cannot
  // match exactly.
  const byLabeler = new Map<string, string>();
  for (const [code, names] of counts) {
    let best = "";
    let bestN = -1;
    for (const [name, n] of names) {
      if (n > bestN) {
        best = name;
        bestN = n;
      }
    }
    byLabeler.set(code, best);
  }

  return { byProduct, byLabeler };
}
