/**
 * Wisconsin ETF / Navitus contract ETG0013, encoded as data.
 *
 * Rates come from Exhibit C, "Guaranteed Pricing Terms: January 1, 2019 –
 * December 31, 2019", attached to Amendment #1. That is the only complete
 * published rate card for this contract; Exhibits D and E are referenced in
 * the order of precedence but their amendment PDFs are image-only cover pages.
 *
 * The footnotes below the rate table matter as much as the table, because they
 * are the adjudication edge cases. They are encoded as first-class predicates
 * rather than prose.
 */

import { fromDollars, toCents } from "@/lib/money";

export const WISCONSIN_CONTRACT_ID = "etg0013";

export interface RateRow {
  lineOfBusiness: "Commercial" | "EGWP";
  channel: "Retail" | "Retail90" | "Mail" | "Specialty";
  drugClass: "Brand" | "Generic" | "All";
  awpDiscountBps: number;
  dispensingFeeCents: number;
  minRebatePerBrandClaimCents?: number;
}

const d = (dollars: number) => toCents(fromDollars(dollars));

/** Exhibit C, verbatim. Percentages converted to basis points. */
export const EXHIBIT_C_RATES: RateRow[] = [
  // ---- Commercial ----
  {
    lineOfBusiness: "Commercial",
    channel: "Retail",
    drugClass: "Brand",
    awpDiscountBps: 1820, // 18.20%
    dispensingFeeCents: d(0.9),
    minRebatePerBrandClaimCents: d(100),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail",
    drugClass: "Generic",
    awpDiscountBps: 8300, // 83.00%
    dispensingFeeCents: d(0.9),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail90",
    drugClass: "Brand",
    awpDiscountBps: 2200, // 22.00%
    dispensingFeeCents: 0,
    minRebatePerBrandClaimCents: d(210),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Retail90",
    drugClass: "Generic",
    awpDiscountBps: 8750, // 87.50%
    dispensingFeeCents: 0,
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Mail",
    drugClass: "Brand",
    awpDiscountBps: 2300, // 23.00%
    dispensingFeeCents: 0,
    minRebatePerBrandClaimCents: d(260),
  },
  {
    lineOfBusiness: "Commercial",
    channel: "Mail",
    drugClass: "Generic",
    awpDiscountBps: 8700, // 87.00%
    dispensingFeeCents: 0,
  },
  {
    // Exhibit C: specialty guarantees are aggregate across brand and generic.
    lineOfBusiness: "Commercial",
    channel: "Specialty",
    drugClass: "All",
    awpDiscountBps: 1835, // 18.35%
    dispensingFeeCents: 0,
    minRebatePerBrandClaimCents: d(750),
  },

  // ---- EGWP ----
  {
    lineOfBusiness: "EGWP",
    channel: "Retail",
    drugClass: "Brand",
    awpDiscountBps: 1760,
    dispensingFeeCents: d(0.98),
    minRebatePerBrandClaimCents: d(90),
  },
  {
    lineOfBusiness: "EGWP",
    channel: "Retail",
    drugClass: "Generic",
    awpDiscountBps: 8250,
    dispensingFeeCents: d(0.98),
  },
  {
    lineOfBusiness: "EGWP",
    channel: "Retail90",
    drugClass: "Brand",
    awpDiscountBps: 2100,
    dispensingFeeCents: 0,
    minRebatePerBrandClaimCents: d(200),
  },
  {
    lineOfBusiness: "EGWP",
    channel: "Retail90",
    drugClass: "Generic",
    awpDiscountBps: 8700,
    dispensingFeeCents: 0,
  },
  {
    lineOfBusiness: "EGWP",
    channel: "Mail",
    drugClass: "Brand",
    awpDiscountBps: 2300,
    dispensingFeeCents: 0,
    minRebatePerBrandClaimCents: d(200),
  },
  {
    lineOfBusiness: "EGWP",
    channel: "Mail",
    drugClass: "Generic",
    awpDiscountBps: 8700,
    dispensingFeeCents: 0,
  },
  {
    lineOfBusiness: "EGWP",
    channel: "Specialty",
    drugClass: "All",
    awpDiscountBps: 1835,
    dispensingFeeCents: 0,
    minRebatePerBrandClaimCents: d(475),
  },
];

export const WISCONSIN_CONTRACT = {
  id: WISCONSIN_CONTRACT_ID,
  name: "Contract ETG0013",
  pbmName: "Navitus Health Solutions",
  sponsorName: "State of Wisconsin Department of Employee Trust Funds",
  model: "PassThrough" as const,
  effectiveDate: new Date("2019-01-01T00:00:00Z"),

  adminFeePmpmCommercialCents: d(2.1),
  adminFeePmpmEgwpCents: d(10.88),

  /// Amendment 5A: "$0.40 PMPM will be collected as a Rebate administration
  /// fee from the Rebates collected before being passed back to Department."
  rebateAdminFeePmpmCents: d(0.4),
  rebatePassThroughBps: 10_000,

  /// Exhibit C footnote: "Retail is defined as 1-83 Days' Supply. Retail 90 is
  /// defined as 84+ Days' Supply."
  retailMaxDaysSupply: 83,

  /// Exhibit C footnote: "For the applicable guarantees to be in effect, a
  /// minimum of 1,000 claims for a category is required in a reporting period."
  minClaimsPerCategory: 1000,

  /// Exhibit C footnote, discount exclusions.
  discountExclusions: [
    "long-term-care",
    "home-infusion",
    "military",
    "indian-tribal",
    "compound",
    "secondary",
    "340b",
    "vaccination",
    "member-submitted",
  ],

  /// Exhibit C footnote, rebate exclusions.
  rebateExclusions: [
    "340b",
    "long-term-care",
    "hospital",
    "fss",
    "gpo-priced",
    "vaccine",
    "medical-device",
    "generically-named",
    "compound",
    "otc-non-diabetic-test-strip",
    "member-share-over-50pct",
    "hiv-transplant-specialty",
    "brand-synthroid",
  ],

  /// "In the event a member pays greater than 50% of the cost of the claim,
  /// the plan may not be eligible for that claim's rebates."
  rebateMemberShareThresholdBps: 5000,

  notes:
    "Pass-through contract. The plan is billed exactly what the pharmacy is paid; the engine enforces this as an invariant.",
};

/**
 * Exhibit C footnotes, kept as citable text so the UI can show the exact
 * language behind a rule that fired.
 */
export const EXHIBIT_C_FOOTNOTES: Record<string, string> = {
  "pricing-source":
    "AWP/WAC pricing for all claims is based on the 11-digit National Drug Code (NDC) as of the date of service, and as reported and verifiable by Medi-Span, a national pricing source. Medi-Span is Navitus' only source of drug pricing data and is utilized for all claims adjudication.",
  "minimum-claims":
    "For the applicable guarantees to be in effect, a minimum of 1,000 claims for a category is required in a reporting period.",
  "channel-definition":
    "Retail is defined as 1-83 Days' Supply. Retail 90 is defined as 84+ Days' Supply.",
  "network-scope":
    "Commercial discount and dispensing fee guarantees are applicable only to the NaviCare Limited Network implemented on 1/1/2018. At no time will more than 80% of pharmacies eligible to participate in the NaviCare Broad Network be allowed to participate in the ETF specific NaviCare Limited Network.",
  "discount-exclusions":
    "Network discounts and fees may exclude claims that originate from non-traditional providers, such as long term care pharmacies, home infusion providers, military pharmacies, Indian Tribal pharmacies... Additional exclusions from retail network discounts include compound, secondary, 340B, vaccination, pharmaceutical care incentive (PCI), and member-submitted claims.",
  "rebate-exclusions":
    "Excludes any claims for which Navitus is unable to submit and collect rebates (e.g., 340B, Long Term Care facilities, Hospital pharmacies, FSS pharmacies, GPO pricing). Per claim guarantees do not include vaccines, medical devices, generically named products, compounded prescriptions and non-legend drugs designated as over-the-counter (OTC) excluding diabetic test strips.",
  "rebate-member-share":
    "In the event a member pays greater than 50% of the cost of the claim, the plan may not be eligible for that claim's rebates.",
  "rebate-specialty-carveout":
    "Specialty minimum rebate guarantees are defined by the specialty drug regardless of channel used and exclude HIV/Transplant medications.",
  "rebate-synthroid":
    "Brand Synthroid is removed from the calculation due to the lower net cost available to ETF.",
  "specialty-network":
    "Dispensed through the exclusive Wisconsin based network of Lumicera and UW Health Services only, and Diplomat as the limited distribution wrap pharmacy. Anything outside that network is passed through at 100% of the contracted rate with the specialty pharmacy provider with no mark-up or spread.",
  "gpo-admin-fee":
    "$0.40 PMPM will be collected as a Rebate administration fee from the Rebates collected before being passed back to Department.",
};

/**
 * 2026 benefit design, from the Uniform Pharmacy Benefits Certificate of
 * Coverage.
 *
 * The subtle rule, and the best correctness test in the whole build: Level 1
 * and 2 cost share accumulates to the $600 / $1,200 Rx out-of-pocket limit,
 * but Level 3 and 4 coinsurance does not. It reaches only the federal maximum.
 */
export const WISCONSIN_BENEFIT_2026 = {
  iyc: {
    id: "wi-iyc-2026",
    name: "IYC Health Plan",
    lineOfBusiness: "Commercial" as const,
    planYear: 2026,
    deductibleIndividual: 0,
    deductibleFamily: 0,
    deductibleIntegratedWithMedical: false,
    rxOopLimitIndividual: d(600),
    rxOopLimitFamily: d(1200),
    federalOopLimitIndividual: d(10_600),
    federalOopLimitFamily: d(21_200),
    rxOopEligibleLevels: [1, 2],
  },
  hdhp: {
    id: "wi-hdhp-2026",
    name: "High Deductible Health Plan",
    lineOfBusiness: "Commercial" as const,
    planYear: 2026,
    deductibleIndividual: d(1700),
    deductibleFamily: d(3400),
    deductibleIntegratedWithMedical: true,
    rxOopLimitIndividual: d(2500),
    rxOopLimitFamily: d(5000),
    federalOopLimitIndividual: d(2500),
    federalOopLimitFamily: d(5000),
    rxOopEligibleLevels: [1, 2, 3, 4],
  },
};

export interface CostShareDefinition {
  level: string;
  channel: "Retail" | "Retail90" | "Mail" | "Specialty";
  costShareType: "Copay" | "Coinsurance" | "NotCovered" | "Zero";
  copayCents?: number;
  coinsuranceRateBps?: number;
  coinsuranceMaxCents?: number;
  accumulatesToRxOop: boolean;
  accumulatesToFederalOop: boolean;
  citation: string;
}

/** Cost share for the IYC plan, all channels. */
export function iycCostShareRules(): CostShareDefinition[] {
  const rules: CostShareDefinition[] = [];
  const channels = ["Retail", "Retail90", "Mail", "Specialty"] as const;

  for (const channel of channels) {
    // Retail 90 is three copays, mail is two, per the Certificate of Coverage.
    const multiplier = channel === "Retail90" ? 3 : channel === "Mail" ? 2 : 1;

    rules.push({
      level: "1",
      channel,
      costShareType: "Copay",
      copayCents: d(5) * multiplier,
      accumulatesToRxOop: true,
      accumulatesToFederalOop: true,
      citation: "Certificate of Coverage 2026, Level 1: $5 or less",
    });
    rules.push({
      level: "2",
      channel,
      costShareType: "Coinsurance",
      coinsuranceRateBps: 2000,
      coinsuranceMaxCents: d(50) * multiplier,
      accumulatesToRxOop: true,
      accumulatesToFederalOop: true,
      citation: "Certificate of Coverage 2026, Level 2: 20% with $50 maximum",
    });
    rules.push({
      level: "3",
      channel,
      costShareType: "Coinsurance",
      coinsuranceRateBps: 4000,
      coinsuranceMaxCents: d(150) * multiplier,
      // The asymmetry. Level 3 does not reach the Rx out-of-pocket limit.
      accumulatesToRxOop: false,
      accumulatesToFederalOop: true,
      citation:
        "Certificate of Coverage 2026, Level 3: 40% with $150 maximum. Level 3 and 4 cost share does not apply to the Level 1 and 2 out-of-pocket limit.",
    });
    rules.push({
      level: "4",
      channel,
      costShareType: "Copay",
      copayCents: d(50),
      accumulatesToRxOop: false,
      accumulatesToFederalOop: true,
      citation:
        "Certificate of Coverage 2026, Level 4: $50 copay. Level 3 and 4 cost share does not apply to the Level 1 and 2 out-of-pocket limit.",
    });
    rules.push({
      level: "$0",
      channel,
      costShareType: "Zero",
      copayCents: 0,
      accumulatesToRxOop: false,
      accumulatesToFederalOop: false,
      citation:
        "Certificate of Coverage 2026, preventive drugs: $0, plan pays 100%.",
    });
    rules.push({
      level: "100%/EX",
      channel,
      costShareType: "NotCovered",
      accumulatesToRxOop: false,
      accumulatesToFederalOop: false,
      citation:
        "Certificate of Coverage 2026 excludes any treatment or supplies for weight reduction including FDA medications approved for weight loss. These appear on the Discount Drug List at 100% member cost and do not count toward any out-of-pocket limit.",
    });
    rules.push({
      level: "NC",
      channel,
      costShareType: "NotCovered",
      accumulatesToRxOop: false,
      accumulatesToFederalOop: false,
      citation: "Certificate of Coverage 2026, not covered.",
    });
  }

  return rules;
}
