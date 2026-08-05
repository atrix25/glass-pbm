/**
 * Molecule identity for the formulary.
 *
 * The formulary was transcribed from a PDF that lists products, so Xarelto and
 * rivaroxaban arrive as two unrelated rows. Anything clinical needs to know
 * they are the same drug: without it, a duplicate-therapy check reports every
 * member who switched from brand to generic, and the finding is worthless.
 *
 * Generic rows carry their ingredient in the name already. Brands do not, so
 * they are mapped by hand. A brand that is not in the map falls back to its
 * own name, which is the conservative direction: it may miss a duplication, it
 * cannot invent one between two different molecules.
 */

/**
 * Brand names in this formulary, mapped to their active ingredient.
 *
 * A brand name shares no letters with what is inside it, so nothing can be
 * inferred here and every row is a fact that has to be written down. The list
 * began as whatever duplicate-therapy screening tripped over, which is why it
 * leans on central nervous system products; the cardiometabolic and respiratory
 * blockbusters were added when it turned out the claim generator could not find
 * them either. A molecule the crosswalk cannot resolve is a molecule the
 * generator treats as rare, and Ozempic, Jardiance and Lantus are not rare.
 */
const BRAND_TO_MOLECULE: Record<string, string> = {
  ABILIFY: "aripiprazole",
  ACTOS: "pioglitazone",
  ADVAIR: "fluticasone-salmeterol",
  AIRDUO: "fluticasone-salmeterol",
  ALLEGRA: "fexofenadine",
  ALTACE: "ramipril",
  AMARYL: "glimepiride",
  ASTELIN: "azelastine",
  ATROVENT: "ipratropium",
  BASAGLAR: "insulin-glargine",
  BENICAR: "olmesartan",
  BREO: "fluticasone-vilanterol",
  BYSTOLIC: "nebivolol",
  CLARITIN: "loratadine",
  COMBIVENT: "albuterol-ipratropium",
  COREG: "carvedilol",
  COSENTYX: "secukinumab",
  COUMADIN: "warfarin",
  COZAAR: "losartan",
  CYMBALTA: "duloxetine",
  DEXILANT: "dexlansoprazole",
  DIOVAN: "valsartan",
  DULERA: "formoterol-mometasone",
  DUPIXENT: "dupilumab",
  EFFEXOR: "venlafaxine",
  ENBREL: "etanercept",
  ENTRESTO: "sacubitril-valsartan",
  FARXIGA: "dapagliflozin",
  FLONASE: "fluticasone",
  FLOVENT: "fluticasone",
  GLUCOPHAGE: "metformin",
  HUMALOG: "insulin-lispro",
  HUMIRA: "adalimumab",
  INVOKANA: "canagliflozin",
  JANUMET: "metformin-sitagliptin",
  JANUVIA: "sitagliptin",
  JARDIANCE: "empagliflozin",
  LANTUS: "insulin-glargine",
  LASIX: "furosemide",
  LEVEMIR: "insulin-detemir",
  LEXAPRO: "escitalopram",
  LIPITOR: "atorvastatin",
  LOVAZA: "omega-acid-esters-ethyl",
  LYRICA: "pregabalin",
  MICARDIS: "telmisartan",
  MOUNJARO: "tirzepatide",
  NASONEX: "mometasone",
  NEURONTIN: "gabapentin",
  NEXIUM: "esomeprazole",
  NORVASC: "amlodipine",
  NOVOLOG: "insulin-aspart",
  OTEZLA: "apremilast",
  OZEMPIC: "semaglutide",
  PATADAY: "olopatadine",
  PATANOL: "olopatadine",
  PLAVIX: "clopidogrel",
  PRALUENT: "alirocumab",
  PREVACID: "lansoprazole",
  PRINIVIL: "lisinopril",
  PROAIR: "albuterol",
  PROTONIX: "pantoprazole",
  PROVENTIL: "albuterol",
  PROZAC: "fluoxetine",
  REMICADE: "infliximab",
  RINVOQ: "upadacitinib",
  RYBELSUS: "semaglutide",
  SINGULAIR: "montelukast",
  SKYRIZI: "risankizumab",
  SPIRIVA: "tiotropium",
  STELARA: "ustekinumab",
  SYMBICORT: "budesonide-formoterol",
  SYNJARDY: "empagliflozin-metformin",
  SYNTHROID: "levothyroxine",
  TALTZ: "ixekizumab",
  TOPROL: "metoprolol",
  TRADJENTA: "linagliptin",
  TRELEGY: "fluticasone-umeclidinium-vilanterol",
  TRESIBA: "insulin-degludec",
  TREMFYA: "guselkumab",
  TRULICITY: "dulaglutide",
  VASCEPA: "icosapent-ethyl",
  VASOTEC: "enalapril",
  VENTOLIN: "albuterol",
  VICTOZA: "liraglutide",
  WEGOVY: "semaglutide",
  WELLBUTRIN: "bupropion",
  XALATAN: "latanoprost",
  XELJANZ: "tofacitinib",
  XIGDUO: "dapagliflozin-metformin",
  XOLAIR: "omalizumab",
  XYZAL: "levocetirizine",
  ZESTRIL: "lisinopril",
  ZOLOFT: "sertraline",
  ZYRTEC: "cetirizine",
  ADZENYS: "amphetamine",
  ALTOPREV: "lovastatin",
  APTIOM: "eslicarbazepine",
  ATORVALIQ: "atorvastatin",
  AUVELITY: "dextromethorphan-bupropion",
  AZSTARYS: "dexmethylphenidate",
  BANZEL: "rufinamide",
  BELBUCA: "buprenorphine",
  BRIVIACT: "brivaracetam",
  CAPLYTA: "lumateperone",
  COBENFY: "xanomeline-trospium",
  COTEMPLA: "methylphenidate",
  CRESTOR: "rosuvastatin",
  DAYVIGO: "lemborexant",
  DILANTIN: "phenytoin",
  DRIZALMA: "duloxetine",
  DYANAVEL: "amphetamine",
  EDLUAR: "zolpidem",
  ELIQUIS: "apixaban",
  EMSAM: "selegiline",
  EPRONTIA: "topiramate",
  EQUETRO: "carbamazepine",
  EVEKEO: "amphetamine",
  EXXUA: "gepirone",
  FANAPT: "iloperidone",
  FETZIMA: "levomilnacipran",
  FYCOMPA: "perampanel",
  GABARONE: "gabapentin",
  LATUDA: "lurasidone",
  LIVALO: "pitavastatin",
  LOREEV: "lorazepam",
  MOTPOLY: "lacosamide",
  MS: "morphine", // MS Contin
  MYDAYIS: "amphetamine",
  NARDIL: "phenelzine",
  NAYZILAM: "midazolam",
  NEXLETOL: "bempedoic acid",
  NEXLIZET: "bempedoic acid-ezetimibe",
  NUPLAZID: "pimavanserin",
  ONFI: "clobazam",
  ONYDA: "clonidine",
  OXTELLAR: "oxcarbazepine",
  OXYCONTIN: "oxycodone",
  PRILOSEC: "omeprazole",
  QELBREE: "viloxazine",
  QUDEXY: "topiramate",
  QUILLICHEW: "methylphenidate",
  QUILLIVANT: "methylphenidate",
  QUVIVIQ: "daridorexant",
  REPATHA: "evolocumab",
  REXULTI: "brexpiprazole",
  ROXYBOND: "oxycodone",
  SAVAYSA: "edoxaban",
  SECUADO: "asenapine",
  SUBOXONE: "buprenorphine",
  SUBVENITE: "lamotrigine",
  SUNOSI: "solriamfetol",
  SYMPAZAN: "clobazam",
  TRINTELLIX: "vortioxetine",
  TROKENDI: "topiramate",
  VALTOCO: "diazepam",
  VIMPAT: "lacosamide",
  VRAYLAR: "cariprazine",
  VYVANSE: "lisdexamfetamine",
  WELCHOL: "colesevelam",
  XARELTO: "rivaroxaban",
  XCOPRI: "cenobamate",
  ZETIA: "ezetimibe",
  ZOCOR: "simvastatin",
  ZONISADE: "zonisamide",
  ZUBSOLV: "buprenorphine",
  ZYPITAMAG: "pitavastatin",
};

/** Salt and ester suffixes that do not change the molecule for this purpose. */
const SALT_WORDS = new Set([
  "hcl",
  "hydrochloride",
  "sodium",
  "potassium",
  "calcium",
  "sulfate",
  "sulf",
  "succinate",
  "tartrate",
  "maleate",
  "besylate",
  "mesylate",
  "fumarate",
  "citrate",
  "acetate",
  "phosphate",
  "bitartrate",
  "etexilate",
  "magnesium",
  "napsylate",
]);

/** Words describing the form, release, or packaging rather than the drug. */
const FORM_WORDS = new Set([
  "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules",
  "soln", "solution", "susp", "suspension", "syrup", "elixir", "conc",
  "concentrate", "inj", "injection", "syringe", "vial", "pen", "kit", "pack",
  "starter", "film", "patch", "spray", "cream", "ointment", "gel", "lotion",
  "er", "xr", "sr", "ir", "cr", "dr", "la", "odt", "sl", "sublingual", "oral",
  "chewable", "chew", "disintegrating", "extended", "release", "delayed",
  "for", "with", "and", "in", "of", "mg", "mcg", "ml", "gm", "unit", "units",
  "pkt", "packet", "bottle", "dose", "day", "hr", "hour",
]);

/**
 * Reduces a product to the molecule it contains.
 *
 * Prefers the NADAC description, which is a CMS-published string, over the
 * transcribed formulary name.
 */
export function moleculeKey(
  nadacDescription: string | null,
  name: string,
): string {
  const source = (nadacDescription ?? name).toUpperCase();

  const firstToken = source.split(/[\s,]+/)[0]?.replace(/[^A-Z-]/g, "") ?? "";
  const mapped = BRAND_TO_MOLECULE[firstToken];
  if (mapped) return mapped;

  // Everything before the first digit is the ingredient list.
  const namePart = source.split(/\d/)[0] ?? source;
  const key = normalizeIngredients(namePart);
  if (key === "") return firstToken.toLowerCase() || name.toLowerCase();
  return key;
}

/**
 * Reduce an ingredient list to a stable key.
 *
 * Combination products keep every ingredient, in sorted order, so that
 * hydrocodone-acetaminophen is not confused with plain hydrocodone and so that
 * two sources naming the same combination in different orders agree.
 *
 * Exported because the published dispensing-volume table is keyed by molecule
 * and has to be reduced by exactly this rule to line up with the formulary. Two
 * implementations of the same normalisation would silently fail to match on the
 * combination products, which is most of the antihypertensives.
 */
/**
 * Ingredient tokens, with salt and ester words kept.
 *
 * Distinct from the molecule key on purpose. The key strips salts so that
 * metoprolol tartrate and metoprolol succinate count as one molecule, which is
 * what duplicate-therapy screening needs. Matching against a published drug
 * list needs the opposite: the published list names some products by their
 * salt, and "Potassium Chloride" reduced to "chloride" matches nothing.
 *
 * Form and packaging words are still dropped, since no published list calls a
 * drug "solostar".
 */
export function ingredientTokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[\s,/;+()-]+/)
    .map((w) => w.replace(/[^a-z]/g, ""))
    .filter(Boolean)
    .filter((w) => !FORM_WORDS.has(w));
  return new Set(words);
}

export function normalizeIngredients(text: string): string {
  const words = text
    .toLowerCase()
    .split(/[\s,/;]+/)
    .map((w) => w.replace(/[^a-z-]/g, ""))
    .filter(Boolean)
    .filter((w) => !FORM_WORDS.has(w) && !SALT_WORDS.has(w));

  const parts = words
    .flatMap((w) => w.split("-"))
    .filter(Boolean)
    .filter((w) => !FORM_WORDS.has(w) && !SALT_WORDS.has(w));

  return [...new Set(parts)].sort().join("-");
}
