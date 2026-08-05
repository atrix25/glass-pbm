import type { Cents, Micros } from "@/lib/money";

export type Channel = "Retail" | "Retail90" | "Mail" | "Specialty";
export type BrandGeneric = "Brand" | "Generic";
export type PipelineStage =
  | "eligibility"
  | "coverage"
  | "um"
  | "pricing"
  | "costshare"
  | "rebate"
  | "pa";

/** Which arm of the lesser-of won. Maps to NCPDP 522-FM. */
export type PricingArm =
  | "AWP_MINUS"
  | "MAC"
  | "NADAC"
  | "UANDC"
  | "SUBMITTED";

/** NCPDP 522-FM basis of reimbursement determination codes. */
export const BASIS_OF_REIMBURSEMENT: Record<PricingArm, string> = {
  AWP_MINUS: "3", // Ingredient cost reduced to AWP less X% pricing
  MAC: "7", // MAC pricing
  NADAC: "20", // National Average Drug Acquisition Cost
  UANDC: "5", // Lower of Usual & Customary
  SUBMITTED: "1", // Ingredient cost paid as submitted
};

export const PRICING_ARM_LABEL: Record<PricingArm, string> = {
  AWP_MINUS: "AWP discount",
  MAC: "MAC ceiling",
  NADAC: "NADAC acquisition cost",
  UANDC: "Pharmacy usual & customary",
  SUBMITTED: "Submitted ingredient cost",
};

export interface TraceStepInput {
  ruleId: string;
  stage: PipelineStage;
  question: string;
  inputs: Record<string, unknown>;
  output: unknown;
  fired: boolean;
  detail?: string;
  sourceDocumentId?: string;
  citation?: string;
}

export interface ClaimRequest {
  /** NCPDP 401-D1 */
  dateOfService: Date;
  /** NCPDP 302-C2 */
  cardholderId: string;
  /** NCPDP 303-C3 */
  personCode: string;
  /** NCPDP 201-B1, pharmacy NPI */
  serviceProviderId: string;
  /** NCPDP 407-D7, 11-digit NDC */
  productServiceId: string;
  /** NCPDP 402-D2 */
  rxNumber: string;
  /** NCPDP 403-D3 */
  fillNumber: number;
  /** NCPDP 442-E7 */
  quantityDispensed: number;
  /** NCPDP 405-D5 */
  daysSupply: number;
  /** NCPDP 408-D8 */
  dawCode: string;
  /** NCPDP 411-DB */
  prescriberNpi?: string;
  /** NCPDP 426-DQ, the pharmacy's cash price */
  usualAndCustomaryCents: Cents;
  /** NCPDP 409-D9 */
  ingredientCostSubmittedCents?: Cents;
  /** NCPDP 406-D6 */
  compoundCode?: string;
  /** NCPDP 462-EV */
  priorAuthNumber?: string;
  /**
   * NCPDP 418-DK. Value "3" is Emergency, which is how a pharmacy asks for the
   * weekend and holiday emergency supply rather than the plan inferring it.
   */
  levelOfService?: string;
  transactionCode?: "B1" | "B2" | "B3";
}

export interface PricedArm {
  arm: PricingArm;
  /** Ingredient cost only, before the dispensing fee. */
  ingredientCostMicros: Micros;
  /** Undefined when the arm does not apply to this claim. */
  applicable: boolean;
  reason?: string;
}

export interface PricingResult {
  arms: PricedArm[];
  winningArm: PricingArm;
  allowedIngredientCostMicros: Micros;
  dispensingFeeMicros: Micros;
  totalAllowedMicros: Micros;
  basisOfReimbursement: string;
  /** True when the AWP arm was involved, meaning the figure depends on a
   *  benchmark the plan sponsor cannot independently verify. */
  dependsOnSimulatedAwp: boolean;
}

export interface CostShareResult {
  patientPayMicros: Micros;
  appliedToDeductibleMicros: Micros;
  copayCoinsuranceMicros: Micros;
  brandSelectionPenaltyMicros: Micros;
  accumulatorDeltas: AccumulatorDelta[];
  cappedBy?: "rx-oop" | "federal-oop" | "total-allowed" | "coinsurance-max";
}

export interface AccumulatorDelta {
  accumulatorType: string;
  amountMicros: Micros;
}

export type RejectCode =
  | "52" // Non-matched cardholder ID
  | "65" // Patient is not covered
  | "67" // Filled before coverage effective
  | "68" // Filled after coverage expired
  | "69" // Filled after coverage terminated
  | "70" // Product/service not covered, plan benefit exclusion
  | "75" // Prior authorization required
  | "76" // Plan limitations exceeded
  | "79" // Refill too soon
  | "80" // Drug-diagnosis mismatch
  | "40" // Pharmacy not contracted with plan on date of service
  | "608" // Step therapy required
  | "MR" // Product not on formulary
  | "608A"; // placeholder to keep the union open

export const REJECT_MESSAGES: Record<string, string> = {
  "40": "Pharmacy Not Contracted With Plan On Date Of Service",
  "52": "Non-Matched Cardholder ID",
  "65": "Patient Is Not Covered",
  "67": "Filled Before Coverage Effective",
  "68": "Filled After Coverage Expired",
  "69": "Filled After Coverage Terminated",
  "70": "Product/Service Not Covered - Plan/Benefit Exclusion",
  "75": "Prior Authorization Required",
  "76": "Plan Limitations Exceeded",
  "79": "Refill Too Soon",
  "80": "Drug-Diagnosis Mismatch",
  "608": "Step Therapy, Alternate Drug Therapy Required Prior To Use Of Submitted Product",
  MR: "Product Not On Formulary",
};

/** Plain-language explanations the member service agent reads from. */
export const REJECT_MEMBER_EXPLANATION: Record<string, string> = {
  "40": "This pharmacy is not in your plan's network on this date. Filling at an in-network pharmacy will let the claim pay.",
  "52": "We could not match the member ID submitted by the pharmacy to an enrollment record.",
  "65": "This person is not currently covered under the plan on the fill date.",
  "67": "The fill date is before coverage started.",
  "68": "The fill date is after coverage ended.",
  "69": "Coverage was terminated before this fill date.",
  "70": "This drug is excluded from the pharmacy benefit under the plan's Certificate of Coverage, so it cannot be covered at any level.",
  "75": "This drug needs prior authorization. A prescriber has to confirm the clinical criteria before the plan can pay.",
  "76": "This fill is over the plan's quantity limit for this drug.",
  "79": "It is too early for a refill based on the days supply of the previous fill.",
  "80": "This drug is only covered for specific diagnoses, and we do not have a qualifying diagnosis on file.",
  "608": "The plan requires trying a preferred alternative first.",
  MR: "This drug is not on the plan's formulary.",
};

export interface AdjudicationOutcome {
  responseStatus: "P" | "R";
  rejectCodes: string[];
  rejectMessage?: string;

  channel: Channel;
  brandGeneric: BrandGeneric;
  formularyLevel?: string;
  isSpecialtyClaim: boolean;

  pricing?: PricingResult;
  clientPricing?: PricingResult;
  costShare?: CostShareResult;

  allowedIngredientCostCents: Cents;
  allowedDispensingFeeCents: Cents;
  totalAllowedCents: Cents;
  pharmacyPaidCents: Cents;
  billedIngredientCostCents: Cents;
  billedDispensingFeeCents: Cents;
  totalBilledCents: Cents;
  planPaidCents: Cents;
  patientPayCents: Cents;
  appliedToDeductibleCents: Cents;
  copayCoinsuranceCents: Cents;
  brandSelectionPenaltyCents: Cents;

  awpUnitAtDos?: number;
  awpTotalCents?: Cents;
  nadacUnitAtDos?: number;
  nadacTotalCents?: Cents;
  macUnitAtDos?: number;
  awpIsSimulated: boolean;

  excludedFromDiscountGuarantee: boolean;
  discountExclusionReason?: string;
  rebateEligible: boolean;
  rebateExclusionReason?: string;
  estimatedRebateCents: Cents;

  trace: TraceStepInput[];
}
