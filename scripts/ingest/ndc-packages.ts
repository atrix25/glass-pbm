/**
 * Package sizes from the FDA NDC Directory.
 *
 * A formulary limit of "12 tubes per year" and a claim billed for 60 grams are
 * both true statements about the same fill, and neither can be checked against
 * the other without knowing how many grams are in a tube. NADAC does not say.
 * The FDA does, in package.txt, in a field written for humans:
 *
 *   https://www.accessdata.fda.gov/cder/ndctext.zip   (package.txt)
 *
 *   "1 TUBE in 1 CARTON (0023-0312-04)  / 3.5 g in 1 TUBE"
 *   "25 POUCH in 1 CARTON  / 1 TUBE in 1 POUCH  / 2 mL in 1 TUBE"
 *   "30 KIT in 1 CARTON  / 1 KIT in 1 KIT *  1 mL in 1 VIAL  *  1 mL in 1 SYRINGE"
 *
 * The grammar underneath is small. A description is a chain of segments from
 * outermost container inwards, each of the form "<n> <thing> in 1 <parent>",
 * where the innermost <thing> is a quantity in a unit of measure rather than a
 * count of containers. Read from the inside out, each level multiplies: a tube
 * holds 3.5 grams, a pouch holds one tube, a carton holds twenty-five pouches.
 *
 * What comes out is not a single number but a map — how much each *named*
 * container holds — because that is the shape the question comes in. A limit
 * says "tubes", or "inhalers", or "vials", and the answer has to be about the
 * noun the plan used. Recording only a total would make "1 inhaler/30 days"
 * unanswerable for a carton of three.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Units of measure that terminate a chain, normalized to the NADAC unit. */
const MEASURES: Record<string, "GM" | "ML" | "EA"> = {
  g: "GM",
  gm: "GM",
  mg: "GM",
  ug: "GM",
  mcg: "GM",
  kg: "GM",
  ml: "ML",
  l: "ML",
  ul: "ML",
};

/** Multiplier onto the normalized unit: milligrams are grams, litres are mL. */
const SCALE: Record<string, number> = {
  g: 1,
  gm: 1,
  mg: 0.001,
  ug: 0.000001,
  mcg: 0.000001,
  kg: 1000,
  ml: 1,
  l: 1000,
  ul: 0.001,
};

export interface PackageContents {
  /** Container noun, upper case and singular-ish as FDA prints it, to how much
   *  it holds in the normalized unit. */
  byContainer: Map<string, number>;
  /** The unit those amounts are in. */
  unit: "GM" | "ML" | "EA";
  /** The outermost container's contents, which is the package as dispensed. */
  total: number;
  /** The FDA text, kept so a number on a screen can be traced to its source. */
  description: string;
}

interface Segment {
  count: number;
  /** What is being counted: a container noun, or a unit of measure. */
  thing: string;
  parent: string;
}

/** "1 TUBE in 1 CARTON (0023-0312-04)" -> { count: 1, thing: TUBE, parent: CARTON } */
function parseSegment(raw: string): Segment | null {
  const text = raw
    // Drop the package codes: they identify, they do not quantify.
    .replace(/\((?:[\d-]+)\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^([\d.]+)\s+(.+?)\s+in\s+1\s+(.+)$/.exec(text);
  if (!m) return null;
  const count = parseFloat(m[1]);
  if (!Number.isFinite(count)) return null;
  return { count, thing: m[2].trim(), parent: m[3].trim() };
}

/**
 * A container noun, reduced so "VIAL, SINGLE-DOSE" and "VIAL" are one thing and
 * so a limit written "vials" can find it.
 *
 * The qualifiers FDA appends describe how the container is used, not what it
 * is, and a formulary never writes them. "TUBE, WITH APPLICATOR" is a tube.
 */
export function containerKey(noun: string): string {
  return noun
    .split(",")[0]
    .replace(/[^A-Za-z ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/S$/, "");
}

/**
 * Read one PACKAGEDESCRIPTION into how much each named container holds.
 *
 * Returns null when the description does not terminate in a measured quantity —
 * "30 TABLET in 1 BOTTLE" counts tablets, which are already the billing unit and
 * need no conversion, so there is nothing here a quantity limit needs.
 */
export function parsePackageDescription(
  description: string,
): PackageContents | null {
  if (!description.trim()) return null;

  /*
   * Slashes separate levels of nesting, outermost first. Asterisks separate the
   * components of one level, which is how a kit lists what is in it. The two
   * are not interchangeable and flattening them loses the fact that a kit's
   * components are siblings that sum rather than a chain that multiplies.
   */
  const levels = description
    .split(/\s+\/\s+/)
    .map((level) =>
      level
        .split(/\s+\*\s+/)
        .map((s) => parseSegment(s))
        .filter((s): s is Segment => s !== null),
    )
    .filter((level) => level.length > 0);

  if (levels.length === 0) return null;

  const holds = new Map<string, number>();
  let unit: "GM" | "ML" | "EA" | null = null;

  // Innermost level first, so a container's contents are known before the level
  // that counts those containers is reached.
  for (const level of [...levels].reverse()) {
    const measures = level.filter((s) => MEASURES[s.thing.toLowerCase()]);
    const counts = level.filter((s) => !MEASURES[s.thing.toLowerCase()]);

    let levelTotal = 0;
    for (const seg of measures) {
      const lower = seg.thing.toLowerCase();
      const amount = seg.count * (SCALE[lower] ?? 1);
      const key = containerKey(seg.parent);
      holds.set(key, (holds.get(key) ?? 0) + amount);
      levelTotal += amount;
      unit = unit ?? MEASURES[lower];
    }

    for (const seg of counts) {
      const inner = holds.get(containerKey(seg.thing));
      if (inner !== undefined) {
        holds.set(
          containerKey(seg.parent),
          (holds.get(containerKey(seg.parent)) ?? 0) + seg.count * inner,
        );
        continue;
      }
      /*
       * "1 KIT in 1 KIT" alongside the components it introduces. FDA writes the
       * kit as its own parent and then lists what is inside it as siblings, so
       * the kit holds the sum of those siblings.
       */
      if (levelTotal > 0) {
        const key = containerKey(seg.parent);
        holds.set(key, (holds.get(key) ?? 0) + seg.count * levelTotal);
      }
    }
  }

  if (unit === null || holds.size === 0) return null;

  // The outermost level names the package as dispensed.
  const outer = containerKey(levels[0][0].parent);
  const total = holds.get(outer) ?? 0;
  if (!(total > 0)) return null;

  return { byContainer: holds, unit, total, description: description.trim() };
}

/** Pads an FDA NDCPACKAGECODE ("0023-0312-04", "50458-580-01") to 11 digits. */
export function normalizePackageNdc(code: string): string | null {
  const parts = code.split("-");
  if (parts.length !== 3) return null;
  const [labeler, product, pack] = parts;
  return (
    labeler.padStart(5, "0") + product.padStart(4, "0") + pack.padStart(2, "0")
  );
}

export interface PackageLookup {
  /** Eleven-digit NDC to what its package holds. */
  byNdc11: Map<string, PackageContents>;
  /** Nine-digit labeler+product key, for when the package segment disagrees. */
  byProduct: Map<string, PackageContents>;
  /** Descriptions that parsed to nothing measurable, for the coverage report. */
  unparsed: number;
  rows: number;
}

export async function loadPackages(path: string): Promise<PackageLookup> {
  const byNdc11 = new Map<string, PackageContents>();
  const byProduct = new Map<string, PackageContents>();
  let unparsed = 0;
  let rows = 0;

  const stream = createInterface({
    input: createReadStream(path, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  let codeIdx = -1;
  let descIdx = -1;

  for await (const line of stream) {
    const cols = line.split("\t");
    if (!header) {
      header = cols;
      codeIdx = header.indexOf("NDCPACKAGECODE");
      descIdx = header.indexOf("PACKAGEDESCRIPTION");
      if (codeIdx < 0 || descIdx < 0) {
        throw new Error(
          "package.txt is missing NDCPACKAGECODE or PACKAGEDESCRIPTION",
        );
      }
      continue;
    }
    rows++;
    const ndc11 = normalizePackageNdc(cols[codeIdx] ?? "");
    const contents = parsePackageDescription(cols[descIdx] ?? "");
    if (!contents) {
      unparsed++;
      continue;
    }
    if (ndc11) {
      if (!byNdc11.has(ndc11)) byNdc11.set(ndc11, contents);
      const productKey = ndc11.slice(0, 9);
      if (!byProduct.has(productKey)) byProduct.set(productKey, contents);
    }
  }

  return { byNdc11, byProduct, unparsed, rows };
}
