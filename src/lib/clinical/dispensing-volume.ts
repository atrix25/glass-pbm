/**
 * How often each molecule is actually dispensed.
 *
 * Without this, the claim generator draws uniformly from whatever the formulary
 * happens to list inside a therapeutic class, and a formulary lists drugs
 * without regard to how often anyone takes them. The result was a book whose
 * most-dispensed product was diflunisal, followed by salsalate and
 * demeclocycline — three drugs a working pharmacist might go a year without
 * seeing — while atorvastatin, levothyroxine and lisinopril appeared nowhere
 * near the top.
 *
 * That is not merely embarrassing on a dashboard. Obscure products sit at the
 * non-preferred levels, because that is what a formulary does with them, so a
 * uniform draw loads the book with Level 2 and Level 3 fills: 38% of claims
 * against a real plan's low single digits. Level 3 carries coinsurance, so the
 * member's share of drug spend came out at 18.8% against the 10.6% the sponsor
 * publishes, and cost per member ran 20% high. The whole calibration was
 * downstream of one uniform draw.
 *
 * Counts are annual United States prescriptions by molecule, from the ClinCalc
 * DrugStats database, which standardises the federal Medical Expenditure Panel
 * Survey prescribed-medicines file. They are national rather than specific to
 * this sponsor, and they are a relative weight here rather than a target — the
 * generator uses them to decide which drug inside a therapeutic class a member
 * reaches for, and the class mix is set separately by clinical frequency.
 *
 * Only the published top 300 are listed. Everything else keeps a small floor
 * weight, because a drug being outside the top 300 means rarely dispensed, not
 * never.
 */

import {
  ingredientTokens,
  moleculeKey,
  normalizeIngredients,
} from "./molecules.js";

export const DISPENSING_VOLUME_SOURCE = "clincalc-drugstats-2023";

/**
 * Weight given to a molecule outside the published top 300.
 *
 * Set just below the smallest listed count, so the tail is reachable but never
 * competes with a drug people actually take. The formulary carries roughly
 * 1,500 products against 300 listed molecules, so this floor is what the long
 * tail of the catalog draws on.
 */
export const UNLISTED_MOLECULE_WEIGHT = 200_000;

/**
 * Molecule names as published, with annual prescription counts.
 *
 * Left in the source's own wording rather than pre-normalised, so the list can
 * be checked against the published page line by line.
 */
const PUBLISHED: Array<[string, number]> = [
  ["Atorvastatin", 115_271_514],
  ["Metformin", 85_685_925],
  ["Levothyroxine", 80_930_390],
  ["Lisinopril", 76_055_039],
  ["Amlodipine", 68_743_650],
  ["Metoprolol", 59_547_256],
  ["Albuterol", 59_546_183],
  ["Losartan", 56_174_734],
  ["Gabapentin", 45_964_505],
  ["Omeprazole", 45_290_895],
  ["Sertraline", 42_578_018],
  ["Rosuvastatin", 42_103_429],
  ["Pantoprazole", 37_101_751],
  ["Escitalopram", 37_088_584],
  ["Dextroamphetamine; Amphetamine", 32_566_892],
  ["Hydrochlorothiazide", 31_775_977],
  ["Bupropion", 30_349_390],
  ["Fluoxetine", 27_518_944],
  ["Semaglutide", 25_954_066],
  ["Montelukast", 25_893_501],
  ["Trazodone", 24_708_571],
  ["Simvastatin", 24_585_762],
  ["Amoxicillin", 23_510_711],
  ["Tamsulosin", 22_898_080],
  ["Acetaminophen; Hydrocodone", 21_506_768],
  ["Fluticasone", 21_041_607],
  ["Meloxicam", 20_703_689],
  ["Apixaban", 19_829_711],
  ["Furosemide", 19_138_347],
  ["Insulin Glargine", 18_424_802],
  ["Duloxetine", 18_067_156],
  ["Ibuprofen", 17_525_800],
  ["Famotidine", 16_883_437],
  ["Empagliflozin", 16_744_581],
  ["Carvedilol", 16_566_781],
  ["Tramadol", 16_010_294],
  ["Alprazolam", 15_881_366],
  ["Prednisone", 15_794_243],
  ["Hydroxyzine", 15_272_377],
  ["Buspirone", 15_229_212],
  ["Clopidogrel", 15_227_565],
  ["Glipizide", 15_173_475],
  ["Citalopram", 14_769_554],
  ["Potassium Chloride", 14_514_606],
  ["Allopurinol", 14_311_839],
  ["Aspirin", 14_095_181],
  ["Cyclobenzaprine", 13_973_843],
  ["Ergocalciferol", 13_705_855],
  ["Oxycodone", 13_502_066],
  ["Methylphenidate", 13_248_734],
  ["Venlafaxine", 13_234_839],
  ["Spironolactone", 12_777_045],
  ["Ondansetron", 12_503_157],
  ["Zolpidem", 11_424_127],
  ["Cetirizine", 11_399_497],
  ["Estradiol", 11_289_112],
  ["Pravastatin", 11_060_711],
  ["Hydrochlorothiazide; Lisinopril", 10_986_814],
  ["Lamotrigine", 10_895_178],
  ["Quetiapine", 10_655_017],
  ["Fluticasone; Salmeterol", 10_648_080],
  ["Clonazepam", 10_614_830],
  ["Dulaglutide", 10_358_270],
  ["Azithromycin", 10_337_595],
  ["Hydrochlorothiazide; Losartan", 9_882_017],
  ["Amoxicillin; Clavulanate", 9_831_525],
  ["Latanoprost", 9_792_338],
  ["Cholecalciferol", 9_737_465],
  ["Propranolol", 9_699_272],
  ["Ezetimibe", 9_686_244],
  ["Topiramate", 9_619_219],
  ["Paroxetine", 9_577_610],
  ["Diclofenac", 9_438_696],
  ["Budesonide; Formoterol", 9_346_242],
  ["Atenolol", 9_235_305],
  ["Lisdexamfetamine", 9_134_058],
  ["Doxycycline", 8_823_028],
  ["Pregabalin", 8_644_140],
  ["Ethinyl Estradiol; Norethindrone", 8_611_956],
  ["Glimepiride", 8_459_350],
  ["Tizanidine", 8_292_865],
  ["Clonidine", 8_128_031],
  ["Fenofibrate", 8_093_230],
  ["Insulin Lispro", 8_053_451],
  ["Valsartan", 7_983_441],
  ["Cephalexin", 7_869_737],
  ["Baclofen", 7_753_150],
  ["Rivaroxaban", 7_743_941],
  ["Ferrous Sulfate", 7_699_088],
  ["Amitriptyline", 7_568_933],
  ["Finasteride", 7_546_064],
  ["Dapagliflozin", 7_444_831],
  ["Acetaminophen; Oxycodone", 7_283_471],
  ["Folic Acid", 7_276_938],
  ["Aripiprazole", 7_197_548],
  ["Olmesartan", 7_175_746],
  ["Ethinyl Estradiol; Norgestimate", 7_175_433],
  ["Valacyclovir", 7_121_821],
  ["Mirtazapine", 6_977_141],
  ["Lorazepam", 6_963_899],
  ["Levetiracetam", 6_904_402],
  ["Insulin Aspart", 6_835_070],
  ["Naproxen", 6_808_486],
  ["Cyanocobalamin", 6_727_915],
  ["Loratadine", 6_699_690],
  ["Diltiazem", 6_562_727],
  ["Sumatriptan", 6_484_249],
  ["Triamcinolone", 6_476_980],
  ["Hydralazine", 6_327_003],
  ["Tirzepatide", 6_310_173],
  ["Celecoxib", 6_190_143],
  ["Acetaminophen", 5_984_654],
  ["Alendronate", 5_876_378],
  ["Oxybutynin", 5_874_390],
  ["Hydrochlorothiazide; Triamterene", 5_806_865],
  ["Warfarin", 5_793_664],
  ["Progesterone", 5_570_117],
  ["Fluticasone; Umeclidinium; Vilanterol", 5_533_174],
  ["Testosterone", 5_337_521],
  ["Nifedipine", 5_318_746],
  ["Methocarbamol", 5_288_774],
  ["Benzonatate", 5_225_510],
  ["Sitagliptin", 5_171_309],
  ["Chlorthalidone", 5_041_667],
  ["Isosorbide", 5_038_468],
  ["Donepezil", 4_919_269],
  ["Dexmethylphenidate", 4_826_840],
  ["Sulfamethoxazole; Trimethoprim", 4_667_341],
  ["Clobetasol", 4_643_351],
  ["Methotrexate", 4_611_809],
  ["Hydroxychloroquine", 4_438_796],
  ["Lovastatin", 4_392_660],
  ["Pioglitazone", 4_381_830],
  ["Irbesartan", 4_225_718],
  ["Methylprednisolone", 4_190_064],
  ["Norethindrone", 4_162_876],
  ["Meclizine", 4_086_408],
  ["Ethinyl Estradiol; Levonorgestrel", 4_052_882],
  ["Fluticasone; Vilanterol", 4_032_315],
  ["Ketoconazole", 3_987_777],
  ["Thyroid", 3_945_403],
  ["Azelastine", 3_932_233],
  ["Nitrofurantoin", 3_917_548],
  ["Adalimumab", 3_900_241],
  ["Memantine", 3_853_517],
  ["Prednisolone", 3_839_256],
  ["Esomeprazole", 3_828_168],
  ["Docusate", 3_798_215],
  ["Clindamycin", 3_775_741],
  ["Acyclovir", 3_766_454],
  ["Sildenafil", 3_760_682],
  ["Insulin Degludec", 3_663_825],
  ["Insulin Detemir", 3_584_061],
  ["Drospirenone; Ethinyl Estradiol", 3_566_507],
  ["Ciprofloxacin", 3_513_623],
  ["Morphine", 3_500_073],
  ["Insulin Human; Insulin Isophane Human", 3_487_065],
  ["Levocetirizine", 3_461_897],
  ["Nirmatrelvir; Ritonavir", 3_453_516],
  ["Valproate", 3_442_917],
  ["Atomoxetine", 3_431_315],
  ["Budesonide", 3_366_337],
  ["Tiotropium", 3_305_177],
  ["Melatonin", 3_256_782],
  ["Cefdinir", 3_168_051],
  ["Doxepin", 3_122_267],
  ["Olanzapine", 3_091_702],
  ["Phentermine", 3_003_107],
  ["Ofloxacin", 2_987_657],
  ["Ethinyl Estradiol; Etonogestrel", 2_987_624],
  ["Mupirocin", 2_982_603],
  ["Benazepril", 2_965_135],
  ["Timolol", 2_946_884],
  ["Magnesium Salts", 2_903_672],
  ["Fluconazole", 2_871_500],
  ["Risperidone", 2_865_210],
  ["Verapamil", 2_819_767],
  ["Linaclotide", 2_817_174],
  ["Cyclosporine", 2_796_137],
  ["Doxazosin", 2_735_065],
  ["Albuterol; Ipratropium", 2_727_765],
  ["Hydrocortisone", 2_711_652],
  ["Diazepam", 2_711_267],
  ["Telmisartan", 2_693_425],
  ["Carbamazepine", 2_687_079],
  ["Amlodipine; Benazepril", 2_681_344],
  ["Lithium", 2_680_151],
  ["Evolocumab", 2_633_257],
  ["Desvenlafaxine", 2_585_138],
  ["Dorzolamide", 2_569_413],
  ["Nebivolol", 2_568_389],
  ["Dicyclomine", 2_561_309],
  ["Torsemide", 2_545_175],
  ["Anastrozole", 2_536_493],
  ["Enalapril", 2_507_125],
  ["Polyethylene Glycol", 2_491_296],
  ["Tretinoin", 2_454_022],
  ["Tadalafil", 2_443_768],
  ["Sacubitril; Valsartan", 2_442_361],
  ["Calcium", 2_427_416],
  ["Pramipexole", 2_398_374],
  ["Mesalamine", 2_365_207],
  ["Metronidazole", 2_318_178],
  ["Nortriptyline", 2_314_282],
  ["Emtricitabine; Tenofovir", 2_273_387],
  ["Rimegepant", 2_263_880],
  ["Nitroglycerin", 2_238_376],
  ["Rizatriptan", 2_219_594],
  ["Liraglutide", 2_191_691],
  ["Acetaminophen; Codeine", 2_189_480],
  ["Ramipril", 2_148_133],
  ["Ropinirole", 2_086_907],
  ["Brimonidine", 2_061_060],
  ["Mirabegron", 2_045_781],
  ["Colchicine", 2_010_102],
  ["Ticagrelor", 2_006_287],
  ["Terazosin", 1_989_756],
  ["Amiodarone", 1_974_861],
  ["Fexofenadine", 1_951_572],
  ["Liothyronine", 1_884_613],
  ["Bisoprolol", 1_816_701],
  ["Omega-3-acid Ethyl Esters", 1_810_280],
  ["Flecainide", 1_805_937],
  ["Oxcarbazepine", 1_763_679],
  ["Desogestrel; Ethinyl Estradiol", 1_722_386],
  ["Ascorbic Acid", 1_705_386],
  ["Sodium Salts", 1_698_017],
  ["Ketorolac", 1_627_126],
  ["Dorzolamide; Timolol", 1_620_620],
  ["Promethazine", 1_611_034],
  ["Levofloxacin", 1_583_754],
  ["Labetalol", 1_555_592],
  ["Nystatin", 1_528_640],
  ["Cyproheptadine", 1_522_003],
  ["Erythromycin", 1_513_465],
  ["Dutasteride", 1_505_889],
  ["Moxifloxacin", 1_504_242],
  ["Bimatoprost", 1_491_206],
  ["Primidone", 1_488_529],
  ["Sucralfate", 1_487_376],
  ["Betamethasone; Clotrimazole", 1_470_861],
  ["Senna; Docusate", 1_440_174],
  ["Bumetanide", 1_419_204],
  ["Icosapent Ethyl", 1_378_688],
  ["Solifenacin", 1_292_098],
  ["Dexamethasone", 1_251_533],
  ["Epinephrine", 1_248_425],
  ["Penicillin V", 1_240_696],
  ["Calcitriol", 1_217_012],
  ["Oseltamivir", 1_207_283],
  ["Polymyxin B; Trimethoprim", 1_200_830],
  ["Dextromethorphan; Promethazine", 1_195_581],
  ["Terbinafine", 1_181_009],
  ["Linagliptin", 1_158_876],
  ["Methimazole", 1_128_558],
  ["Metoclopramide", 1_116_507],
  ["Medroxyprogesterone", 1_095_997],
  ["Pancrelipase", 1_076_565],
  ["Clotrimazole", 1_058_881],
  ["Dexamethasone; Neomycin; Polymyxin B", 1_049_128],
  ["Calcium Phosphate; Cholecalciferol", 1_043_667],
  ["Acetaminophen; Butalbital; Caffeine", 1_039_901],
  ["Guanfacine", 1_039_054],
  ["Sodium Fluoride", 1_037_661],
  ["Codeine; Guaifenesin", 972_224],
  ["Lactulose", 966_210],
  ["Fluorouracil", 964_215],
  ["Ipratropium", 944_080],
  ["Olopatadine", 930_171],
  ["Chlorhexidine", 912_485],
  ["Nabumetone", 869_463],
  ["Mometasone", 865_193],
  ["Hydroquinone", 835_288],
  ["Phenazopyridine", 827_433],
  ["Loperamide", 822_307],
  ["Lidocaine", 810_186],
  ["Ciclopirox", 787_556],
  ["Cefuroxime", 783_926],
  ["Betamethasone", 760_520],
  ["Ethinyl Estradiol; Norgestrel", 726_740],
  ["Ciprofloxacin; Dexamethasone", 723_485],
  ["Diphenhydramine", 707_624],
  ["Ethinyl Estradiol; Norelgestromin", 658_000],
  ["Atropine; Diphenoxylate", 614_352],
  ["Indomethacin", 593_608],
  ["Niacin", 534_979],
  ["Vitamin E", 519_661],
  ["Guaifenesin", 511_688],
  ["Pseudoephedrine", 497_307],
  ["Bisacodyl", 481_188],
  ["Riboflavin", 451_739],
  ["Ivermectin", 450_417],
  ["Etodolac", 450_221],
  ["Tobramycin", 424_144],
  ["Ketotifen", 409_520],
  ["Loratadine; Pseudoephedrine", 408_298],
];

/**
 * Normalised molecule key to annual prescriptions.
 *
 * Built through the same reduction the formulary goes through, so the two sides
 * meet without a hand-maintained crosswalk.
 */
export const DISPENSING_VOLUME: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const [name, count] of PUBLISHED) {
    const key = normalizeIngredients(name);
    // A few published rows reduce to the same key once salt and form words are
    // stripped. Summing keeps the molecule's real total rather than letting the
    // last row win.
    m.set(key, (m.get(key) ?? 0) + count);
  }
  return m;
})();

/**
 * Relative share of a molecule's volume that a given dosage form takes.
 *
 * The published counts are per molecule, not per product, so a molecule listed
 * as a tablet and an oral solution would otherwise split its volume evenly. Oral
 * solids are the overwhelming majority of what is dispensed; a liquid is
 * normally stocked for children and for patients who cannot swallow. Splitting
 * evenly put metformin oral solution and escitalopram solution among the most
 * dispensed products in the book, which no pharmacist would recognise.
 *
 * Forms that are the only way to give a drug — inhalers, injections, topicals —
 * are left at full weight, since for those products there is nothing to split
 * with.
 */
const LIQUID_FORM_SHARE = 0.12;

const LIQUID_FORMS = [
  "soln",
  "solution",
  "susp",
  "suspension",
  "syrup",
  "elixir",
  "liquid",
  "concentrate",
];

export function dosageFormShare(name: string): number {
  const lower = name.toLowerCase();
  // An inhaler or nebuliser solution is not a substitute for a tablet.
  if (/inhal|\bneb\b|nebul|\bhfa\b|respul|\bophth\b|\botic\b|\bnasal\b/.test(lower))
    return 1;
  return LIQUID_FORMS.some((f) => new RegExp(`\\b${f}\\b`).test(lower))
    ? LIQUID_FORM_SHARE
    : 1;
}

/** How often this molecule is dispensed, or the floor for the long tail. */
export function dispensingWeight(moleculeKey: string): number {
  return DISPENSING_VOLUME.get(moleculeKey) ?? UNLISTED_MOLECULE_WEIGHT;
}

/**
 * Published molecules as token sets, indexed by token for lookup.
 *
 * Exact key matching is not enough to join these two lists. A formulary
 * transcribed from a PDF names products the way a pharmacy label does —
 * "pantoprazole sod dr tab", "INSULIN GLARGINE SOLN PEN-INJ", "citalopram hbr
 * tab" — and a national statistics list names them "Pantoprazole",
 * "Insulin Glargine", "Citalopram". Requiring the reduced strings to be equal
 * left 78 of 294 published molecules matching nothing, including pantoprazole,
 * montelukast, semaglutide and insulin glargine. Those are not obscure drugs,
 * and treating them as rare is what made the generated book cheap.
 */
const TOKEN_INDEX: Map<string, Array<{ tokens: Set<string>; volume: number }>> =
  (() => {
    const index = new Map<
      string,
      Array<{ tokens: Set<string>; volume: number }>
    >();
    for (const [name, count] of PUBLISHED) {
      const tokens = ingredientTokens(name);
      if (tokens.size === 0) continue;
      const entry = { tokens, volume: count };
      for (const t of tokens) {
        const list = index.get(t);
        if (list) list.push(entry);
        else index.set(t, [entry]);
      }
    }
    return index;
  })();

/**
 * Every word the published list uses as a drug in its own right.
 *
 * This is what separates noise from a second ingredient. A product carrying a
 * word beyond the molecule being tested is either a combination product or a
 * package description, and the difference matters enormously: matching on the
 * larger ingredient alone gave metformin's 85.7 million prescriptions to
 * Janumet and hydrochlorothiazide's 31.8 million to each of six separate
 * combination tablets, which is how six niche antihypertensives came to outrank
 * amoxicillin. A word that names no known drug — "sod", "hbr", "solostar",
 * a biosimilar suffix — carries no such implication and is ignored.
 */
const INGREDIENT_VOCAB: Set<string> = (() => {
  const vocab = new Set<string>();
  for (const [name] of PUBLISHED) {
    for (const t of ingredientTokens(name)) vocab.add(t);
  }
  return vocab;
})();

/**
 * Does this word name a drug, or is it decoration on the end of one?
 *
 * The published vocabulary settles it for anything common. Beyond that, length
 * does: the leftovers on a pharmacy label are salt abbreviations and biosimilar
 * suffixes — "sod", "hbr", "u", "yfgn" — and drug names are longer than that.
 * The rule is crude and it only has to separate two populations that do not
 * overlap much.
 */
function namesAnIngredient(token: string): boolean {
  return INGREDIENT_VOCAB.has(token) || token.length > 4;
}

/** Count the distinct ingredients a product name claims. */
function ingredientCount(tokens: Set<string>): number {
  let n = 0;
  for (const t of tokens) if (namesAnIngredient(t)) n++;
  return n;
}

/**
 * Dispensing volume for a product, matched by ingredient rather than by string.
 *
 * A published molecule matches when every one of its ingredients appears in the
 * product, so "Pantoprazole" matches "pantoprazole sod dr tab" and
 * "Insulin Glargine" matches "INSULIN GLARGINE SOLN PEN-INJ". The most specific
 * match wins: amlodipine/benazepril is scored as the combination product it is
 * rather than as plain amlodipine, which would otherwise lend it the far larger
 * single-ingredient volume.
 */
export function dispensingWeightForProduct(
  name: string,
  nadacDescription: string | null,
): number {
  // The brand crosswalk first, since a brand name contains none of its own
  // ingredients and would match nothing on tokens alone.
  const key = moleculeKey(nadacDescription, name);
  const exact = DISPENSING_VOLUME.get(key);
  if (exact !== undefined) return exact;

  /*
   * Match on the molecule key rather than the product name. The key has already
   * had the brand crosswalk and the salt words applied, so it carries the
   * ingredients and nothing else. Tokenising the raw name instead let the brand
   * word count as an ingredient of its own — "LANTUS INJ insulin glargine"
   * reads as three ingredients, one more than "Insulin Glargine", and the
   * combination guard below then threw the match away.
   */
  const tokens = ingredientTokens(key.replace(/-/g, " "));
  if (tokens.size === 0) return UNLISTED_MOLECULE_WEIGHT;

  let best: { size: number; volume: number } | null = null;
  const considered = new Set<Set<string>>();
  for (const t of tokens) {
    for (const candidate of TOKEN_INDEX.get(t) ?? []) {
      if (considered.has(candidate.tokens)) continue;
      considered.add(candidate.tokens);

      let contained = true;
      for (const ct of candidate.tokens) {
        if (!tokens.has(ct)) {
          contained = false;
          break;
        }
      }
      if (!contained) continue;

      /*
       * Reject the match if the product carries an ingredient the published
       * molecule does not. A combination tablet is its own product with its own
       * utilisation, and lending it a single ingredient's national volume is how
       * six niche antihypertensives came to outrank amoxicillin: each
       * "something/hydrochlorothiazide" tablet had claimed
       * hydrochlorothiazide's 31.8 million prescriptions for itself.
       */
      if (ingredientCount(tokens) !== candidate.tokens.size) continue;

      if (
        best === null ||
        candidate.tokens.size > best.size ||
        (candidate.tokens.size === best.size && candidate.volume > best.volume)
      ) {
        best = { size: candidate.tokens.size, volume: candidate.volume };
      }
    }
  }
  return best?.volume ?? UNLISTED_MOLECULE_WEIGHT;
}
