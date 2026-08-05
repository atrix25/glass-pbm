/**
 * The drug interaction rule set.
 *
 * A word on what this is and is not. Commercial adjudication screens against a
 * licensed clinical database — First Databank or Medi-Span — which carries
 * hundreds of thousands of pairs maintained by a clinical staff. That is a
 * genuine asset and this is not a substitute for it.
 *
 * What this is: a hand-encoded set of the interactions that actually matter in
 * a commercial book, every one of them traceable to FDA labelling or a safety
 * communication rather than to anybody's judgement here. The point being made
 * is not that a licensed database is easy to replicate. It is that the
 * machinery around it — screening every fill against a member's active
 * therapy, scoring severity, returning a conflict code the pharmacy can act
 * on — is a join and a rule table, and the rule table is the only part anyone
 * is charging for.
 */

export interface DrugMatcher {
  label: string;
  /** Medi-Span therapeutic classes, as they appear in the formulary. */
  classes?: string[];
  /** Molecule names, matched against the drug name. */
  molecules?: string[];
}

export interface InteractionRule {
  id: string;
  a: DrugMatcher;
  b: DrugMatcher;
  /** NCPDP DUR severity index: 1 major, 2 moderate, 3 minor. */
  severityIndex: "1" | "2" | "3";
  severity: "Major" | "Moderate" | "Minor";
  /** What happens to the patient. */
  effect: string;
  /** Why it happens. */
  mechanism: string;
  /** The published basis for the rule. */
  citation: string;
}

const OPIOIDS: DrugMatcher = {
  label: "Opioid analgesic",
  classes: ["ANALGESICS - OPIOID"],
};

const BENZODIAZEPINES: DrugMatcher = {
  label: "Benzodiazepine",
  molecules: [
    "alprazolam",
    "lorazepam",
    "clonazepam",
    "diazepam",
    "temazepam",
    "chlordiazepoxide",
    "oxazepam",
    "clorazepate",
  ],
};

const Z_DRUGS: DrugMatcher = {
  label: "Sedative hypnotic",
  molecules: ["zolpidem", "eszopiclone", "zaleplon"],
};

const SSRI_SNRI: DrugMatcher = {
  label: "SSRI or SNRI antidepressant",
  molecules: [
    "sertraline",
    "fluoxetine",
    "escitalopram",
    "citalopram",
    "paroxetine",
    "fluvoxamine",
    "venlafaxine",
    "desvenlafaxine",
    "duloxetine",
  ],
};

const TRIPTANS: DrugMatcher = {
  label: "Triptan",
  molecules: [
    "sumatriptan",
    "rizatriptan",
    "zolmitriptan",
    "naratriptan",
    "eletriptan",
    "frovatriptan",
    "almotriptan",
  ],
};

const NSAIDS: DrugMatcher = {
  label: "NSAID",
  molecules: [
    "ibuprofen",
    "naproxen",
    "diclofenac",
    "meloxicam",
    "indomethacin",
    "etodolac",
    "nabumetone",
    "piroxicam",
    "ketorolac",
    "celecoxib",
    "sulindac",
  ],
};

const CYP3A4_STATINS: DrugMatcher = {
  label: "Simvastatin or lovastatin",
  molecules: ["simvastatin", "lovastatin"],
};

const AZOLE_ANTIFUNGALS: DrugMatcher = {
  label: "Azole antifungal",
  molecules: ["itraconazole", "ketoconazole", "posaconazole", "voriconazole"],
};

const MACROLIDES: DrugMatcher = {
  label: "Macrolide antibiotic",
  molecules: ["clarithromycin", "erythromycin"],
};

const RAAS: DrugMatcher = {
  label: "ACE inhibitor or ARB",
  molecules: [
    "lisinopril",
    "enalapril",
    "ramipril",
    "benazepril",
    "quinapril",
    "losartan",
    "valsartan",
    "olmesartan",
    "irbesartan",
    "candesartan",
  ],
};

const POTASSIUM_SPARING: DrugMatcher = {
  label: "Potassium-sparing diuretic",
  molecules: ["spironolactone", "triamterene", "amiloride", "eplerenone"],
};

const WARFARIN: DrugMatcher = { label: "Warfarin", molecules: ["warfarin"] };
const LINEZOLID: DrugMatcher = { label: "Linezolid", molecules: ["linezolid"] };
const METHOTREXATE: DrugMatcher = {
  label: "Methotrexate",
  molecules: ["methotrexate"],
};
const TRAMADOL: DrugMatcher = { label: "Tramadol", molecules: ["tramadol"] };

export const INTERACTION_RULES: InteractionRule[] = [
  {
    id: "ddi.opioid-benzodiazepine",
    a: OPIOIDS,
    b: BENZODIAZEPINES,
    severityIndex: "1",
    severity: "Major",
    effect:
      "Profound sedation, respiratory depression, coma and death. Both classes carry a boxed warning naming the other.",
    mechanism: "Additive central nervous system and respiratory depression.",
    citation:
      "FDA Drug Safety Communication, 31 August 2016: boxed warnings added to opioid analgesics and benzodiazepines about the risks of combined use.",
  },
  {
    id: "ddi.opioid-hypnotic",
    a: OPIOIDS,
    b: Z_DRUGS,
    severityIndex: "1",
    severity: "Major",
    effect: "Additive sedation and respiratory depression.",
    mechanism: "Both agents depress the central nervous system.",
    citation:
      "FDA Drug Safety Communication, 31 August 2016, extending the combined-use warning to other CNS depressants.",
  },
  {
    id: "ddi.benzodiazepine-hypnotic",
    a: BENZODIAZEPINES,
    b: Z_DRUGS,
    severityIndex: "2",
    severity: "Moderate",
    effect:
      "Excess sedation, impaired psychomotor performance, and next-day impairment.",
    mechanism: "Additive GABA-ergic central nervous system depression.",
    citation:
      "Zolpidem prescribing information, Warnings and Precautions: use with other CNS depressants.",
  },
  {
    id: "ddi.warfarin-nsaid",
    a: WARFARIN,
    b: NSAIDS,
    severityIndex: "1",
    severity: "Major",
    effect: "Serious gastrointestinal bleeding.",
    mechanism:
      "NSAIDs inhibit platelet aggregation and injure gastric mucosa on top of anticoagulation.",
    citation:
      "Warfarin sodium prescribing information, Boxed Warning and Drug Interactions: NSAIDs increase bleeding risk.",
  },
  {
    id: "ddi.warfarin-ssri",
    a: WARFARIN,
    b: SSRI_SNRI,
    severityIndex: "1",
    severity: "Major",
    effect: "Increased bleeding risk, with or without a change in INR.",
    mechanism:
      "Serotonin reuptake inhibition depletes platelet serotonin and impairs aggregation.",
    citation:
      "Warfarin sodium prescribing information, Drug Interactions: CYP2C9 inhibitors and agents affecting haemostasis.",
  },
  {
    id: "ddi.serotonergic-triptan",
    a: SSRI_SNRI,
    b: TRIPTANS,
    severityIndex: "2",
    severity: "Moderate",
    effect:
      "Serotonin syndrome: agitation, hyperthermia, rapid changes in blood pressure.",
    mechanism: "Additive serotonergic activity.",
    citation:
      "FDA Public Health Advisory, 19 July 2006: combined use of triptans with SSRIs or SNRIs.",
  },
  {
    id: "ddi.statin-azole",
    a: CYP3A4_STATINS,
    b: AZOLE_ANTIFUNGALS,
    severityIndex: "1",
    severity: "Major",
    effect: "Myopathy and rhabdomyolysis. The combination is contraindicated.",
    mechanism:
      "Strong CYP3A4 inhibition raises statin exposure several fold.",
    citation:
      "Simvastatin prescribing information, Contraindications: strong CYP3A4 inhibitors including itraconazole and ketoconazole.",
  },
  {
    id: "ddi.statin-macrolide",
    a: CYP3A4_STATINS,
    b: MACROLIDES,
    severityIndex: "1",
    severity: "Major",
    effect: "Myopathy and rhabdomyolysis. The combination is contraindicated.",
    mechanism: "Strong CYP3A4 inhibition raises statin exposure several fold.",
    citation:
      "Simvastatin prescribing information, Contraindications: clarithromycin and erythromycin.",
  },
  {
    id: "ddi.raas-potassium-sparing",
    a: RAAS,
    b: POTASSIUM_SPARING,
    severityIndex: "2",
    severity: "Moderate",
    effect: "Hyperkalaemia, which can be severe and is often asymptomatic.",
    mechanism:
      "Both agents reduce potassium excretion; the effect is additive.",
    citation:
      "Lisinopril prescribing information, Drug Interactions: agents increasing serum potassium.",
  },
  {
    id: "ddi.linezolid-serotonergic",
    a: LINEZOLID,
    b: SSRI_SNRI,
    severityIndex: "1",
    severity: "Major",
    effect: "Serotonin syndrome.",
    mechanism:
      "Linezolid is a reversible non-selective monoamine oxidase inhibitor.",
    citation:
      "Linezolid prescribing information, Warnings and Precautions: serotonin syndrome with serotonergic agents.",
  },
  {
    id: "ddi.methotrexate-nsaid",
    a: METHOTREXATE,
    b: NSAIDS,
    severityIndex: "1",
    severity: "Major",
    effect:
      "Methotrexate toxicity: myelosuppression, hepatotoxicity, renal impairment.",
    mechanism: "NSAIDs reduce renal clearance of methotrexate.",
    citation:
      "Methotrexate prescribing information, Boxed Warning and Drug Interactions: NSAIDs.",
  },
  {
    id: "ddi.tramadol-serotonergic",
    a: TRAMADOL,
    b: SSRI_SNRI,
    severityIndex: "2",
    severity: "Moderate",
    effect: "Serotonin syndrome and a lowered seizure threshold.",
    mechanism:
      "Tramadol inhibits serotonin and noradrenaline reuptake in addition to its opioid activity.",
    citation:
      "Tramadol prescribing information, Warnings and Precautions: serotonin syndrome and seizure risk.",
  },
];

/**
 * Renders a matcher as a SQL predicate over an aliased Drug row.
 *
 * Molecule matching is on the drug name rather than an ingredient field
 * because the formulary was transcribed from a PDF that names products, not
 * ingredients. It is the weakest link in the chain and worth saying so.
 */
export function matcherSql(m: DrugMatcher, alias: string): string {
  const parts: string[] = [];
  if (m.classes?.length) {
    const list = m.classes.map((c) => `'${c.replace(/'/g, "''")}'`).join(",");
    parts.push(`${alias}.therapeuticClass IN (${list})`);
  }
  if (m.molecules?.length) {
    const likes = m.molecules
      .map((x) => `LOWER(${alias}.name) LIKE '%${x.replace(/'/g, "''")}%'`)
      .join(" OR ");
    parts.push(`(${likes})`);
  }
  return parts.length > 1 ? `(${parts.join(" OR ")})` : (parts[0] ?? "0");
}

/**
 * The same test as matcherSql, in memory.
 *
 * Retrospective screening runs in SQL over the whole book; prospective
 * screening runs on one fill inside the adjudication path, where there is no
 * query to push a predicate into. Both have to agree, so they are written
 * against the same matcher and kept next to each other.
 */
export function matchesDrug(
  m: DrugMatcher,
  drug: { name: string; therapeuticClass?: string | null },
): boolean {
  if (m.classes?.length && drug.therapeuticClass) {
    if (m.classes.includes(drug.therapeuticClass)) return true;
  }
  if (m.molecules?.length) {
    const name = drug.name.toLowerCase();
    if (m.molecules.some((x) => name.includes(x))) return true;
  }
  return false;
}

/** Therapeutic classes treated as controlled substances for surveillance. */
export const CONTROLLED_CLASSES = [
  "ANALGESICS - OPIOID",
  "ANTIANXIETY AGENTS",
  "HYPNOTICS/SEDATIVES/SLEEP DISORDER AGENTS",
  "ADHD/ANTI-NARCOLEPSY/ANTI-OBESITY/A NOREXIANTS",
];
