/**
 * Test fixtures built from the contract constants rather than from the seeded
 * database, so a golden test states what Exhibit C says and never inherits a
 * mistake made during seeding.
 */

import type {
  AdjudicationContext,
  EngineBenefitPlan,
  EngineContract,
  EngineDrug,
  EngineFormularyEntry,
  EnginePharmacy,
} from "@/lib/engine/adjudicate";
import {
  EXHIBIT_C_RATES,
  WISCONSIN_CONTRACT,
  iycCostShareRules,
} from "@/lib/contracts/wisconsin";
import type { PricingArm } from "@/lib/engine/types";

const LESSER_OF: PricingArm[] = ["AWP_MINUS", "MAC", "UANDC", "SUBMITTED"];

export const CONTRACT: EngineContract = {
  id: WISCONSIN_CONTRACT.id,
  model: "PassThrough",
  retailMaxDaysSupply: WISCONSIN_CONTRACT.retailMaxDaysSupply,
  discountExclusions: [...WISCONSIN_CONTRACT.discountExclusions],
  rebateExclusions: [],
  rebateMemberShareThresholdBps: 5000,
  rebatePassThroughBps: WISCONSIN_CONTRACT.rebatePassThroughBps,
  rates: EXHIBIT_C_RATES.filter((r) => r.lineOfBusiness === "Commercial").map(
    (r) => ({
      channel: r.channel,
      drugClass: r.drugClass,
      awpDiscountBps: r.awpDiscountBps,
      dispensingFeeCents: r.dispensingFeeCents,
      lesserOfArms: LESSER_OF,
      includeUandC: true,
      minRebatePerBrandClaimCents: r.minRebatePerBrandClaimCents ?? null,
    }),
  ),
};

export const PLAN: EngineBenefitPlan = {
  id: "wi-iyc-2026",
  name: "It's Your Choice Health Plan",
  lineOfBusiness: "Commercial",
  deductibleIndividual: 0,
  deductibleIntegratedWithMedical: true,
  rxOopLimitIndividual: 60000,
  federalOopLimitIndividual: 1060000,
  dawPenaltyEnabled: true,
  specialtyChannelRestricted: true,
  costShareRules: iycCostShareRules().map((r) => ({
    level: r.level,
    channel: r.channel,
    costShareType: r.costShareType,
    copayCents: r.copayCents ?? null,
    coinsuranceRateBps: r.coinsuranceRateBps ?? null,
    coinsuranceMaxCents: r.coinsuranceMaxCents ?? null,
    accumulatesToRxOop: r.accumulatesToRxOop,
    accumulatesToFederalOop: r.accumulatesToFederalOop,
    citation: null,
  })),
};

export const RETAIL_PHARMACY: EnginePharmacy = {
  id: "ph-test-retail",
  npi: "1111111111",
  name: "Test Retail #1",
  pharmacyType: "Chain",
  isDesignatedSpecialty: false,
  is340B: false,
  inNetwork: true,
};

export const MAIL_PHARMACY: EnginePharmacy = {
  id: "ph-test-mail",
  npi: "2222222222",
  name: "Test Mail Order",
  pharmacyType: "Mail",
  isDesignatedSpecialty: false,
  is340B: false,
  inNetwork: true,
};

export const SPECIALTY_PHARMACY: EnginePharmacy = {
  id: "ph-test-specialty",
  npi: "3333333333",
  name: "Test Specialty",
  pharmacyType: "Specialty",
  isDesignatedSpecialty: true,
  is340B: false,
  inNetwork: true,
};

export const OON_PHARMACY: EnginePharmacy = {
  id: "ph-test-oon",
  npi: "4444444444",
  name: "Test Out of Network",
  pharmacyType: "Independent",
  isDesignatedSpecialty: false,
  is340B: false,
  inNetwork: false,
};

let ndcCounter = 0;

export function drug(over: Partial<EngineDrug> = {}): EngineDrug {
  ndcCounter += 1;
  return {
    id: `drug-test-${ndcCounter}`,
    ndc11: String(10_000_000_000 + ndcCounter),
    name: `TEST PRODUCT ${ndcCounter}`,
    monyCode: over.isBrandLabel ? "M" : "Y",
    isBrandLabel: false,
    isSpecialty: false,
    therapeuticClass: "Test class",
    nadacPerUnit: 1,
    ...over,
  };
}

export function entry(
  over: Partial<EngineFormularyEntry> = {},
): EngineFormularyEntry {
  return {
    level: "1",
    specialCode: null,
    requiresPA: false,
    requiresStep: false,
    hasQuantityLimit: false,
    diagnosisRestricted: false,
    mandatorySpecialty: false,
    notCovered: false,
    planExclusion: false,
    qlQuantity: null,
    qlDays: null,
    qlRawText: null,
    requiredDiagnosisCodes: [],
    diagnosisRawText: null,
    ...over,
  };
}

interface ContextOverrides {
  drug: EngineDrug;
  formularyEntry?: EngineFormularyEntry | null;
  pharmacy?: EnginePharmacy;
  plan?: EngineBenefitPlan;
  quantityDispensed?: number;
  daysSupply?: number;
  dateOfService?: Date;
  dawCode?: string;
  usualAndCustomaryCents?: number;
  ingredientCostSubmittedCents?: number;
  accumulators?: AdjudicationContext["accumulators"];
  priorFills?: AdjudicationContext["priorFills"];
  approvedPAs?: AdjudicationContext["approvedPAs"];
  eligibility?: AdjudicationContext["eligibility"];
  diagnosisCodes?: string[];
}

export function makeContext(o: ContextOverrides): AdjudicationContext {
  const quantity = o.quantityDispensed ?? 30;
  const nadacTotalCents = Math.round(o.drug.nadacPerUnit * quantity * 100);

  return {
    request: {
      dateOfService: o.dateOfService ?? new Date("2026-03-15T00:00:00Z"),
      cardholderId: "TEST0001",
      personCode: "01",
      serviceProviderId: (o.pharmacy ?? RETAIL_PHARMACY).npi,
      productServiceId: o.drug.ndc11,
      rxNumber: "TEST-RX",
      fillNumber: 0,
      quantityDispensed: quantity,
      daysSupply: o.daysSupply ?? 30,
      dawCode: o.dawCode ?? "0",
      // A pharmacy bills its own price and lets the processor reprice it, so
      // the default here sits well above the contract and lets the lesser-of
      // actually choose. Tests that care about the cash-price arm set it.
      usualAndCustomaryCents:
        o.usualAndCustomaryCents ?? Math.round(nadacTotalCents * 2.2) + 1000,
      ingredientCostSubmittedCents:
        o.ingredientCostSubmittedCents ?? Math.round(nadacTotalCents * 2.1) + 1000,
      compoundCode: "1",
    },
    member: {
      id: "mbr-test-0001",
      diagnosisCodes: o.diagnosisCodes ?? ["I10", "E11"],
      weightKg: 80,
    },
    eligibility:
      o.eligibility === undefined
        ? {
            id: "elig-test",
            effectiveDate: new Date("2026-01-01T00:00:00Z"),
            terminationDate: null,
            benefitPlanId: "wi-iyc-2026",
          }
        : o.eligibility,
    plan: o.plan ?? PLAN,
    drug: o.drug,
    formularyEntry: o.formularyEntry ?? entry(),
    pharmacy: o.pharmacy ?? RETAIL_PHARMACY,
    contract: CONTRACT,
    priorFills: o.priorFills ?? [],
    accumulators: o.accumulators ?? {
      rxOopAccumulatedCents: 0,
      federalOopAccumulatedCents: 0,
      deductibleAccumulatedCents: 0,
    },
    approvedPAs: o.approvedPAs ?? [],
  };
}
