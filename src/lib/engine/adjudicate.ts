/**
 * The adjudication pipeline.
 *
 * Ordered the way a real PBM orders it, cheapest and most actionable rejects
 * first: eligibility, then coverage, then utilization management, then
 * pricing, then cost share. Every rule emits a trace step, and any rule that
 * reads a published authority cites it.
 */

import {
  add,
  applyBps,
  fromCents,
  subtract,
  toCents,
  formatCents,
  formatUnitPrice,
  type Cents,
  type Micros,
} from "@/lib/money";
import { deriveUnitPrices, extendPrices, DEFAULT_ASSUMPTIONS, type BenchmarkAssumptions } from "./benchmark";
import { priceClaim, type RateTerms } from "./pricing";
import { TraceBuilder } from "./trace";
import {
  EMERGENCY_SUPPLY,
  emergencySupplyEligibility,
  type EmergencySupplyDecision,
} from "@/lib/pa/emergency-supply";
import { PLAN_YEAR_START } from "@/lib/clock";
import {
  evaluateQuantityLimit,
  type QuantityLimitBasis,
} from "./quantity-limit";
import {
  PRICING_ARM_LABEL,
  REJECT_MESSAGES,
  type AccumulatorDelta,
  type AdjudicationOutcome,
  type BrandGeneric,
  type Channel,
  type ClaimRequest,
  type CostShareResult,
  type PricingArm,
} from "./types";

// ---------------------------------------------------------------------------
// Context: everything the engine needs, loaded by the caller.
// ---------------------------------------------------------------------------

export interface EngineDrug {
  id: string;
  ndc11: string;
  name: string;
  monyCode: string;
  isBrandLabel: boolean;
  isSpecialty: boolean;
  therapeuticClass?: string | null;
  nadacPerUnit: number;
  /** Units in one package, and the unit they are counted in, from the NDC.
   *  Needed to turn a limit written in tubes into one written in grams. */
  packageSize?: number | null;
  unitOfMeasure?: string | null;
  /** How much each named container holds, from the FDA NDC Directory. */
  packageContainers?: Record<string, number> | null;
}

export interface EngineFormularyEntry {
  level: string;
  specialCode?: string | null;
  requiresPA: boolean;
  requiresStep: boolean;
  hasQuantityLimit: boolean;
  diagnosisRestricted: boolean;
  mandatorySpecialty: boolean;
  notCovered: boolean;
  planExclusion: boolean;
  qlQuantity?: number | null;
  qlDays?: number | null;
  qlRawText?: string | null;
  qlUnit?: string | null;
  qlBasis?: string | null;
  requiredDiagnosisCodes: string[];
  diagnosisRawText?: string | null;
}

export interface EngineMember {
  id: string;
  diagnosisCodes: string[];
  weightKg?: number | null;
}

export interface EngineEligibility {
  id: string;
  effectiveDate: Date;
  terminationDate?: Date | null;
  benefitPlanId: string;
}

export interface EnginePharmacy {
  id: string;
  npi: string;
  name: string;
  pharmacyType: string;
  isDesignatedSpecialty: boolean;
  is340B: boolean;
  inNetwork: boolean;
}

export interface EngineCostShareRule {
  level: string;
  channel: Channel;
  costShareType: "Copay" | "Coinsurance" | "NotCovered" | "Zero";
  copayCents?: number | null;
  coinsuranceRateBps?: number | null;
  coinsuranceMaxCents?: number | null;
  accumulatesToRxOop: boolean;
  accumulatesToFederalOop: boolean;
  citation?: string | null;
}

export interface EngineBenefitPlan {
  id: string;
  name: string;
  lineOfBusiness: "Commercial" | "EGWP";
  deductibleIndividual: Cents;
  deductibleIntegratedWithMedical: boolean;
  rxOopLimitIndividual: Cents;
  federalOopLimitIndividual: Cents;
  dawPenaltyEnabled: boolean;
  specialtyChannelRestricted: boolean;
  costShareRules: EngineCostShareRule[];
}

export interface EngineRate {
  channel: Channel;
  drugClass: "Brand" | "Generic" | "All";
  awpDiscountBps?: number | null;
  dispensingFeeCents: Cents;
  lesserOfArms: PricingArm[];
  includeUandC: boolean;
  minRebatePerBrandClaimCents?: number | null;
}

export interface EngineContract {
  id: string;
  model: "PassThrough" | "Traditional";
  retailMaxDaysSupply: number;
  discountExclusions: string[];
  rebateExclusions: string[];
  rebateMemberShareThresholdBps: number;
  rates: EngineRate[];
  /** Traditional contracts carry a second, higher client-side rate table. */
  clientRates?: EngineRate[];
  clientMacMultiplier?: number;
  rebatePassThroughBps: number;
}

export interface PriorFill {
  dateOfService: Date;
  daysSupply: number;
  quantityDispensed: number;
  drugId: string;
  therapeuticClass?: string | null;
}

export interface EngineAccumulatorState {
  rxOopAccumulatedCents: Cents;
  federalOopAccumulatedCents: Cents;
  deductibleAccumulatedCents: Cents;
}

export interface ApprovedPA {
  drugId: string;
  effectiveDate: Date;
  terminationDate?: Date | null;
  approvedQuantity?: number | null;
}

/**
 * NCPDP date of service is a calendar date. Approvals are stored with a full
 * instant (`/api/pa/decide` writes `clock.now`), and POS rebuilds DOS as UTC
 * midnight of the date the pharmacy entered. Comparing those instants with
 * `<=` rejects every same-day fill after a live Approve: effective at 14:00
 * is not `<=` midnight of that day. Match on the UTC calendar day instead.
 */
function utcDayMs(instant: Date): number {
  return Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
  );
}

function paCoversDateOfService(
  pa: ApprovedPA,
  dateOfService: Date,
): boolean {
  const day = utcDayMs(dateOfService);
  if (utcDayMs(pa.effectiveDate) > day) return false;
  if (pa.terminationDate && utcDayMs(pa.terminationDate) < day) return false;
  return true;
}

export interface AdjudicationContext {
  request: ClaimRequest;
  member: EngineMember;
  eligibility?: EngineEligibility | null;
  plan: EngineBenefitPlan;
  drug: EngineDrug;
  formularyEntry?: EngineFormularyEntry | null;
  pharmacy: EnginePharmacy;
  contract: EngineContract;
  priorFills: PriorFill[];
  accumulators: EngineAccumulatorState;
  approvedPAs: ApprovedPA[];
  assumptions?: BenchmarkAssumptions;
  /** Refill-too-soon threshold: a fill is early until this share of the prior
   *  days supply has elapsed. */
  refillThreshold?: number;
}

// ---------------------------------------------------------------------------

const SRC_EXHIBIT_C = "etg0013-amd1-exhibit-c";
const SRC_COC = "etf-uniform-pharmacy-coc-2026";
const SRC_FORMULARY = "navitus-etf-formulary-2026";
const SRC_NADAC = "cms-nadac";
const SRC_AWP = "simulated-awp";
const SRC_PA_PROCESS = "navitus-pa-process";

function reject(
  trace: TraceBuilder,
  code: string,
  channel: Channel,
  brandGeneric: BrandGeneric,
  level: string | undefined,
  isSpecialty: boolean,
): AdjudicationOutcome {
  return {
    responseStatus: "R",
    rejectCodes: [code],
    rejectMessage: REJECT_MESSAGES[code] ?? "Claim rejected",
    channel,
    brandGeneric,
    formularyLevel: level,
    isSpecialtyClaim: isSpecialty,
    allowedIngredientCostCents: 0,
    allowedDispensingFeeCents: 0,
    totalAllowedCents: 0,
    pharmacyPaidCents: 0,
    billedIngredientCostCents: 0,
    billedDispensingFeeCents: 0,
    totalBilledCents: 0,
    planPaidCents: 0,
    patientPayCents: 0,
    appliedToDeductibleCents: 0,
    copayCoinsuranceCents: 0,
    brandSelectionPenaltyCents: 0,
    awpIsSimulated: false,
    excludedFromDiscountGuarantee: true,
    discountExclusionReason: "Claim rejected",
    rebateEligible: false,
    rebateExclusionReason: "Claim rejected",
    estimatedRebateCents: 0,
    trace: trace.all(),
  };
}

/**
 * Brand versus generic is a contractual definition, not a clinical one, and it
 * is the most litigated definition in PBM contracting. It keys off the
 * Medi-Span multi-source code, with DAW overrides that move claims between the
 * brand and generic guarantee pools.
 */
export function classifyBrandGeneric(
  monyCode: string,
  dawCode: string,
): { classification: BrandGeneric; rationale: string } {
  if (monyCode === "Y") {
    return {
      classification: "Generic",
      rationale:
        "Multi-source code Y: considered generic, multiple sources available.",
    };
  }
  if (monyCode === "O") {
    if (["3", "4", "5", "6", "9"].includes(dawCode)) {
      return {
        classification: "Generic",
        rationale: `Multi-source code O with DAW ${dawCode}: an originator brand dispensed as a generic is classified generic for pricing and generic dispensing rate purposes.`,
      };
    }
    return {
      classification: "Brand",
      rationale:
        "Multi-source code O: innovator product with generics available, classified brand absent a DAW override.",
    };
  }
  return {
    classification: "Brand",
    rationale: `Multi-source code ${monyCode}: single source, classified brand.`,
  };
}

export function determineChannel(
  pharmacyType: string,
  isSpecialtyDrug: boolean,
  daysSupply: number,
  retailMaxDaysSupply: number,
): { channel: Channel; rationale: string } {
  if (isSpecialtyDrug) {
    return {
      channel: "Specialty",
      rationale: "Drug is flagged specialty, which has its own rate and network.",
    };
  }
  if (pharmacyType === "Mail") {
    return { channel: "Mail", rationale: "Dispensed by the mail order pharmacy." };
  }
  if (daysSupply > retailMaxDaysSupply) {
    return {
      channel: "Retail90",
      rationale: `Days supply ${daysSupply} exceeds ${retailMaxDaysSupply}, so this prices as Retail 90.`,
    };
  }
  return {
    channel: "Retail",
    rationale: `Days supply ${daysSupply} is within 1 to ${retailMaxDaysSupply}, so this prices as Retail.`,
  };
}

function findRate(
  rates: EngineRate[],
  channel: Channel,
  brandGeneric: BrandGeneric,
): EngineRate | undefined {
  return (
    rates.find((r) => r.channel === channel && r.drugClass === brandGeneric) ??
    rates.find((r) => r.channel === channel && r.drugClass === "All")
  );
}

// ---------------------------------------------------------------------------

export function adjudicate(ctx: AdjudicationContext): AdjudicationOutcome {
  const trace = new TraceBuilder();
  const {
    request,
    member,
    eligibility,
    plan,
    drug,
    formularyEntry,
    pharmacy,
    contract,
    priorFills,
    accumulators,
    approvedPAs,
  } = ctx;
  const assumptions = ctx.assumptions ?? DEFAULT_ASSUMPTIONS;
  const refillThreshold = ctx.refillThreshold ?? 0.75;

  // --- Classification, needed for both rejects and pricing ---------------
  const bg = classifyBrandGeneric(drug.monyCode, request.dawCode);
  const ch = determineChannel(
    pharmacy.pharmacyType,
    drug.isSpecialty,
    request.daysSupply,
    contract.retailMaxDaysSupply,
  );
  const channel = ch.channel;
  const brandGeneric = bg.classification;

  // =======================================================================
  // Stage 1: eligibility
  // =======================================================================
  if (!eligibility) {
    trace.internal({
      ruleId: "eligibility.span.lookup",
      stage: "eligibility",
      question: "Is there a coverage span for this member on the fill date?",
      inputs: {
        cardholderId: request.cardholderId,
        personCode: request.personCode,
        dateOfService: request.dateOfService.toISOString().slice(0, 10),
      },
      output: { found: false },
      fired: true,
      detail: "No active coverage span matched this member on the date of service.",
    });
    return reject(trace, "65", channel, brandGeneric, undefined, drug.isSpecialty);
  }

  const dos = request.dateOfService;
  if (dos < eligibility.effectiveDate) {
    trace.internal({
      ruleId: "eligibility.span.before-effective",
      stage: "eligibility",
      question: "Is the fill date on or after coverage effective date?",
      inputs: {
        dateOfService: dos.toISOString().slice(0, 10),
        effectiveDate: eligibility.effectiveDate.toISOString().slice(0, 10),
      },
      output: { covered: false },
      fired: true,
      detail: "Fill date precedes the coverage effective date.",
    });
    return reject(trace, "67", channel, brandGeneric, undefined, drug.isSpecialty);
  }
  if (eligibility.terminationDate && dos > eligibility.terminationDate) {
    trace.internal({
      ruleId: "eligibility.span.after-termination",
      stage: "eligibility",
      question: "Is the fill date on or before coverage termination?",
      inputs: {
        dateOfService: dos.toISOString().slice(0, 10),
        terminationDate: eligibility.terminationDate.toISOString().slice(0, 10),
      },
      output: { covered: false },
      fired: true,
      detail: "Coverage terminated before this fill date.",
    });
    return reject(trace, "69", channel, brandGeneric, undefined, drug.isSpecialty);
  }

  trace.internal({
    ruleId: "eligibility.span.active",
    stage: "eligibility",
    question: "Is this person covered under this plan on the fill date?",
    inputs: {
      memberId: member.id,
      dateOfService: dos.toISOString().slice(0, 10),
      spanEffective: eligibility.effectiveDate.toISOString().slice(0, 10),
      spanTermination:
        eligibility.terminationDate?.toISOString().slice(0, 10) ?? null,
    },
    output: { covered: true, planId: plan.id, planName: plan.name },
    fired: false,
    detail: `Active coverage under ${plan.name}.`,
  });

  // --- Network -----------------------------------------------------------
  if (!pharmacy.inNetwork) {
    trace.cited({
      ruleId: "eligibility.network.participation",
      stage: "eligibility",
      question: "Is this pharmacy in the plan's network on the fill date?",
      inputs: { pharmacy: pharmacy.name, npi: pharmacy.npi },
      output: { inNetwork: false },
      fired: true,
      detail:
        "Guarantees apply only to the NaviCare Limited Network. This pharmacy is not a participant.",
      sourceDocumentId: SRC_EXHIBIT_C,
      citation:
        "Exhibit C footnote: commercial discount and dispensing fee guarantees are applicable only to the NaviCare Limited Network.",
    });
    return reject(trace, "40", channel, brandGeneric, undefined, drug.isSpecialty);
  }

  trace.cited({
    ruleId: "classification.channel",
    stage: "coverage",
    question: "Which pricing channel does this fill belong to?",
    inputs: {
      pharmacyType: pharmacy.pharmacyType,
      daysSupply: request.daysSupply,
      isSpecialtyDrug: drug.isSpecialty,
      retailMaxDaysSupply: contract.retailMaxDaysSupply,
    },
    output: { channel },
    fired: true,
    detail: ch.rationale,
    sourceDocumentId: SRC_EXHIBIT_C,
    citation:
      "Exhibit C footnote: Retail is defined as 1-83 Days' Supply. Retail 90 is defined as 84+ Days' Supply.",
  });

  trace.internal({
    ruleId: "classification.brand-generic",
    stage: "coverage",
    question: "Does this claim price as brand or as generic?",
    inputs: { monyCode: drug.monyCode, dawCode: request.dawCode },
    output: { classification: brandGeneric },
    fired: true,
    detail: bg.rationale,
  });

  // =======================================================================
  // Stage 2: coverage
  // =======================================================================
  if (!formularyEntry) {
    trace.cited({
      ruleId: "coverage.formulary.not-listed",
      stage: "coverage",
      question: "Is this drug on the plan formulary?",
      inputs: { ndc: drug.ndc11, drug: drug.name },
      output: { onFormulary: false },
      fired: true,
      detail: "No formulary entry found for this product.",
      sourceDocumentId: SRC_FORMULARY,
      citation: "State of Wisconsin Group Health Insurance Program Formulary",
    });
    return reject(trace, "MR", channel, brandGeneric, undefined, drug.isSpecialty);
  }

  const level = formularyEntry.level;

  if (formularyEntry.planExclusion) {
    trace.cited({
      ruleId: "coverage.plan-exclusion",
      stage: "coverage",
      question: "Is this drug excluded from the pharmacy benefit entirely?",
      inputs: { drug: drug.name, level, specialCode: formularyEntry.specialCode },
      output: { excluded: true },
      fired: true,
      detail:
        "The Certificate of Coverage excludes treatment or supplies for weight reduction, including FDA medications approved for weight loss. These appear on the Discount Drug List at full member cost and do not accumulate to any out-of-pocket limit.",
      sourceDocumentId: SRC_COC,
      citation:
        "Uniform Pharmacy Benefits Certificate of Coverage 2026, exclusions.",
    });
    return reject(trace, "70", channel, brandGeneric, level, drug.isSpecialty);
  }

  if (formularyEntry.notCovered) {
    trace.cited({
      ruleId: "coverage.not-covered",
      stage: "coverage",
      question: "Is this drug covered at any level?",
      inputs: { drug: drug.name, level },
      output: { covered: false },
      fired: true,
      detail: "Formulary lists this product as not covered.",
      sourceDocumentId: SRC_FORMULARY,
      citation: `Formulary special code ${formularyEntry.specialCode ?? "NC"}`,
    });
    return reject(trace, "70", channel, brandGeneric, level, drug.isSpecialty);
  }

  trace.cited({
    ruleId: "coverage.formulary.level",
    stage: "coverage",
    question: "What benefit level does the formulary assign this drug?",
    inputs: { ndc: drug.ndc11, drug: drug.name },
    output: {
      level,
      specialCode: formularyEntry.specialCode,
      category: null,
    },
    fired: true,
    detail: `Formulary places this product at Level ${level}${
      formularyEntry.specialCode ? ` with special code ${formularyEntry.specialCode}` : ""
    }.`,
    sourceDocumentId: SRC_FORMULARY,
    citation: "State of Wisconsin Group Health Insurance Program Formulary, effective 2026-07-01",
  });

  // =======================================================================
  // Stage 3: utilization management
  // =======================================================================

  // --- Diagnosis restriction ---------------------------------------------
  if (
    formularyEntry.diagnosisRestricted &&
    formularyEntry.requiredDiagnosisCodes.length > 0
  ) {
    const matched = formularyEntry.requiredDiagnosisCodes.filter((required) =>
      member.diagnosisCodes.some((held) => held.startsWith(required)),
    );
    const ok = matched.length > 0;
    trace.cited({
      ruleId: "um.diagnosis-restriction",
      stage: "um",
      question: "Does the member have a diagnosis this drug is restricted to?",
      inputs: {
        requiredDiagnosisCodes: formularyEntry.requiredDiagnosisCodes,
        memberDiagnosisCodes: member.diagnosisCodes,
      },
      output: { satisfied: ok, matched },
      fired: !ok,
      detail: ok
        ? `Member has a qualifying diagnosis (${matched.join(", ")}).`
        : `Coverage is restricted to ${formularyEntry.diagnosisRawText ?? formularyEntry.requiredDiagnosisCodes.join(", ")}, and no qualifying diagnosis is on file.`,
      sourceDocumentId: SRC_FORMULARY,
      citation: `Formulary entry: ${formularyEntry.diagnosisRawText ?? "diagnosis restricted"}`,
    });
    if (!ok) {
      return reject(trace, "80", channel, brandGeneric, level, drug.isSpecialty);
    }
  }

  // --- Quantity limit ------------------------------------------------------
  if (formularyEntry.hasQuantityLimit && formularyEntry.qlQuantity != null) {
    const printed =
      formularyEntry.qlRawText ??
      `${formularyEntry.qlQuantity} ${formularyEntry.qlUnit ?? "units"}${
        formularyEntry.qlDays ? ` per ${formularyEntry.qlDays} days` : " per fill"
      }`;

    const verdict = evaluateQuantityLimit({
      limit: {
        quantity: formularyEntry.qlQuantity,
        unit: formularyEntry.qlUnit ?? null,
        basis: (formularyEntry.qlBasis as QuantityLimitBasis | null) ?? "dispensing-unit",
        periodDays: formularyEntry.qlDays ?? null,
        rawText: formularyEntry.qlRawText ?? null,
      },
      quantityDispensed: request.quantityDispensed,
      daysSupply: request.daysSupply,
      dateOfService: dos,
      packageSize: drug.packageSize ?? 1,
      unitOfMeasure: drug.unitOfMeasure ?? "EA",
      packageContainers: drug.packageContainers ?? null,
      priorFills: priorFills.filter(
        (f) => f.drugId === drug.id && f.dateOfService < dos,
      ),
      planYearStart: PLAN_YEAR_START,
    });

    if (!verdict.enforceable) {
      /*
       * The limit stays on the record and off the claim.
       *
       * There are two ways to get this wrong and only one of them is loud.
       * Dropping the limit silently is what let Vascepa pay above four a day
       * for two years. Enforcing it on a unit conversion nobody supplied
       * refuses medicine to a member who is inside their limit, and cites a
       * real rule while doing it. So the claim passes, and the trace records
       * the gap in terms an operator can act on.
       */
      trace.cited({
        ruleId: "um.quantity-limit.not-enforceable",
        stage: "um",
        question: "Is the dispensed quantity within the plan's limit?",
        inputs: {
          limit: printed,
          basis: verdict.basis,
          quantityDispensed: request.quantityDispensed,
          billedIn: drug.unitOfMeasure ?? "EA",
          packageSize: drug.packageSize ?? 1,
        },
        output: { enforced: false },
        fired: false,
        detail: verdict.reason,
        sourceDocumentId: SRC_FORMULARY,
        citation: `Formulary quantity limit: ${printed}`,
      });
    } else {
      trace.cited({
        ruleId: "um.quantity-limit",
        stage: "um",
        question: "Is the dispensed quantity within the plan's limit?",
        inputs: {
          limit: printed,
          basis: verdict.basis,
          quantityDispensed: request.quantityDispensed,
          daysSupply: request.daysSupply,
          allowed: verdict.allowed,
          used: verdict.used,
          countedIn: verdict.comparedIn,
          window: verdict.window,
        },
        output: { withinLimit: verdict.withinLimit },
        fired: !verdict.withinLimit,
        detail: verdict.withinLimit
          ? `Within the limit of ${printed}: ${verdict.used} of ${verdict.allowed} ${verdict.comparedIn} over ${verdict.window}.`
          : `This fill would take the member to ${verdict.used} ${verdict.comparedIn} against a limit of ${verdict.allowed} — ${printed}, measured over ${verdict.window}.`,
        sourceDocumentId: SRC_FORMULARY,
        citation: `Formulary quantity limit: ${printed}`,
      });

      if (!verdict.withinLimit) {
        return reject(trace, "76", channel, brandGeneric, level, drug.isSpecialty);
      }
    }
  }

  // --- Refill too soon -----------------------------------------------------
  const sameDrugFills = priorFills
    .filter((f) => f.drugId === drug.id && f.dateOfService < dos)
    .sort((a, b) => b.dateOfService.getTime() - a.dateOfService.getTime());

  if (sameDrugFills.length > 0) {
    const last = sameDrugFills[0];
    const elapsedDays = Math.floor(
      (dos.getTime() - last.dateOfService.getTime()) / 86_400_000,
    );
    const requiredDays = Math.ceil(last.daysSupply * refillThreshold);
    const tooSoon = elapsedDays < requiredDays;
    const eligibleDate = new Date(
      last.dateOfService.getTime() + requiredDays * 86_400_000,
    );

    trace.internal({
      ruleId: "um.refill-too-soon",
      stage: "um",
      question: "Has enough of the previous fill been used?",
      inputs: {
        lastFillDate: last.dateOfService.toISOString().slice(0, 10),
        lastDaysSupply: last.daysSupply,
        thresholdPct: refillThreshold,
        elapsedDays,
        requiredDays,
      },
      output: {
        tooSoon,
        eligibleRefillDate: eligibleDate.toISOString().slice(0, 10),
      },
      fired: tooSoon,
      detail: tooSoon
        ? `Only ${elapsedDays} of the required ${requiredDays} days have elapsed. Eligible for refill on ${eligibleDate.toISOString().slice(0, 10)}.`
        : `${elapsedDays} days elapsed since the last fill, which clears the ${Math.round(refillThreshold * 100)}% threshold.`,
    });

    if (tooSoon) {
      const out = reject(trace, "79", channel, brandGeneric, level, drug.isSpecialty);
      out.rejectMessage = `${REJECT_MESSAGES["79"]}. Eligible ${eligibleDate.toISOString().slice(0, 10)}.`;
      return out;
    }
  }

  // --- Specialty channel restriction ---------------------------------------
  if (
    plan.specialtyChannelRestricted &&
    level === "4" &&
    !pharmacy.isDesignatedSpecialty
  ) {
    trace.cited({
      ruleId: "um.specialty-channel",
      stage: "um",
      question: "Was this Level 4 drug filled at a designated specialty pharmacy?",
      inputs: { pharmacy: pharmacy.name, isDesignatedSpecialty: false },
      output: { allowed: false },
      fired: true,
      detail:
        "Level 4 drugs must be filled at Lumicera Health Services or UW Health Specialty Pharmacy. Filled elsewhere, the drug is not covered.",
      sourceDocumentId: SRC_COC,
      citation:
        "Certificate of Coverage 2026: Level 4 drugs must be obtained from a designated specialty pharmacy.",
    });
    return reject(trace, "70", channel, brandGeneric, level, drug.isSpecialty);
  }

  // --- Prior authorization -------------------------------------------------
  /*
   * Set when an authorization requirement is waived under the weekend and
   * holiday emergency supply, which also makes the fill free to the member. The
   * flag has to be carried down to cost sharing rather than handled here,
   * because "the plan pays and the member does not" is a cost-share outcome.
   */
  let emergencySupply: EmergencySupplyDecision | null = null;

  if (formularyEntry.requiresPA) {
    const approved = approvedPAs.find(
      (pa) => pa.drugId === drug.id && paCoversDateOfService(pa, dos),
    );
    const hasPA = Boolean(approved) || Boolean(request.priorAuthNumber);

    trace.cited({
      ruleId: "um.prior-authorization",
      stage: "um",
      question: "Does this drug require prior authorization, and is one on file?",
      inputs: {
        requiresPA: true,
        approvedPaOnFile: Boolean(approved),
        paNumberSubmitted: request.priorAuthNumber ?? null,
      },
      output: { satisfied: hasPA },
      fired: !hasPA,
      detail: hasPA
        ? "An approved prior authorization covers this fill date."
        : "This drug requires prior authorization and no approval is on file for this date.",
      sourceDocumentId: SRC_FORMULARY,
      citation: `Formulary special code ${formularyEntry.specialCode ?? "PA"} indicates prior authorization required.`,
    });

    if (!hasPA) {
      const decision = emergencySupplyEligibility({
        dateOfService: dos,
        daysSupply: request.daysSupply,
        levelOfService: request.levelOfService,
      });

      // Only worth a trace step when the pharmacy actually asked; otherwise
      // every authorization reject would carry a paragraph about a rule nobody
      // invoked.
      if (decision.requested) {
        trace.cited({
          ruleId: "um.emergency-supply",
          stage: "um",
          question:
            "May the pharmacy dispense an emergency supply because the prescriber cannot be reached?",
          inputs: {
            levelOfService: request.levelOfService ?? null,
            dateOfService: dos.toISOString().slice(0, 10),
            closure: decision.closure?.label ?? "business day",
            daysSupply: request.daysSupply,
            maxDaysSupply: decision.maxDaysSupply,
          },
          output: {
            granted: decision.eligible,
            memberPays: decision.eligible ? formatCents(0) : null,
            authorizationWorkableOn:
              decision.workableOn?.toISOString().slice(0, 10) ?? null,
          },
          fired: decision.eligible,
          detail: decision.detail,
          sourceDocumentId: SRC_PA_PROCESS,
          citation: EMERGENCY_SUPPLY.citation,
        });
      }

      if (decision.eligible) {
        emergencySupply = decision;
      } else {
        return reject(trace, "75", channel, brandGeneric, level, drug.isSpecialty);
      }
    }
  }

  // --- Step therapy --------------------------------------------------------
  if (formularyEntry.requiresStep) {
    const triedAlternative = priorFills.some(
      (f) =>
        f.therapeuticClass &&
        drug.therapeuticClass &&
        f.therapeuticClass === drug.therapeuticClass &&
        f.drugId !== drug.id,
    );
    trace.cited({
      ruleId: "um.step-therapy",
      stage: "um",
      question: "Has the member tried a preferred alternative first?",
      inputs: {
        therapeuticClass: drug.therapeuticClass,
        priorFillsInClass: priorFills.filter(
          (f) => f.therapeuticClass === drug.therapeuticClass && f.drugId !== drug.id,
        ).length,
      },
      output: { satisfied: triedAlternative },
      fired: !triedAlternative,
      detail: triedAlternative
        ? "Claims history shows a prior trial of an alternative in this class."
        : "No prior trial of a preferred alternative in this therapeutic class.",
      sourceDocumentId: SRC_FORMULARY,
      citation: `Formulary special code ${formularyEntry.specialCode ?? "ST"} indicates step therapy required.`,
    });
    if (!triedAlternative) {
      return reject(trace, "608", channel, brandGeneric, level, drug.isSpecialty);
    }
  }

  // =======================================================================
  // Stage 4: pricing
  // =======================================================================
  const unitPrices = deriveUnitPrices(
    drug.ndc11,
    drug.nadacPerUnit,
    brandGeneric === "Brand",
    assumptions,
    drug.isSpecialty,
  );
  const prices = extendPrices(unitPrices, request.quantityDispensed);

  trace.cited({
    ruleId: "pricing.benchmark.nadac",
    stage: "pricing",
    question: "What did the pharmacy actually pay to acquire this drug?",
    inputs: {
      ndc: drug.ndc11,
      nadacPerUnit: unitPrices.nadacPerUnit,
      quantity: request.quantityDispensed,
    },
    output: {
      nadacPerUnit: formatUnitPrice(unitPrices.nadacPerUnit),
      extended: formatCents(toCents(prices.nadacMicros)),
    },
    fired: true,
    detail: `NADAC of ${formatUnitPrice(unitPrices.nadacPerUnit)} per unit across ${request.quantityDispensed} units is ${formatCents(toCents(prices.nadacMicros))}. This is a published CMS survey figure that can be checked against the public file.`,
    sourceDocumentId: SRC_NADAC,
    citation: `NADAC file, NDC ${drug.ndc11}, effective on or before ${dos.toISOString().slice(0, 10)}`,
  });

  trace.cited({
    ruleId: "pricing.benchmark.awp",
    stage: "pricing",
    question: "What is the AWP benchmark this contract prices against?",
    inputs: {
      ndc: drug.ndc11,
      derivedFrom: "NADAC",
      multiplier:
        brandGeneric === "Brand"
          ? assumptions.awpMultiplierBrand
          : assumptions.awpMultiplierGeneric,
    },
    output: {
      awpPerUnit: formatUnitPrice(unitPrices.awpPerUnit),
      extended: formatCents(toCents(prices.awpMicros)),
      simulated: true,
    },
    fired: true,
    detail:
      "AWP is proprietary to Medi-Span and is not published. Exhibit C names Medi-Span as the sole pricing source for this contract, so the plan sponsor cannot independently verify this number. The figure shown is derived from NADAC and is marked AWP wherever it appears.",
    sourceDocumentId: SRC_AWP,
    citation:
      "Exhibit C footnote: Medi-Span is Navitus' only source of drug pricing data and is utilized for all claims adjudication.",
  });

  const rate = findRate(contract.rates, channel, brandGeneric);
  if (!rate) {
    throw new Error(
      `No contract rate for channel ${channel} and class ${brandGeneric}`,
    );
  }

  const rateTerms: RateTerms = {
    awpDiscountBps: rate.awpDiscountBps,
    dispensingFeeMicros: fromCents(rate.dispensingFeeCents),
    lesserOfArms: rate.lesserOfArms,
    includeUandC: rate.includeUandC,
  };

  const pharmacyPricing = priceClaim({
    prices,
    usualAndCustomaryMicros: fromCents(request.usualAndCustomaryCents),
    submittedIngredientCostMicros: fromCents(
      request.ingredientCostSubmittedCents ?? 0,
    ),
    rate: rateTerms,
  });

  trace.cited({
    ruleId: "pricing.lesser-of",
    stage: "pricing",
    question: "Which pricing arm produced the lowest allowable cost?",
    inputs: {
      arms: pharmacyPricing.arms
        .filter((a) => a.applicable)
        .map((a) => ({
          arm: PRICING_ARM_LABEL[a.arm],
          amount: formatCents(toCents(a.ingredientCostMicros)),
        })),
      awpDiscount: rate.awpDiscountBps ? `${(rate.awpDiscountBps / 100).toFixed(2)}%` : null,
      dispensingFee: formatCents(rate.dispensingFeeCents),
    },
    output: {
      winningArm: PRICING_ARM_LABEL[pharmacyPricing.winningArm],
      basisOfReimbursement522FM: pharmacyPricing.basisOfReimbursement,
      allowedIngredientCost: formatCents(
        toCents(pharmacyPricing.allowedIngredientCostMicros),
      ),
      totalAllowed: formatCents(toCents(pharmacyPricing.totalAllowedMicros)),
    },
    fired: true,
    detail: `${PRICING_ARM_LABEL[pharmacyPricing.winningArm]} won at ${formatCents(toCents(pharmacyPricing.allowedIngredientCostMicros))}, plus a ${formatCents(rate.dispensingFeeCents)} dispensing fee.`,
    sourceDocumentId: SRC_EXHIBIT_C,
    citation: `Exhibit C, ${channel} ${brandGeneric}: AWP less ${rate.awpDiscountBps ? (rate.awpDiscountBps / 100).toFixed(2) : "n/a"}%, dispensing fee ${formatCents(rate.dispensingFeeCents)}.`,
  });

  // --- Client side ---------------------------------------------------------
  // Under pass-through these are the same numbers. Under a traditional
  // contract they are computed from a separate, higher rate table, and the
  // difference is the spread.
  let clientPricing = pharmacyPricing;
  if (contract.model === "Traditional" && contract.clientRates) {
    const clientRate = findRate(contract.clientRates, channel, brandGeneric);
    if (clientRate) {
      clientPricing = priceClaim({
        prices,
        usualAndCustomaryMicros: fromCents(request.usualAndCustomaryCents),
        submittedIngredientCostMicros: fromCents(
          request.ingredientCostSubmittedCents ?? 0,
        ),
        rate: {
          awpDiscountBps: clientRate.awpDiscountBps,
          dispensingFeeMicros: fromCents(clientRate.dispensingFeeCents),
          lesserOfArms: clientRate.lesserOfArms,
          includeUandC: clientRate.includeUandC,
          macMultiplier: contract.clientMacMultiplier,
        },
      });

      const spread = subtract(
        clientPricing.totalAllowedMicros,
        pharmacyPricing.totalAllowedMicros,
      );
      trace.cited({
        ruleId: "pricing.spread",
        stage: "pricing",
        question: "Is the plan billed the same amount the pharmacy is paid?",
        inputs: {
          pharmacyPaid: formatCents(toCents(pharmacyPricing.totalAllowedMicros)),
          planBilled: formatCents(toCents(clientPricing.totalAllowedMicros)),
        },
        output: { spread: formatCents(toCents(spread)) },
        fired: spread !== 0,
        detail:
          spread === 0
            ? "No spread on this claim."
            : `The plan is billed ${formatCents(toCents(spread))} more than the pharmacy receives. This contract maintains separate client and pharmacy rate tables.`,
        sourceDocumentId: "michigan-optumrx-scheduleb",
        citation:
          "Schedule B gives the client-side guarantee. Pharmacy-side network rates are not published; the spread shown is modeled.",
      });
    }
  } else {
    trace.cited({
      ruleId: "pricing.passthrough-invariant",
      stage: "pricing",
      question: "Is the plan billed exactly what the pharmacy is paid?",
      inputs: {
        pharmacyPaid: formatCents(toCents(pharmacyPricing.totalAllowedMicros)),
        planBilled: formatCents(toCents(pharmacyPricing.totalAllowedMicros)),
      },
      output: { spread: formatCents(0), invariantHolds: true },
      fired: true,
      detail:
        "This is a pass-through contract. The client and pharmacy rate tables are the same row, so spread is structurally impossible rather than merely promised.",
      sourceDocumentId: SRC_EXHIBIT_C,
      citation: "Contract ETG0013, pass-through pricing model.",
    });
  }

  // =======================================================================
  // Stage 5: member cost share
  // =======================================================================
  const costShare = computeCostShare({
    trace,
    plan,
    level,
    channel,
    totalAllowedMicros: clientPricing.totalAllowedMicros,
    accumulators,
    dawCode: request.dawCode,
    brandGeneric,
    genericReferenceMicros: prices.macMicros ?? prices.nadacMicros,
    emergencySupply,
  });

  // =======================================================================
  // Stage 6: rebate
  // =======================================================================
  const planPaidMicros = subtract(
    clientPricing.totalAllowedMicros,
    costShare.patientPayMicros,
  );

  const rebate = computeRebate({
    trace,
    contract,
    rate,
    brandGeneric,
    channel,
    drugName: drug.name,
    is340B: pharmacy.is340B,
    pharmacyType: pharmacy.pharmacyType,
    totalAllowedMicros: clientPricing.totalAllowedMicros,
    patientPayMicros: costShare.patientPayMicros,
  });

  // --- Discount guarantee participation ------------------------------------
  const discountExclusion = evaluateDiscountExclusion(
    contract,
    pharmacy,
    request,
  );
  if (discountExclusion) {
    trace.cited({
      ruleId: "guarantee.discount-exclusion",
      stage: "rebate",
      question: "Does this claim count toward the discount guarantee?",
      inputs: { reason: discountExclusion },
      output: { included: false },
      fired: true,
      detail: `Excluded from the discount guarantee calculation: ${discountExclusion}.`,
      sourceDocumentId: SRC_EXHIBIT_C,
      citation:
        "Exhibit C footnote: network discounts and fees may exclude claims from non-traditional providers, and compound, secondary, 340B, vaccination and member-submitted claims.",
    });
  }

  /*
   * Round once, then derive the counterpart by subtraction.
   *
   * Converting the member's share and the plan's share to cents independently
   * lets both round down and lose a cent: 20% of $3.72 is $0.744 and the
   * remainder is $2.976, which round to $0.74 and $2.97 and sum to $3.71. It
   * showed up on 2,011 claims. The member's share is the figure a person is
   * charged at a counter, so that is the one rounded to the penny, and the
   * plan absorbs the remainder. The parts now always sum to the total.
   */
  const totalBilledCents = toCents(clientPricing.totalAllowedMicros);
  const totalAllowedCents = toCents(pharmacyPricing.totalAllowedMicros);
  const patientPayCents = toCents(costShare.patientPayMicros);

  return {
    responseStatus: "P",
    rejectCodes: [],
    channel,
    brandGeneric,
    formularyLevel: level,
    isSpecialtyClaim: drug.isSpecialty,
    pricing: pharmacyPricing,
    clientPricing,
    costShare,

    allowedIngredientCostCents: toCents(pharmacyPricing.allowedIngredientCostMicros),
    allowedDispensingFeeCents: toCents(pharmacyPricing.dispensingFeeMicros),
    totalAllowedCents,
    pharmacyPaidCents: totalAllowedCents - patientPayCents,
    billedIngredientCostCents: toCents(clientPricing.allowedIngredientCostMicros),
    billedDispensingFeeCents: toCents(clientPricing.dispensingFeeMicros),
    totalBilledCents,
    planPaidCents: totalBilledCents - patientPayCents,

    patientPayCents,
    appliedToDeductibleCents: toCents(costShare.appliedToDeductibleMicros),
    copayCoinsuranceCents: toCents(costShare.copayCoinsuranceMicros),
    brandSelectionPenaltyCents: toCents(costShare.brandSelectionPenaltyMicros),

    awpUnitAtDos: unitPrices.awpPerUnit,
    awpTotalCents: toCents(prices.awpMicros),
    nadacUnitAtDos: unitPrices.nadacPerUnit,
    nadacTotalCents: toCents(prices.nadacMicros),
    macUnitAtDos: unitPrices.macPerUnit,
    awpIsSimulated: true,

    excludedFromDiscountGuarantee: Boolean(discountExclusion),
    discountExclusionReason: discountExclusion ?? undefined,
    rebateEligible: rebate.eligible,
    rebateExclusionReason: rebate.exclusionReason,
    estimatedRebateCents: rebate.amountCents,

    trace: trace.all(),
  };
}

// ---------------------------------------------------------------------------

interface CostShareArgs {
  trace: TraceBuilder;
  plan: EngineBenefitPlan;
  level: string;
  channel: Channel;
  totalAllowedMicros: Micros;
  accumulators: EngineAccumulatorState;
  dawCode: string;
  brandGeneric: BrandGeneric;
  genericReferenceMicros: Micros;
  /** Set when the fill is an emergency supply, which the member does not pay for. */
  emergencySupply?: EmergencySupplyDecision | null;
}

function computeCostShare(args: CostShareArgs): CostShareResult {
  const {
    trace,
    plan,
    level,
    channel,
    totalAllowedMicros,
    accumulators,
    dawCode,
    brandGeneric,
    genericReferenceMicros,
    emergencySupply,
  } = args;

  const rule =
    plan.costShareRules.find((r) => r.level === level && r.channel === channel) ??
    plan.costShareRules.find((r) => r.level === level);

  const deltas: AccumulatorDelta[] = [];

  /*
   * An emergency supply is free to the member, which means it also contributes
   * nothing to either out-of-pocket limit: there is no member payment to
   * accumulate. Returning here rather than zeroing at the end keeps that true by
   * construction instead of relying on a later subtraction.
   */
  if (emergencySupply?.eligible) {
    trace.cited({
      ruleId: "costshare.emergency-supply",
      stage: "costshare",
      question: "What does the member pay for an emergency supply?",
      inputs: {
        level,
        channel,
        closure: emergencySupply.closure?.label ?? null,
        daysSupply: `up to ${emergencySupply.maxDaysSupply}`,
      },
      output: { patientPay: formatCents(0) },
      fired: true,
      detail:
        "Nothing. The plan requires an authorization this member could not have obtained, so the fill is covered in full and nothing accumulates to either out-of-pocket limit.",
      sourceDocumentId: SRC_PA_PROCESS,
      citation: EMERGENCY_SUPPLY.citation,
    });
    return {
      patientPayMicros: 0,
      appliedToDeductibleMicros: 0,
      copayCoinsuranceMicros: 0,
      brandSelectionPenaltyMicros: 0,
      accumulatorDeltas: deltas,
    };
  }

  if (!rule || rule.costShareType === "Zero") {
    trace.cited({
      ruleId: "costshare.zero",
      stage: "costshare",
      question: "What does the member pay?",
      inputs: { level, channel },
      output: { patientPay: formatCents(0) },
      fired: true,
      detail: "Preventive drug, covered at 100% with no member cost share.",
      sourceDocumentId: SRC_COC,
      citation: rule?.citation ?? "Certificate of Coverage 2026, preventive drugs.",
    });
    return {
      patientPayMicros: 0,
      appliedToDeductibleMicros: 0,
      copayCoinsuranceMicros: 0,
      brandSelectionPenaltyMicros: 0,
      accumulatorDeltas: deltas,
    };
  }

  // --- Deductible ----------------------------------------------------------
  let remainingMicros = totalAllowedMicros;
  let appliedToDeductibleMicros = 0;

  if (plan.deductibleIndividual > 0) {
    const deductibleRemaining = Math.max(
      0,
      fromCents(plan.deductibleIndividual) -
        fromCents(accumulators.deductibleAccumulatedCents),
    );
    appliedToDeductibleMicros = Math.min(remainingMicros, deductibleRemaining);
    remainingMicros -= appliedToDeductibleMicros;

    if (appliedToDeductibleMicros > 0) {
      deltas.push({
        accumulatorType: "DeductibleIndividual",
        amountMicros: appliedToDeductibleMicros,
      });
      trace.cited({
        ruleId: "costshare.deductible",
        stage: "costshare",
        question: "Is any of this claim subject to the deductible?",
        inputs: {
          deductible: formatCents(plan.deductibleIndividual),
          alreadyMet: formatCents(accumulators.deductibleAccumulatedCents),
        },
        output: {
          applied: formatCents(toCents(appliedToDeductibleMicros)),
          memberOwes: formatCents(toCents(appliedToDeductibleMicros)),
        },
        fired: true,
        detail: `${formatCents(toCents(appliedToDeductibleMicros))} of the ${formatCents(plan.deductibleIndividual)} deductible has not been met, so the member pays that much of this fill themselves. ${formatCents(accumulators.deductibleAccumulatedCents)} was met before today.`,
        sourceDocumentId: SRC_COC,
        citation: "Certificate of Coverage 2026, High Deductible Health Plan deductible.",
      });
    }
  }

  // --- Copay or coinsurance ------------------------------------------------
  let costShareMicros = 0;
  let cappedBy: CostShareResult["cappedBy"];

  if (rule.costShareType === "Copay") {
    costShareMicros = Math.min(fromCents(rule.copayCents ?? 0), remainingMicros);
    if (costShareMicros === remainingMicros && remainingMicros < fromCents(rule.copayCents ?? 0)) {
      cappedBy = "total-allowed";
    }
    trace.cited({
      ruleId: "costshare.copay",
      stage: "costshare",
      question: "What is the member's copay at this level?",
      inputs: { level, channel, copay: formatCents(rule.copayCents ?? 0) },
      output: { costShare: formatCents(toCents(costShareMicros)) },
      fired: true,
      detail:
        cappedBy === "total-allowed"
          ? `The copay is ${formatCents(rule.copayCents ?? 0)}, but the member never pays more than the total cost of the fill, so they pay ${formatCents(toCents(costShareMicros))}.`
          : `Level ${level} copay of ${formatCents(rule.copayCents ?? 0)}.`,
      sourceDocumentId: SRC_COC,
      citation: rule.citation ?? `Certificate of Coverage 2026, Level ${level}.`,
    });
  } else if (rule.costShareType === "Coinsurance") {
    const raw = applyBps(remainingMicros, rule.coinsuranceRateBps ?? 0);
    const maxMicros = rule.coinsuranceMaxCents
      ? fromCents(rule.coinsuranceMaxCents)
      : Number.MAX_SAFE_INTEGER;
    costShareMicros = Math.min(raw, maxMicros, remainingMicros);
    if (costShareMicros === maxMicros && raw > maxMicros) cappedBy = "coinsurance-max";

    trace.cited({
      ruleId: "costshare.coinsurance",
      stage: "costshare",
      question: "What is the member's coinsurance at this level?",
      inputs: {
        level,
        rate: `${((rule.coinsuranceRateBps ?? 0) / 100).toFixed(0)}%`,
        appliedTo: formatCents(toCents(remainingMicros)),
        maximum: rule.coinsuranceMaxCents ? formatCents(rule.coinsuranceMaxCents) : null,
      },
      output: { costShare: formatCents(toCents(costShareMicros)) },
      fired: true,
      detail:
        cappedBy === "coinsurance-max"
          ? `${((rule.coinsuranceRateBps ?? 0) / 100).toFixed(0)}% of ${formatCents(toCents(remainingMicros))} is ${formatCents(toCents(raw))}, which exceeds the ${formatCents(rule.coinsuranceMaxCents ?? 0)} per-fill maximum, so the member pays ${formatCents(toCents(costShareMicros))}.`
          : `${((rule.coinsuranceRateBps ?? 0) / 100).toFixed(0)}% of ${formatCents(toCents(remainingMicros))}.`,
      sourceDocumentId: SRC_COC,
      citation: rule.citation ?? `Certificate of Coverage 2026, Level ${level}.`,
    });
  }

  // --- DAW 1 brand selection penalty ---------------------------------------
  let brandPenaltyMicros = 0;
  if (
    plan.dawPenaltyEnabled &&
    dawCode === "1" &&
    brandGeneric === "Brand" &&
    genericReferenceMicros > 0 &&
    totalAllowedMicros > genericReferenceMicros
  ) {
    brandPenaltyMicros = subtract(totalAllowedMicros, genericReferenceMicros);
    trace.cited({
      ruleId: "costshare.daw-penalty",
      stage: "costshare",
      question: "Does the brand selection penalty apply?",
      inputs: {
        dawCode,
        brandCost: formatCents(toCents(totalAllowedMicros)),
        genericCost: formatCents(toCents(genericReferenceMicros)),
      },
      output: { penalty: formatCents(toCents(brandPenaltyMicros)) },
      fired: true,
      detail: `Dispense as written was requested. The member pays coinsurance plus the ${formatCents(toCents(brandPenaltyMicros))} difference between the brand and the generic, unless a MedWatch form is on file with Navitus.`,
      sourceDocumentId: SRC_COC,
      citation:
        "Certificate of Coverage 2026: for Level 3 Dispense as Written drugs the member pays 40% coinsurance plus the brand/generic cost difference unless a one-time FDA MedWatch form is on file.",
    });
  }

  /*
   * What the member owes: the part of the fill that fell inside an unmet
   * deductible, plus cost share on whatever was left, plus any brand penalty.
   *
   * The deductible term is the point. A deductible is the amount the member
   * pays before the plan starts paying; leaving it out of member liability —
   * as this function did until it was measured — produces a plan that pays the
   * deductible on the member's behalf and then reports the member as having met
   * it. Across this book that was $11.9m of member responsibility moved to the
   * plan on 204,966 fills, every one of them tracing to a deductible the
   * certificate says is $1,700. The arithmetic was self-consistent, which is
   * why it survived: the accumulator was credited with the same amount nobody
   * had paid.
   */
  let patientPayMicros = add(
    appliedToDeductibleMicros,
    add(costShareMicros, brandPenaltyMicros),
  );

  // --- Out-of-pocket limits ------------------------------------------------
  // Wisconsin runs two limits with different eligibility. Level 1 and 2 cost
  // share reaches the Rx limit; Level 3 and 4 reaches only the federal maximum.
  if (rule.accumulatesToRxOop) {
    const rxRemaining = Math.max(
      0,
      fromCents(plan.rxOopLimitIndividual) -
        fromCents(accumulators.rxOopAccumulatedCents),
    );
    if (patientPayMicros > rxRemaining) {
      trace.cited({
        ruleId: "costshare.rx-oop-cap",
        stage: "costshare",
        question: "Has the member reached the prescription out-of-pocket limit?",
        inputs: {
          limit: formatCents(plan.rxOopLimitIndividual),
          alreadyPaid: formatCents(accumulators.rxOopAccumulatedCents),
          calculatedCostShare: formatCents(toCents(patientPayMicros)),
        },
        output: { capped: formatCents(toCents(rxRemaining)) },
        fired: true,
        detail: `The member has ${formatCents(toCents(rxRemaining))} left before reaching the ${formatCents(plan.rxOopLimitIndividual)} prescription out-of-pocket limit, so cost share is capped there.`,
        sourceDocumentId: SRC_COC,
        citation:
          "Certificate of Coverage 2026: Level 1 and 2 out-of-pocket limit, $600 individual and $1,200 family.",
      });
      patientPayMicros = rxRemaining;
      cappedBy = "rx-oop";
    }
    deltas.push({ accumulatorType: "RxOopIndividual", amountMicros: patientPayMicros });
  } else {
    trace.cited({
      ruleId: "costshare.oop-eligibility",
      stage: "costshare",
      question: "Does this cost share count toward the prescription out-of-pocket limit?",
      inputs: { level },
      output: { countsTowardRxOop: false, countsTowardFederalOop: true },
      fired: true,
      detail: `Level ${level} cost share does not apply to the $${(plan.rxOopLimitIndividual / 100).toLocaleString()} prescription out-of-pocket limit. It counts only toward the federal maximum out-of-pocket.`,
      sourceDocumentId: SRC_COC,
      citation:
        "Certificate of Coverage 2026: Level 3 and 4 cost share applies only to the federal maximum out-of-pocket limit.",
    });
  }

  if (rule.accumulatesToFederalOop) {
    const fedRemaining = Math.max(
      0,
      fromCents(plan.federalOopLimitIndividual) -
        fromCents(accumulators.federalOopAccumulatedCents),
    );
    if (patientPayMicros > fedRemaining) {
      patientPayMicros = fedRemaining;
      cappedBy = "federal-oop";
    }
    deltas.push({
      accumulatorType: "FederalOopIndividual",
      amountMicros: patientPayMicros,
    });
  }

  // The member never pays more than the fill costs.
  if (patientPayMicros > totalAllowedMicros) {
    patientPayMicros = totalAllowedMicros;
    cappedBy = "total-allowed";
  }

  /*
   * A deductible is only met by money the member actually paid. When an
   * out-of-pocket limit cuts their liability below the amount that fell inside
   * the deductible, the credit has to be cut with it, or the ledger records
   * progress toward a deductible out of funds nobody spent — the same error as
   * charging the deductible to the plan, one step further down.
   */
  if (patientPayMicros < appliedToDeductibleMicros) {
    appliedToDeductibleMicros = patientPayMicros;
    const d = deltas.find((x) => x.accumulatorType === "DeductibleIndividual");
    if (d) d.amountMicros = patientPayMicros;
  }

  return {
    patientPayMicros,
    appliedToDeductibleMicros,
    copayCoinsuranceMicros: costShareMicros,
    brandSelectionPenaltyMicros: brandPenaltyMicros,
    accumulatorDeltas: deltas,
    cappedBy,
  };
}

// ---------------------------------------------------------------------------

interface RebateArgs {
  trace: TraceBuilder;
  contract: EngineContract;
  rate: EngineRate;
  brandGeneric: BrandGeneric;
  channel: Channel;
  drugName: string;
  is340B: boolean;
  pharmacyType: string;
  totalAllowedMicros: Micros;
  patientPayMicros: Micros;
}

function computeRebate(args: RebateArgs): {
  eligible: boolean;
  exclusionReason?: string;
  amountCents: Cents;
} {
  const {
    trace,
    contract,
    rate,
    brandGeneric,
    drugName,
    is340B,
    pharmacyType,
    totalAllowedMicros,
    patientPayMicros,
  } = args;

  if (brandGeneric !== "Brand") {
    return { eligible: false, exclusionReason: "Generic claim", amountCents: 0 };
  }

  // Exhibit C rebate exclusions, evaluated as named predicates.
  const exclusions: Array<[string, boolean, string]> = [
    ["340b", is340B, "340B claim"],
    ["long-term-care", pharmacyType === "LTC", "Long term care pharmacy"],
    [
      "brand-synthroid",
      /synthroid/i.test(drugName),
      "Brand Synthroid is removed from the rebate calculation",
    ],
  ];

  // "In the event a member pays greater than 50% of the cost of the claim, the
  // plan may not be eligible for that claim's rebates."
  const memberShareBps =
    totalAllowedMicros > 0
      ? Math.round((patientPayMicros / totalAllowedMicros) * 10_000)
      : 0;
  exclusions.push([
    "member-share-over-50pct",
    memberShareBps > contract.rebateMemberShareThresholdBps,
    `Member paid ${(memberShareBps / 100).toFixed(1)}% of the claim, above the ${(contract.rebateMemberShareThresholdBps / 100).toFixed(0)}% threshold`,
  ]);

  const hit = exclusions.find(([, triggered]) => triggered);
  if (hit) {
    trace.cited({
      ruleId: `rebate.exclusion.${hit[0]}`,
      stage: "rebate",
      question: "Does this brand claim qualify for a manufacturer rebate?",
      inputs: { rule: hit[0], memberSharePct: (memberShareBps / 100).toFixed(1) },
      output: { eligible: false },
      fired: true,
      detail: `Not rebate eligible: ${hit[2]}.`,
      sourceDocumentId: SRC_EXHIBIT_C,
      citation:
        hit[0] === "member-share-over-50pct"
          ? "Exhibit C rebate footnote: in the event a member pays greater than 50% of the cost of the claim, the plan may not be eligible for that claim's rebates."
          : "Exhibit C rebate footnote, exclusions.",
    });
    return { eligible: false, exclusionReason: hit[2], amountCents: 0 };
  }

  const guarantee = rate.minRebatePerBrandClaimCents ?? 0;

  trace.cited({
    ruleId: "rebate.guarantee",
    stage: "rebate",
    question: "What rebate does this brand claim earn for the plan?",
    inputs: {
      channel: args.channel,
      minimumGuarantee: formatCents(guarantee),
      passThrough: `${(contract.rebatePassThroughBps / 100).toFixed(0)}%`,
    },
    output: {
      rebateToPlan: formatCents(
        toCents(applyBps(fromCents(guarantee), contract.rebatePassThroughBps)),
      ),
    },
    fired: true,
    detail:
      contract.rebatePassThroughBps === 10_000
        ? `Exhibit C guarantees a minimum of ${formatCents(guarantee)} per qualifying brand claim in this channel, and 100% of collected rebates pass to the plan.`
        : `The contract guarantees a minimum of ${formatCents(guarantee)} per brand claim. Amounts collected above the guarantee are retained by the PBM.`,
    sourceDocumentId: SRC_EXHIBIT_C,
    citation: `Exhibit C, minimum rebate per brand claim, ${args.channel}.`,
  });

  return { eligible: true, amountCents: guarantee };
}

// ---------------------------------------------------------------------------

function evaluateDiscountExclusion(
  contract: EngineContract,
  pharmacy: EnginePharmacy,
  request: ClaimRequest,
): string | null {
  if (pharmacy.is340B && contract.discountExclusions.includes("340b")) {
    return "340B claim";
  }
  if (
    pharmacy.pharmacyType === "LTC" &&
    contract.discountExclusions.includes("long-term-care")
  ) {
    return "Long term care pharmacy";
  }
  if (
    request.compoundCode === "2" &&
    contract.discountExclusions.includes("compound")
  ) {
    return "Compound claim";
  }
  return null;
}
