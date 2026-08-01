/**
 * State of Michigan contract 220000001116 with OptumRx, encoded as the
 * traditional-PBM counterfactual.
 *
 * This is a real, published, unredacted spread contract. Schedule B gives the
 * rates the PLAN is guaranteed. What is NOT published anywhere is the rate the
 * PBM pays the pharmacy, because that lives in OptumRx's pharmacy network
 * contracts. That gap is the entire mechanism of spread.
 *
 * So the client side below is real and citable. The pharmacy side is MODELED
 * at typical retail network rates and is badged as such everywhere it appears.
 * Modeling it is exactly what a repricing audit does when a plan sponsor asks
 * "what is my incumbent actually keeping?"
 */

import { fromDollars, toCents } from "@/lib/money";
import type { RateRow } from "./wisconsin";

export const MICHIGAN_CONTRACT_ID = "mi-220000001116";

const d = (dollars: number) => toCents(fromDollars(dollars));

/**
 * Client-side rates: Schedule B, contract year 1. Published.
 */
export const MICHIGAN_CLIENT_RATES: RateRow[] = [
  {
    lineOfBusiness: "Commercial",
    channel: "Retail",
    drugClass: "Brand",
    awpDiscountBps: 1950, // 19.50%
    dispensingFeeCents: d(0.6),
    minRebatePerBrandClaimCents: d(281),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail",
    drugClass: "Generic",
    awpDiscountBps: 8650, // 86.50%
    dispensingFeeCents: d(0.6),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail90",
    drugClass: "Brand",
    awpDiscountBps: 2300, // 23.00%
    dispensingFeeCents: d(0.6),
    minRebatePerBrandClaimCents: d(635),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail90",
    drugClass: "Generic",
    awpDiscountBps: 8800, // 88.00%
    dispensingFeeCents: d(0.6),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Mail",
    drugClass: "Brand",
    awpDiscountBps: 2500, // 25.00%
    dispensingFeeCents: d(0.6),
    minRebatePerBrandClaimCents: d(835),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Mail",
    drugClass: "Generic",
    awpDiscountBps: 8875, // 88.75%
    dispensingFeeCents: d(0.6),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Specialty",
    drugClass: "All",
    awpDiscountBps: 2175, // 21.75%
    dispensingFeeCents: 0,
    minRebatePerBrandClaimCents: d(3500),
  },
];

/**
 * Pharmacy-side rates: MODELED at typical retail network terms, not published.
 *
 * The spread on generics comes primarily from the MAC arm rather than the AWP
 * arm: the PBM maintains a pharmacy MAC list and a separate, higher client MAC
 * list, and bills the difference. Modeled here as a multiplier applied to the
 * NADAC-derived MAC.
 */
export const MICHIGAN_PHARMACY_RATES: RateRow[] = [
  {
    lineOfBusiness: "Commercial",
    channel: "Retail",
    drugClass: "Brand",
    awpDiscountBps: 1800,
    dispensingFeeCents: d(1.0),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail",
    drugClass: "Generic",
    awpDiscountBps: 8500,
    dispensingFeeCents: d(1.0),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail90",
    drugClass: "Brand",
    awpDiscountBps: 2150,
    dispensingFeeCents: d(1.0),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail90",
    drugClass: "Generic",
    awpDiscountBps: 8650,
    dispensingFeeCents: d(1.0),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Mail",
    drugClass: "Brand",
    awpDiscountBps: 2400,
    dispensingFeeCents: 0,
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Mail",
    drugClass: "Generic",
    awpDiscountBps: 8750,
    dispensingFeeCents: 0,
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Specialty",
    drugClass: "All",
    awpDiscountBps: 2050,
    dispensingFeeCents: 0,
  },
];

export const MICHIGAN_CONTRACT = {
  id: MICHIGAN_CONTRACT_ID,
  name: "Contract 220000001116",
  pbmName: "OptumRx",
  sponsorName: "State of Michigan",
  model: "Traditional" as const,
  effectiveDate: new Date("2022-09-01T00:00:00Z"),

  adminFeePmpmCommercialCents: d(1.25),
  adminFeePmpmEgwpCents: d(8.4),
  rebateAdminFeePmpmCents: 0,

  /**
   * The narrow rebate definition. Under Schedule B the guarantee is a minimum
   * per brand claim, and the PBM keeps everything above it. Manufacturer
   * administrative fees, price protection, placement fees, data fees, and
   * amounts taken by the rebate aggregator sit outside the definition of the
   * word "rebate" entirely.
   */
  rebatePassThroughBps: 0,

  retailMaxDaysSupply: 83,
  minClaimsPerCategory: 1000,
  discountExclusions: [] as string[],
  rebateExclusions: [] as string[],
  rebateMemberShareThresholdBps: 10_000,

  notes:
    "Traditional spread contract. Client-side rates are published in Schedule B; pharmacy-side rates are modeled because a PBM's pharmacy network contracts are not public. The gap between the two is the spread.",
};

/**
 * The client MAC list sits above the pharmacy MAC list. This multiplier is the
 * modeled ratio between them, and is the single lever that produces generic
 * spread. Surfaced in the UI as an assumption, not buried.
 */
export const MODELED_CLIENT_MAC_MULTIPLIER = 1.75;

/**
 * Manufacturer remuneration that a narrow "rebate" definition leaves outside
 * the pass-through promise. Percentages are of WAC and are directional
 * industry values used to model the counterfactual.
 */
export const TRADITIONAL_REMUNERATION_MODEL = [
  {
    remunerationType: "BaseRebate",
    calculationBasis: "PctOfWAC",
    rateBps: 2500,
    inPlanRebateDefinition: true,
    retainedByEntity: "None",
  },
  {
    remunerationType: "AdminFee",
    calculationBasis: "PctOfWAC",
    rateBps: 450,
    inPlanRebateDefinition: false,
    retainedByEntity: "PBM",
  },
  {
    remunerationType: "FormularyPlacementFee",
    calculationBasis: "FlatPerClaim",
    flatAmountCents: d(5),
    inPlanRebateDefinition: false,
    retainedByEntity: "PBM",
  },
  {
    remunerationType: "GPOServiceFee",
    calculationBasis: "PctOfWAC",
    rateBps: 100,
    inPlanRebateDefinition: false,
    retainedByEntity: "GPO",
  },
  {
    remunerationType: "DataFee",
    calculationBasis: "FlatPerClaim",
    flatAmountCents: d(2),
    inPlanRebateDefinition: false,
    retainedByEntity: "PBM",
  },
] as const;
