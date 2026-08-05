/**
 * Morphine milligram equivalents.
 *
 * The point of doing this properly is that it is the one clinical calculation
 * in the build where every input is public. The conversion factors are the
 * CDC's published table. The strengths are parsed out of the NDC descriptions
 * in the CMS NADAC file already sitting in this repo, so they are attributes
 * of real NDCs rather than assumptions. Quantity and days supply come off the
 * claim. Nothing in the chain is invented, which means a clinician in the room
 * can check the arithmetic against a number they already know.
 *
 * Where the CDC declines to publish a factor, so does this. Buprenorphine is
 * the important case: it is a partial agonist with a ceiling effect and the
 * 2022 guideline explicitly says not to convert it. Those fills are still
 * counted as opioid fills, and are left out of the dose total with the reason
 * recorded, which is the clinically correct answer and also the honest one.
 */

/**
 * CDC 2022 Clinical Practice Guideline for Prescribing Opioids for Pain,
 * conversion factor table. Doses are in morphine milligram equivalents per
 * day.
 */
export const MME_FACTORS: Record<string, number> = {
  codeine: 0.15,
  dihydrocodeine: 0.25,
  // Transdermal, applied to micrograms per hour rather than to milligrams.
  fentanyl: 2.4,
  hydrocodone: 1,
  hydromorphone: 5,
  levorphanol: 11,
  meperidine: 0.1,
  methadone: 4.7,
  morphine: 1,
  oxycodone: 1.5,
  oxymorphone: 3,
  pentazocine: 0.37,
  tapentadol: 0.4,
  tramadol: 0.2,
};

/**
 * Molecules the CDC table deliberately omits. Recording the reason keeps the
 * exclusion auditable instead of looking like a gap.
 */
export const NON_CONVERTIBLE: Record<string, string> = {
  buprenorphine:
    "Partial agonist with a ceiling effect. The CDC 2022 guideline does not publish a morphine equivalence and advises against converting it.",
  butorphanol:
    "Mixed agonist-antagonist administered nasally. No conversion factor is published in the CDC table.",
};

/** Brand names in the NADAC descriptions, mapped to their opioid ingredient. */
const BRAND_MOLECULES: Record<string, string> = {
  "MS CONTIN": "morphine",
  OXYCONTIN: "oxycodone",
  ROXYBOND: "oxycodone",
  SUBOXONE: "buprenorphine",
  ZUBSOLV: "buprenorphine",
  BELBUCA: "buprenorphine",
  DILAUDID: "hydromorphone",
  PERCOCET: "oxycodone",
  NORCO: "hydrocodone",
  VICODIN: "hydrocodone",
  ULTRAM: "tramadol",
  NUCYNTA: "tapentadol",
  DURAGESIC: "fentanyl",
  OPANA: "oxymorphone",
  XTAMPZA: "oxycodone",
};

const ALL_MOLECULES = [
  ...Object.keys(MME_FACTORS),
  ...Object.keys(NON_CONVERTIBLE),
];

export interface ParsedOpioid {
  molecule: string;
  /** Milligrams per dispensing unit, or micrograms per hour for patches. */
  strengthMg: number;
  mmeFactor: number;
  isTransdermal: boolean;
  convertible: boolean;
  exclusionReason: string | null;
}

/**
 * Reads the opioid ingredient and its strength out of a NADAC NDC description.
 *
 * Combination products are the fiddly part, because the opioid is not always
 * first: "HYDROCODONE-ACETAMINOPHEN 10-300 MG" leads with the opioid but
 * "ACETAMINOPHEN-CODEINE 300-30 MG" does not. So the ingredient list and the
 * strength list are matched up by position rather than assuming an order.
 */
export function parseOpioid(description: string): ParsedOpioid | null {
  const desc = description.toUpperCase();

  let molecule: string | null = null;
  let moleculeIndex = 0;

  // Ingredients are the hyphenated words before the first number.
  const namePart = desc.split(/\s+\d/)[0] ?? desc;
  const ingredients = namePart
    .split("-")
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = 0; i < ingredients.length; i++) {
    const found = ALL_MOLECULES.find((m) =>
      ingredients[i].includes(m.toUpperCase()),
    );
    if (found) {
      molecule = found;
      moleculeIndex = i;
      break;
    }
  }

  if (!molecule) {
    for (const [brand, m] of Object.entries(BRAND_MOLECULES)) {
      if (desc.includes(brand)) {
        molecule = m;
        moleculeIndex = 0;
        break;
      }
    }
  }

  if (!molecule) return null;

  const isTransdermal = /MCG\/HR/.test(desc);
  const convertible = !(molecule in NON_CONVERTIBLE);
  const exclusionReason = NON_CONVERTIBLE[molecule] ?? null;
  const mmeFactor = MME_FACTORS[molecule] ?? 0;

  const strength = parseStrength(desc, moleculeIndex);
  if (strength === null) return null;

  return {
    molecule,
    strengthMg: strength,
    mmeFactor,
    isTransdermal,
    convertible,
    exclusionReason,
  };
}

/**
 * Pulls the strength for one ingredient out of a description.
 *
 * Liquids are stated per volume ("10 MG/5 ML"), and the claim's quantity is in
 * millilitres, so those are reduced to milligrams per millilitre to keep the
 * dose arithmetic uniform.
 */
function parseStrength(desc: string, ingredientIndex: number): number | null {
  // Patches: "100 MCG/HR".
  const patch = desc.match(/(\d+(?:\.\d+)?)\s*MCG\/HR/);
  if (patch) return Number(patch[1]);

  // Liquids: "10 MG/5 ML", "1 MG/ML", "7.5-325 MG/15 ML".
  const liquid = desc.match(
    /((?:\d+(?:\.\d+)?)(?:-\d+(?:\.\d+)?)*)\s*MG\/(\d+(?:\.\d+)?)?\s*ML/,
  );
  if (liquid) {
    const strengths = liquid[1].split("-").map(Number);
    const per = liquid[2] ? Number(liquid[2]) : 1;
    const mg = strengths[Math.min(ingredientIndex, strengths.length - 1)];
    if (!Number.isFinite(mg) || per === 0) return null;
    return mg / per;
  }

  // Micrograms per unit: "150 MCG FILM".
  const mcg = desc.match(/(\d+(?:\.\d+)?)\s*MCG(?!\/)/);
  if (mcg) return Number(mcg[1]) / 1000;

  // Solids: "10 MG", "10-300 MG", "0.7-0.18 MG".
  const solid = desc.match(/((?:\d+(?:\.\d+)?)(?:-\d+(?:\.\d+)?)*)\s*MG(?!\/)/);
  if (solid) {
    const strengths = solid[1].split("-").map(Number);
    const mg = strengths[Math.min(ingredientIndex, strengths.length - 1)];
    return Number.isFinite(mg) ? mg : null;
  }

  // A few NADAC descriptions drop the unit on a combination, as in
  // "HYDROCODONE-IBUPROFEN 10-200". Milligrams is the only reading of a
  // hyphenated pair in an oral solid, so take it rather than lose the product.
  const bare = desc.match(/\s(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)+)\s*$/);
  if (bare) {
    const strengths = bare[1].split("-").map(Number);
    const mg = strengths[Math.min(ingredientIndex, strengths.length - 1)];
    return Number.isFinite(mg) ? mg : null;
  }

  return null;
}

export interface MmeInput {
  quantityDispensed: number;
  daysSupply: number;
  strengthMg: number;
  mmeFactor: number;
  isTransdermal: boolean;
}

/**
 * Daily morphine milligram equivalents for one fill.
 *
 * Patches deliver at a fixed rate for as long as they are worn, so their dose
 * is the rate times the factor and quantity does not enter into it. Everything
 * else is total milligrams dispensed spread over the days it has to cover.
 */
export function dailyMme(input: MmeInput): number {
  if (input.isTransdermal) return input.strengthMg * input.mmeFactor;
  if (input.daysSupply <= 0) return 0;
  return (
    (input.quantityDispensed * input.strengthMg * input.mmeFactor) /
    input.daysSupply
  );
}

/**
 * CDC 2022 dose thresholds. The guideline frames these as points to reassess
 * rather than hard ceilings, and the wording here follows that.
 */
export const MME_THRESHOLDS = {
  reassess: 50,
  avoidOrJustify: 90,
} as const;

export function mmeBand(mme: number): "none" | "reassess" | "high" {
  if (mme >= MME_THRESHOLDS.avoidOrJustify) return "high";
  if (mme >= MME_THRESHOLDS.reassess) return "reassess";
  return "none";
}
