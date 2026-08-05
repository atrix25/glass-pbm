/**
 * The facts a criteria tree needs, and the language a prescriber uses to say
 * them.
 *
 * A prior authorisation form asks six or seven questions. A chart note answers
 * them, in prose, in whatever order the prescriber wrote it, mixed in with
 * blood pressure readings and unrelated medications. This file is the bridge:
 * for each field a tree reads, the phrasings a note might use to establish it,
 * and the cues an extractor can recognise.
 *
 * Both the note generator and the extraction agent import this, which is
 * deliberate but not circular. The generator picks a phrasing; the extractor
 * matches cues. Some phrasings have no matching cue, and those are the requests
 * that escalate to a pharmacist — which is the honest behaviour, and the
 * reason the accuracy figure on the operations page is not 100%.
 */

export type FieldType = "boolean" | "multi" | "condition" | "specialty";

export interface FieldValue {
  value: string | boolean;
  /** How the note might say it. The generator picks one. */
  says: string[];
  /**
   * Phrasings that only make sense for a given indication. A note that names
   * an asthma ICD-10 code while requesting therapy for COPD is not a hard
   * extraction problem, it is an incoherent document.
   */
  saysFor?: Record<string, string[]>;
  /** How a hurried prescriber might say it. No cue matches these. */
  saysObliquely?: string[];
  /** What the extractor recognises. */
  cues: RegExp[];
}

export interface NoteField {
  key: string;
  /** What the criteria form calls it. */
  label: string;
  type: FieldType;
  /** The step on the published form that reads this field. */
  step: number;
  values: FieldValue[];
}

// ---------------------------------------------------------------------------
// Shared: prescriber specialty. Read off the letterhead in practice, which is
// why it is the field the extractor is most confident about.
// ---------------------------------------------------------------------------

const SPECIALTY: NoteField = {
  key: "__specialty",
  label: "Prescriber specialty",
  type: "specialty",
  step: 5,
  values: [
    {
      value: "Dermatology",
      says: ["Dermatology"],
      cues: [/\bdermatolog(y|ist)\b/i, /\bMD,?\s*FAAD\b/],
    },
    {
      value: "Internal Medicine",
      says: ["Internal Medicine"],
      cues: [/\binternal medicine\b/i, /\bprimary care\b/i],
    },
    {
      value: "Rheumatology",
      says: ["Rheumatology"],
      cues: [/\brheumatolog(y|ist)\b/i],
    },
    {
      value: "Gastroenterology",
      says: ["Gastroenterology"],
      cues: [/\bgastroenterolog(y|ist)\b/i],
    },
    {
      value: "Allergy and Immunology",
      says: ["Allergy and Immunology"],
      cues: [/\ballergy (and|&) immunolog/i, /\ballergist\b/i],
    },
    {
      value: "Pulmonology",
      says: ["Pulmonology"],
      cues: [/\bpulmonolog(y|ist)\b/i],
    },
  ],
};

// ---------------------------------------------------------------------------
// Skyrizi
// ---------------------------------------------------------------------------

const SKYRIZI_CONDITION: NoteField = {
  key: "__condition",
  label: "Indication",
  type: "condition",
  step: 4,
  values: [
    {
      value: "plaque-psoriasis-initial",
      says: [
        "Requesting initial therapy for plaque psoriasis.",
        "This is a request to start risankizumab for plaque psoriasis; the patient is biologic-naive.",
        "Indication: plaque psoriasis, initial therapy.",
      ],
      saysObliquely: [
        "We would like to get her started on this for her skin.",
      ],
      cues: [
        /initial (therapy|treatment)[^.]{0,40}plaque psoriasis/i,
        /plaque psoriasis[^.]{0,40}initial (therapy|treatment)/i,
        /(start|initiat\w+|begin)[^.]{0,60}(for|to treat)[^.]{0,30}plaque psoriasis/i,
        /biologic[- ]naive/i,
      ],
    },
    {
      value: "plaque-psoriasis-continuing",
      says: [
        "Requesting continuation of therapy for plaque psoriasis.",
        "This is a renewal request; the patient has been on risankizumab since last year for plaque psoriasis.",
      ],
      cues: [
        /continu(ing|ation)[^.]{0,40}(therapy|treatment)/i,
        /\brenewal request\b/i,
        /has been on (risankizumab|Skyrizi)/i,
      ],
    },
    {
      value: "psoriatic-arthritis",
      says: [
        "Indication: psoriatic arthritis.",
        "Requesting therapy for psoriatic arthritis with peripheral joint involvement.",
      ],
      cues: [/psoriatic arthritis/i, /\bPsA\b/],
    },
  ],
};

const DIAGNOSIS_CRITERIA: NoteField = {
  key: "diagnosisCriteria",
  label: "Qualifying diagnosis",
  type: "multi",
  step: 6,
  values: [
    {
      value: "moderate-severe-pso-10pct-bsa",
      says: [
        "Current body surface area involvement is approximately 14%, with significant functional impairment.",
        "BSA is 18% today. She reports the disease materially limits her ability to work.",
        "Examination shows moderate to severe plaque psoriasis involving roughly 22% BSA with associated functional disability.",
        "BSA 12%; DLQI 19, consistent with a very large effect on daily activity.",
      ],
      saysObliquely: [
        "Extensive disease across the trunk and both limbs, worse than at the last visit.",
      ],
      cues: [
        /\bBSA\b[^.]{0,30}?(\d{2})\s?%/i,
        /body surface (area )?(involvement )?(is )?(approximately |roughly |about )?(\d{2})\s?%/i,
        /(\d{2})\s?%\s+(of )?(the )?body surface/i,
        /moderate to severe plaque psoriasis/i,
        /\bDLQI\s*(of\s*)?1[1-9]|\bDLQI\s*(of\s*)?2\d/i,
      ],
    },
    {
      value: "debilitating-palmoplantar-psoriasis",
      says: [
        "Disease is confined largely to the palms and soles and is debilitating; she cannot grip tools at work.",
        "Debilitating palmoplantar psoriasis with painful fissuring of both palms.",
      ],
      cues: [
        /palmoplantar/i,
        /palms and soles/i,
      ],
    },
    {
      value: "__none",
      says: [
        "BSA involvement is approximately 4%, limited to both elbows.",
        "Disease is mild, involving under 5% BSA, and is cosmetically bothersome.",
      ],
      cues: [],
    },
  ],
};

const PHOTOTHERAPY_TRIAL: NoteField = {
  key: "phototherapyTrial",
  label: "Trial of phototherapy, methotrexate or acitretin",
  type: "boolean",
  step: 7,
  values: [
    {
      value: true,
      says: [
        "She completed 18 sessions of narrowband UVB phototherapy between June and September without adequate response.",
        "Patient underwent 22 sessions of nbUVB phototherapy last year; response was inadequate and she discontinued.",
        "Methotrexate 20 mg weekly was trialled for four months and was not tolerated due to transaminitis.",
        "Prior trial of acitretin 25 mg daily, discontinued for mucocutaneous side effects.",
        "He failed a documented course of methotrexate at 15 mg weekly.",
      ],
      saysObliquely: [
        "We have already been through the usual conventional options with her without success.",
      ],
      cues: [
        /(\d{2})\s+sessions of (narrowband |nb)?UVB/i,
        /(\d{2})\s+sessions of phototherapy/i,
        /phototherapy[^.]{0,60}(inadequate|without adequate|failed|no response)/i,
        /methotrexate[^.]{0,80}(trial|failed|not tolerated|discontinued|intoleran)/i,
        /(trial|failed|not tolerated|discontinued)[^.]{0,60}methotrexate/i,
        /acitretin[^.]{0,80}(trial|failed|not tolerated|discontinued)/i,
      ],
    },
    {
      value: false,
      says: [
        "She has not had phototherapy, methotrexate or acitretin.",
        "No prior systemic therapy or phototherapy has been attempted.",
      ],
      cues: [
        /has not had[^.]{0,60}(phototherapy|methotrexate|acitretin)/i,
        /no prior (systemic therapy|phototherapy)/i,
      ],
    },
  ],
};

const ALL_CONTRAINDICATED: NoteField = {
  key: "allAlternativesContraindicated",
  label: "All conventional alternatives contraindicated",
  type: "boolean",
  step: 8,
  values: [
    {
      value: true,
      says: [
        "Phototherapy, methotrexate and acitretin are all contraindicated in this patient.",
        "All three conventional options are contraindicated here.",
      ],
      cues: [
        /all (three )?(of these |conventional )?(options |alternatives )?are contraindicated/i,
        /(phototherapy|methotrexate)[^.]{0,80}all contraindicated/i,
        /are all contraindicated/i,
      ],
    },
    {
      value: false,
      says: [
        "There is no contraindication to the conventional options; the patient declined them.",
      ],
      cues: [/no contraindication/i, /patient declined/i],
    },
  ],
};

const CONTRAINDICATIONS_LISTED: NoteField = {
  key: "contraindicationsListed",
  label: "Contraindications documented",
  type: "boolean",
  step: 9,
  values: [
    {
      value: true,
      says: [
        "Specifically: methotrexate is contraindicated by biopsy-proven hepatic fibrosis, acitretin by a documented plan to conceive, and phototherapy by a history of melanoma in situ.",
        "Contraindications are as follows: chronic hepatitis C with elevated transaminases precludes methotrexate; hypertriglyceridaemia above 800 precludes acitretin; and prior non-melanoma skin cancer precludes phototherapy.",
      ],
      cues: [
        /contraindications? (are as follows|are listed|include)/i,
        /specifically[:,][^.]{0,120}contraindicat/i,
        /precludes? (methotrexate|acitretin|phototherapy)/i,
      ],
    },
    {
      value: false,
      says: [
        "Contraindications will be forwarded under separate cover.",
        "Documentation of the contraindications is available on request.",
      ],
      cues: [
        /under separate cover/i,
        /available on request/i,
        /will be forwarded/i,
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Dupixent
// ---------------------------------------------------------------------------

const DUPIXENT_CONDITION: NoteField = {
  key: "__condition",
  label: "Indication",
  type: "condition",
  step: 4,
  values: [
    {
      value: "atopic-dermatitis-initial",
      says: [
        "Indication: moderate to severe atopic dermatitis, initial therapy.",
        "Requesting initiation of dupilumab for atopic dermatitis.",
        "This is a new start for atopic dermatitis (L20.9).",
      ],
      saysObliquely: ["Requesting dupilumab for her eczema."],
      cues: [
        /atopic dermatitis[^.]{0,40}(initial|new start)/i,
        /(initial|initiation|new start)[^.]{0,60}atopic dermatitis/i,
        /\bL20\.?\d?\b/,
      ],
    },
    {
      value: "asthma-initial",
      says: [
        "Indication: severe eosinophilic asthma, initial therapy.",
        "Requesting dupilumab for uncontrolled asthma despite maximal inhaled therapy.",
      ],
      cues: [/\basthma\b/i, /\bJ45\.?\d?\b/],
    },
    {
      value: "crswnp-initial",
      says: [
        "Indication: chronic rhinosinusitis with nasal polyps.",
        "Requesting dupilumab for CRSwNP following two prior polypectomies.",
      ],
      cues: [/\bCRSwNP\b/i, /nasal polyp/i],
    },
    {
      value: "copd-initial",
      says: [
        "Indication: COPD with an eosinophilic phenotype, initial therapy.",
        "Requesting dupilumab as add-on maintenance for COPD despite triple inhaled therapy.",
      ],
      cues: [/\bCOPD\b/, /\bJ44\.?\d?\b/],
    },
  ],
};

const QUANTITY_BASIS_DUPIXENT: NoteField = {
  key: "quantityLimitBasis",
  label: "Quantity limit basis",
  type: "multi",
  step: 1,
  values: [
    {
      value: "maintenance-ad-asthma",
      says: [
        "SIG: 300 mg subcutaneously every 14 days following the loading dose. Two pens per 28 days.",
        "Dosing: 300 mg SC every other week, maintenance. Quantity requested is two syringes per 28 days.",
      ],
      cues: [
        /two (pens|syringes|injections) per 28 days/i,
        /300\s?mg[^.]{0,40}every (other week|14 days|2 weeks)/i,
      ],
    },
    {
      value: "loading-dose-ad-asthma",
      says: [
        "Loading dose requested: 600 mg subcutaneously on day one, given as two 300 mg injections.",
        "Requesting the loading dose, two injections within the first 14 days.",
      ],
      cues: [
        /loading dose/i,
        /600\s?mg[^.]{0,30}(day one|initial|load)/i,
      ],
    },
    {
      value: "crswnp-copd-2-inj-28d",
      says: [
        "Dosing for CRSwNP: 300 mg every 14 days, two injections per 28 days.",
      ],
      cues: [/CRSwNP[^.]{0,60}two injections/i],
    },
    {
      value: "__none",
      says: ["Dose to be determined at the next visit."],
      cues: [],
    },
  ],
};

const QUANTITY_DOSING_PROVIDED: NoteField = {
  key: "quantityDosingProvided",
  label: "Quantity and dosing supplied",
  type: "boolean",
  step: 2,
  values: [
    {
      value: true,
      says: [
        "Quantity requested: 2 pens per 28 days, 3 refills.",
        "Requested quantity is 2 syringes for a 28 day supply.",
      ],
      cues: [
        /quantity (requested|is)[^.]{0,40}\d/i,
        /\d\s+(pens|syringes)[^.]{0,30}\d{2} day/i,
      ],
    },
    {
      value: false,
      says: ["Quantity per the package insert."],
      cues: [],
    },
  ],
};

const DIAGNOSIS_PROVIDED: NoteField = {
  key: "diagnosisProvided",
  label: "Primary diagnosis with ICD-10",
  type: "boolean",
  step: 3,
  values: [
    {
      value: true,
      says: ["Primary diagnosis: L20.89, other atopic dermatitis."],
      saysFor: {
        "atopic-dermatitis-initial": [
          "Primary diagnosis: L20.89, other atopic dermatitis.",
          "Diagnosis: atopic dermatitis, ICD-10 L20.9.",
        ],
        "asthma-initial": [
          "Primary diagnosis J45.50, severe persistent asthma, uncomplicated.",
          "Diagnosis: severe eosinophilic asthma, ICD-10 J45.51.",
        ],
        "crswnp-initial": [
          "Primary diagnosis J33.1, chronic rhinosinusitis with nasal polyps.",
        ],
        "copd-initial": [
          "Primary diagnosis J44.1, chronic obstructive pulmonary disease with acute exacerbation.",
          "Diagnosis: COPD, ICD-10 J44.9, eosinophilic phenotype.",
        ],
      },
      cues: [
        /(primary )?diagnosis[^.]{0,40}\b[A-Z]\d{2}(\.\d+)?\b/i,
        /ICD-?10[^.]{0,20}\b[A-Z]\d{2}(\.\d+)?\b/i,
      ],
    },
    {
      value: false,
      says: ["Diagnosis as previously submitted."],
      cues: [],
    },
  ],
};

const TOPICAL_TRIAL: NoteField = {
  key: "topicalTrialDocumented",
  label: "Trial of topical corticosteroid or calcineurin inhibitor",
  type: "boolean",
  step: 6,
  values: [
    {
      value: true,
      says: [
        "She has used triamcinolone 0.1% ointment twice daily for eight weeks with inadequate control.",
        "Trial of clobetasol 0.05% for six weeks, then tacrolimus 0.1% ointment for a further eight weeks, both ineffective.",
        "Mometasone was ineffective, and pimecrolimus caused intolerable burning.",
        "Failed medium potency topical steroids, including betamethasone valerate.",
      ],
      saysObliquely: [
        "Topicals have not held her disease, as documented in the chart over the past year.",
      ],
      cues: [
        /(triamcinolone|clobetasol|fluocinonide|betamethasone|mometasone|tacrolimus|pimecrolimus)/i,
        /topical (cortico)?steroid[^.]{0,60}(inadequate|ineffective|failed|not tolerated)/i,
        /failed[^.]{0,40}topical/i,
      ],
    },
    {
      value: false,
      says: [
        "No topical therapy has been tried; the patient prefers to start systemic treatment.",
      ],
      cues: [/no topical (therapy|treatment)/i],
    },
  ],
};

// ---------------------------------------------------------------------------
// Adalimumab
// ---------------------------------------------------------------------------

const QUANTITY_BASIS_ADA: NoteField = {
  key: "quantityLimitBasis",
  label: "Quantity limit basis",
  type: "multi",
  step: 1,
  values: [
    {
      value: "standard-2-inj-28-days",
      says: [
        "SIG: 40 mg subcutaneously every other week. Two pens per 28 days.",
        "Dosing is 40 mg every 14 days, standard maintenance, two injections per 28 days.",
      ],
      cues: [
        /40\s?mg[^.]{0,40}every (other week|14 days|2 weeks)/i,
        /two (pens|injections|syringes) per 28 days/i,
        /standard maintenance/i,
      ],
    },
    {
      value: "loading-dose",
      says: [
        "Loading dose requested: 160 mg on day one, 80 mg on day 15.",
      ],
      cues: [/loading dose/i, /160\s?mg/i],
    },
    {
      value: "hs-weekly",
      says: [
        "Hidradenitis suppurativa: 40 mg weekly after loading, four pens per 28 days.",
      ],
      cues: [/hidradenitis/i, /40\s?mg weekly/i],
    },
    { value: "__none", says: ["Dosing per specialist recommendation."], cues: [] },
  ],
};

const PREFERRED_BIOSIMILAR: NoteField = {
  key: "preferredBiosimilarOrFailure",
  label: "Preferred biosimilar, or failure of one",
  type: "boolean",
  step: 4,
  values: [
    {
      value: true,
      says: [
        "The requested product is the plan's preferred adalimumab biosimilar.",
        "Patient was switched to the preferred biosimilar in March and lost response after four months; requesting the reference product.",
        "We are prescribing the preferred biosimilar as listed on the formulary.",
      ],
      cues: [
        /preferred (adalimumab )?biosimilar/i,
        /lost response[^.]{0,60}biosimilar/i,
      ],
    },
    {
      value: false,
      says: [
        "Patient and I would prefer to remain on the reference product; no biosimilar has been tried.",
      ],
      cues: [/no biosimilar has been tried/i, /remain on the reference product/i],
    },
  ],
};

const CONVENTIONAL_TRIAL: NoteField = {
  key: "conventionalTherapyTrial",
  label: "Trial of conventional therapy",
  type: "boolean",
  step: 5,
  values: [
    {
      value: true,
      says: [
        "Methotrexate 20 mg weekly for five months produced no meaningful improvement in joint counts.",
        "Trial of sulfasalazine 2 g daily and then leflunomide 20 mg daily, both inadequate.",
        "Mesalamine 4.8 g daily failed to induce remission; budesonide was used as a bridge.",
        "Hydroxychloroquine and methotrexate have both been tried without response.",
      ],
      saysObliquely: [
        "Conventional DMARDs have been exhausted, as discussed at the last visit.",
      ],
      cues: [
        /(methotrexate|sulfasalazine|leflunomide|hydroxychloroquine|azathioprine|mesalamine|budesonide|acitretin)/i,
      ],
    },
    {
      value: false,
      says: [
        "No conventional therapy has been used; the patient wishes to start a biologic directly.",
      ],
      cues: [/no conventional therapy/i],
    },
  ],
};

// ---------------------------------------------------------------------------

export const FIELDS_BY_TREE: Record<string, NoteField[]> = {
  "pa-skyrizi-sc": [
    SKYRIZI_CONDITION,
    SPECIALTY,
    DIAGNOSIS_CRITERIA,
    PHOTOTHERAPY_TRIAL,
    ALL_CONTRAINDICATED,
    CONTRAINDICATIONS_LISTED,
  ],
  "pa-dupixent": [
    DUPIXENT_CONDITION,
    SPECIALTY,
    QUANTITY_BASIS_DUPIXENT,
    QUANTITY_DOSING_PROVIDED,
    DIAGNOSIS_PROVIDED,
    TOPICAL_TRIAL,
  ],
  "pa-adalimumab": [
    SPECIALTY,
    QUANTITY_BASIS_ADA,
    QUANTITY_DOSING_PROVIDED,
    PREFERRED_BIOSIMILAR,
    CONVENTIONAL_TRIAL,
  ],
};

export function fieldsFor(treeId: string): NoteField[] {
  return FIELDS_BY_TREE[treeId] ?? [];
}
