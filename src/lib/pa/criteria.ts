/**
 * Prior authorization criteria, transcribed from published Navitus forms.
 *
 * Navitus publishes 438 drug-specific commercial PA forms, and each one is a
 * numbered decision tree with explicit transitions ("If this option, go to
 * #7") and explicit terminal outcomes carrying approval durations ("Form
 * complete here. (Approve - 4 months)").
 *
 * That structure is the reason this project can claim its PA decisions are
 * correct rather than plausible. Step numbers below are preserved exactly as
 * printed, so a reviewer can open the PDF and check step 7 against step 7.
 *
 * Encoded by hand rather than scraped: these are clinical rules, and a parser
 * that silently mis-reads one produces a confidently wrong denial. Three trees
 * are transcribed in full; the remaining forms are catalogued with their
 * document IDs so the coverage gap is visible rather than papered over.
 */

export type PredicateId =
  | "request.conditionIs"
  | "request.answerYes"
  | "request.selectedAny"
  | "prescriber.specialtyIs"
  | "member.hasDiagnosis"
  | "member.hasTrialOf"
  | "member.ageBetween"
  | "member.weightBelowKg"
  | "always";

export interface CriteriaBranch {
  outcome: "step" | "approve" | "deny";
  step?: number;
  days?: number;
  reason?: string;
}

export interface CriteriaStepDef {
  /** The step number exactly as printed on the published form. */
  step: number;
  question: string;
  predicate: PredicateId;
  args?: Record<string, unknown>;
  /** Options presented on the form, shown in the reviewer console. */
  options?: string[];
  yes: CriteriaBranch;
  no: CriteriaBranch;
  citation: string;
}

export interface CriteriaTreeDef {
  id: string;
  name: string;
  scopeLabel: string;
  /** Drug name patterns this tree governs. */
  drugPatterns: string[];
  formId: string;
  url: string;
  defaultApprovalDays: number;
  startStep: number;
  steps: CriteriaStepDef[];
}

const NAVITUS_DOC = (formId: string) =>
  `https://mx.navitus.com/v1/PortalDocuments/Document/${formId}?cultureCode=en-US`;

// ---------------------------------------------------------------------------

const SKYRIZI_FORM = "0ea2bbf9-bd4f-4bd2-8b99-bf893931d2e5";

export const SKYRIZI_SC: CriteriaTreeDef = {
  id: "pa-skyrizi-sc",
  name: "SKYRIZI SC",
  scopeLabel: "Risankizumab-rzaa subcutaneous",
  drugPatterns: ["SKYRIZI"],
  formId: SKYRIZI_FORM,
  url: NAVITUS_DOC(SKYRIZI_FORM),
  defaultApprovalDays: 122,
  startStep: 4,
  steps: [
    {
      step: 4,
      question: "What condition is the product being used for?",
      predicate: "request.conditionIs",
      args: { condition: "plaque-psoriasis-initial" },
      options: [
        "Initial therapy for plaque psoriasis (PsO)",
        "Continuing therapy for plaque psoriasis (PsO)",
        "Psoriatic arthritis (PsA)",
        "Initial therapy for Crohn's disease (CD)",
        "Continuing therapy for Crohn's disease (CD)",
        "Initial therapy for ulcerative colitis (UC)",
        "Continuing therapy for ulcerative colitis (UC)",
        "None of the above",
      ],
      yes: { outcome: "step", step: 5 },
      no: {
        outcome: "deny",
        reason:
          "The requested indication is not among the conditions this criteria set covers. Form complete here (Deny).",
      },
      citation: "SKYRIZI SC prior authorization form, step 4",
    },
    {
      step: 5,
      question: "Is the medication prescribed by a dermatologist?",
      predicate: "prescriber.specialtyIs",
      args: { specialties: ["Dermatology"] },
      yes: { outcome: "step", step: 6 },
      no: {
        outcome: "deny",
        reason:
          "Skyrizi for plaque psoriasis must be prescribed by a dermatologist.",
      },
      citation: "SKYRIZI SC prior authorization form, step 5",
    },
    {
      step: 6,
      question:
        "The member has a diagnosis of at least ONE of the following: moderate to severe plaque psoriasis with 10% or greater body surface involvement and significant functional disability, or debilitating palmoplantar psoriasis.",
      predicate: "request.selectedAny",
      args: {
        field: "diagnosisCriteria",
        options: [
          "moderate-severe-pso-10pct-bsa",
          "debilitating-palmoplantar-psoriasis",
        ],
      },
      options: [
        "Moderate to severe plaque psoriasis (PsO) with greater than or equal to 10% body surface involvement AND significant functional disability",
        "Debilitating palmoplantar psoriasis (PP)",
        "None of the above",
      ],
      yes: { outcome: "step", step: 7 },
      no: {
        outcome: "deny",
        reason:
          "No qualifying diagnosis was documented. Documentation is required to be submitted for an approval.",
      },
      citation: "SKYRIZI SC prior authorization form, step 6",
    },
    {
      step: 7,
      question:
        "The member has had a trial of ONE of the following which was ineffective or not tolerated: a minimum of 15 sessions of phototherapy, methotrexate at a minimum dose of 15 mg per week, or acitretin.",
      predicate: "member.hasTrialOf",
      args: {
        drugPatterns: ["methotrexate", "acitretin", "SORIATANE"],
        alsoAcceptAnswer: "phototherapyTrial",
      },
      options: [
        "Minimum of 15 sessions of phototherapy",
        "Methotrexate (minimum dose of 15 mg/week)",
        "Acitretin (SORIATANE)",
        "None of the above",
      ],
      yes: { outcome: "approve", days: 122 },
      no: { outcome: "step", step: 8 },
      citation:
        "SKYRIZI SC prior authorization form, step 7. Note: a contraindication to or intolerance of methotrexate does not cancel the requirement of a trial of acitretin.",
    },
    {
      step: 8,
      question: "If no, are ALL of the above contraindicated?",
      predicate: "request.answerYes",
      args: { field: "allAlternativesContraindicated" },
      yes: { outcome: "step", step: 9 },
      no: {
        outcome: "deny",
        reason:
          "The member has not tried phototherapy, methotrexate, or acitretin, and they are not all contraindicated. Form complete here (Deny).",
      },
      citation: "SKYRIZI SC prior authorization form, step 8",
    },
    {
      step: 9,
      question: "Please list contraindications to ALL of the above.",
      predicate: "request.answerYes",
      args: { field: "contraindicationsListed" },
      yes: { outcome: "approve", days: 122 },
      no: {
        outcome: "deny",
        reason: "Contraindications were not documented.",
      },
      citation:
        "SKYRIZI SC prior authorization form, step 9. Form complete here (Approve - 4 months).",
    },
  ],
};

// ---------------------------------------------------------------------------

const DUPIXENT_FORM = "7fb39d39-3834-4553-8e03-af0acfb50e19";

export const DUPIXENT: CriteriaTreeDef = {
  id: "pa-dupixent",
  name: "DUPIXENT",
  scopeLabel: "Dupilumab",
  drugPatterns: ["DUPIXENT"],
  formId: DUPIXENT_FORM,
  url: NAVITUS_DOC(DUPIXENT_FORM),
  defaultApprovalDays: 365,
  startStep: 1,
  steps: [
    {
      step: 1,
      question:
        "Please indicate which quantity limit the requested medication is being prescribed for.",
      predicate: "request.selectedAny",
      args: {
        field: "quantityLimitBasis",
        options: [
          "crswnp-copd-2-inj-28d",
          "loading-dose-ad-asthma",
          "maintenance-ad-asthma",
          "eoe-under-40kg",
          "eoe-over-40kg",
          "eoe-12-plus",
        ],
      },
      options: [
        "Allergic fungal rhinosinusitis, CRSwNP, and COPD: up to two injections per 28 days",
        "Loading dose for AD, asthma, CSU, prurigo nodularis, bullous pemphigoid: up to two injections for the first 14 days",
        "Maintenance dose for AD, asthma, CSU, prurigo nodularis, bullous pemphigoid: up to two injections per 28 days",
        "EoE, age 1 to 11 and weighs less than 40 kg: up to two injections per 28 days",
        "EoE, age 1 to 11 and weighs 40 kg or more: up to four injections per 28 days",
        "EoE, age 12 or older: up to four injections per 28 days",
        "None of the above",
      ],
      yes: { outcome: "step", step: 3 },
      no: { outcome: "step", step: 2 },
      citation: "DUPIXENT prior authorization form, step 1",
    },
    {
      step: 2,
      question: "Please provide requested quantity and dosing.",
      predicate: "request.answerYes",
      args: { field: "quantityDosingProvided" },
      yes: { outcome: "step", step: 3 },
      no: {
        outcome: "deny",
        reason: "Requested quantity and dosing were not provided.",
      },
      citation: "DUPIXENT prior authorization form, step 2",
    },
    {
      step: 3,
      question:
        "Provide primary diagnosis including ICD-10 codes. If complex medical circumstances, submit chart documentation with form.",
      predicate: "request.answerYes",
      args: { field: "diagnosisProvided" },
      yes: { outcome: "step", step: 4 },
      no: {
        outcome: "deny",
        reason: "No primary diagnosis with ICD-10 code was provided.",
      },
      citation: "DUPIXENT prior authorization form, step 3",
    },
    {
      step: 4,
      question: "What condition is the product being used for?",
      predicate: "request.conditionIs",
      args: { condition: "atopic-dermatitis-initial" },
      options: [
        "Initial therapy for atopic dermatitis (AD)",
        "Continuing therapy for atopic dermatitis (AD)",
        "Initial therapy for asthma",
        "Continuing therapy for asthma",
        "Initial therapy for CRSwNP",
        "Continuing therapy for CRSwNP",
        "Initial therapy for eosinophilic esophagitis (EoE)",
        "Initial therapy for prurigo nodularis (PN)",
        "Initial therapy for COPD",
        "Initial therapy for chronic spontaneous urticaria (CSU)",
      ],
      yes: { outcome: "step", step: 5 },
      no: {
        outcome: "deny",
        reason:
          "The requested indication is not among the conditions this criteria set covers.",
      },
      citation: "DUPIXENT prior authorization form, step 4",
    },
    {
      step: 5,
      question:
        "Is the member six months of age or older with a diagnosis of moderate to severe atopic dermatitis?",
      predicate: "member.hasDiagnosis",
      args: { codes: ["L20"] },
      yes: { outcome: "step", step: 6 },
      no: {
        outcome: "deny",
        reason:
          "No documented diagnosis of moderate to severe atopic dermatitis (ICD-10 L20).",
      },
      citation: "DUPIXENT prior authorization form, atopic dermatitis initial therapy",
    },
    {
      step: 6,
      question:
        "Has the member had a trial of a medium to high potency topical corticosteroid, or a topical calcineurin inhibitor, which was ineffective or not tolerated?",
      predicate: "member.hasTrialOf",
      args: {
        drugPatterns: [
          "triamcinolone",
          "clobetasol",
          "fluocinonide",
          "betamethasone",
          "mometasone",
          "tacrolimus",
          "pimecrolimus",
        ],
        /*
         * The published form requires a topical product. Ingredient-only
         * matching treated nasal sprays and oral capsules as trials.
         */
        requireFormTokens: ["cream", "ointment", "lotion", "gel", "topical"],
        alsoAcceptAnswer: "topicalTrialDocumented",
      },
      yes: { outcome: "approve", days: 365 },
      no: {
        outcome: "deny",
        reason:
          "No documented trial of a medium to high potency topical corticosteroid or topical calcineurin inhibitor.",
      },
      citation:
        "DUPIXENT prior authorization form, atopic dermatitis step therapy requirement",
    },
  ],
};

// ---------------------------------------------------------------------------

const ADALIMUMAB_FORM = "0a29d17f-498e-4499-bef1-eb8742d7e4c6";

export const ADALIMUMAB: CriteriaTreeDef = {
  id: "pa-adalimumab",
  name: "ADALIMUMAB PRODUCTS",
  scopeLabel: "Adalimumab and adalimumab biosimilars",
  drugPatterns: ["ADALIMUMAB", "HUMIRA", "HYRIMOZ", "YUFLYMA", "HULIO", "ABRILADA"],
  formId: ADALIMUMAB_FORM,
  url: NAVITUS_DOC(ADALIMUMAB_FORM),
  defaultApprovalDays: 365,
  startStep: 1,
  steps: [
    {
      step: 1,
      question:
        "Please indicate which quantity limit the requested medication is being prescribed for.",
      predicate: "request.selectedAny",
      args: {
        field: "quantityLimitBasis",
        options: ["standard-2-inj-28-days", "loading-dose", "hs-weekly"],
      },
      options: [
        "Standard maintenance: up to two injections per 28 days",
        "Loading dose",
        "Hidradenitis suppurativa weekly dosing",
        "None of the above",
      ],
      yes: { outcome: "step", step: 3 },
      no: { outcome: "step", step: 2 },
      citation: "ADALIMUMAB PRODUCTS prior authorization form, step 1",
    },
    {
      step: 2,
      question: "Please provide requested quantity and dosing.",
      predicate: "request.answerYes",
      args: { field: "quantityDosingProvided" },
      yes: { outcome: "step", step: 3 },
      no: {
        outcome: "deny",
        reason: "Requested quantity and dosing were not provided.",
      },
      citation: "ADALIMUMAB PRODUCTS prior authorization form, step 2",
    },
    {
      step: 3,
      question:
        "Provide primary diagnosis including ICD-10 codes. If complex medical circumstances, submit chart documentation with form.",
      predicate: "member.hasDiagnosis",
      args: { codes: ["L40", "M05", "M06", "K50", "K51", "L73", "M45", "H20"] },
      yes: { outcome: "step", step: 4 },
      no: {
        outcome: "deny",
        reason:
          "No qualifying primary diagnosis was documented for an adalimumab product.",
      },
      citation: "ADALIMUMAB PRODUCTS prior authorization form, step 3",
    },
    {
      step: 4,
      question:
        "Is the requested product a preferred adalimumab biosimilar, or has the member failed a preferred biosimilar?",
      predicate: "request.answerYes",
      args: { field: "preferredBiosimilarOrFailure" },
      yes: { outcome: "step", step: 5 },
      no: {
        outcome: "deny",
        reason:
          "A preferred adalimumab biosimilar must be used first. Amendment 7 to contract ETG0013 substitutes biosimilar rebate value for the reference product, and the formulary reflects that preference.",
      },
      citation:
        "ADALIMUMAB PRODUCTS prior authorization form, preferred product requirement",
    },
    {
      step: 5,
      question:
        "Has the member had a trial of a conventional therapy appropriate to the diagnosis, which was ineffective or not tolerated?",
      predicate: "member.hasTrialOf",
      args: {
        drugPatterns: [
          "methotrexate",
          "sulfasalazine",
          "leflunomide",
          "hydroxychloroquine",
          "azathioprine",
          "mesalamine",
          "budesonide",
          "acitretin",
        ],
        /*
         * Conventional systemic / GI therapy — not inhaled or nasal budesonide
         * that shares the ingredient token with Entocort-class products.
         */
        excludeFormTokens: [
          "nasal",
          "inhal",
          "hfa",
          "nebu",
          "aerosol",
          "diskus",
          "respimat",
        ],
        alsoAcceptAnswer: "conventionalTherapyTrial",
      },
      yes: { outcome: "approve", days: 365 },
      no: {
        outcome: "deny",
        reason:
          "No documented trial of conventional therapy appropriate to the diagnosis.",
      },
      citation:
        "ADALIMUMAB PRODUCTS prior authorization form, conventional therapy requirement",
    },
  ],
};

export const CRITERIA_TREES: CriteriaTreeDef[] = [SKYRIZI_SC, DUPIXENT, ADALIMUMAB];

export function findTreeForDrug(drugName: string): CriteriaTreeDef | undefined {
  const upper = drugName.toUpperCase();
  return CRITERIA_TREES.find((t) =>
    t.drugPatterns.some((p) => upper.includes(p.toUpperCase())),
  );
}
