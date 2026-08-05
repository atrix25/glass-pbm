/**
 * The world: contracts, rate cards, benefit plans, pharmacies, networks.
 *
 * Everything here is either transcribed from a published document or is a
 * clearly labelled simulation of one.
 */

import type { PrismaClient } from "../../src/generated/prisma/index.js";
import {
  EXHIBIT_C_RATES,
  WISCONSIN_CONTRACT,
  WISCONSIN_BENEFIT_2026,
  iycCostShareRules,
} from "../../src/lib/contracts/wisconsin.js";
import {
  MICHIGAN_CLIENT_RATES,
  MICHIGAN_CONTRACT,
  MICHIGAN_PHARMACY_RATES,
  MODELED_CLIENT_MAC_MULTIPLIER,
} from "../../src/lib/contracts/michigan.js";

export const SPONSOR_ID = "steel-potatoes";
export const NETWORK_LIMITED = "navicare-limited";
export const NETWORK_SPECIALTY = "navicare-specialty";
export const FORMULARY_ID = "navitus-etf-2026";

/**
 * Exhibit C prices off AWP with a MAC ceiling, capped by the pharmacy's cash
 * price. NADAC is deliberately NOT an arm: it is a published acquisition-cost
 * benchmark, not a term of this contract. Adding it would silently cap the
 * plan at acquisition cost and make the pharmacy's margin disappear, which
 * would be a flattering fiction rather than a model of the contract. It is
 * captured on every claim so the markup over acquisition can be shown.
 */
const PASS_THROUGH_ARMS = JSON.stringify([
  "AWP_MINUS",
  "MAC",
  "UANDC",
  "SUBMITTED",
]);

/**
 * The traditional contract's client-side lesser-of deliberately omits the
 * pharmacy's usual and customary price and the NADAC floor. That omission is
 * not an oversight; it is how a plan ends up paying more than the cash price.
 */
const TRADITIONAL_CLIENT_ARMS = JSON.stringify(["AWP_MINUS", "MAC", "SUBMITTED"]);
const TRADITIONAL_PHARMACY_ARMS = JSON.stringify([
  "AWP_MINUS",
  "MAC",
  "UANDC",
  "SUBMITTED",
]);

export async function seedContracts(prisma: PrismaClient) {
  // --- Wisconsin / Navitus, pass-through -------------------------------
  await prisma.contract.upsert({
    where: { id: WISCONSIN_CONTRACT.id },
    create: {
      id: WISCONSIN_CONTRACT.id,
      name: WISCONSIN_CONTRACT.name,
      pbmName: WISCONSIN_CONTRACT.pbmName,
      sponsorName: WISCONSIN_CONTRACT.sponsorName,
      model: WISCONSIN_CONTRACT.model,
      effectiveDate: WISCONSIN_CONTRACT.effectiveDate,
      adminFeePmpmCommercialCents: WISCONSIN_CONTRACT.adminFeePmpmCommercialCents,
      adminFeePmpmEgwpCents: WISCONSIN_CONTRACT.adminFeePmpmEgwpCents,
      rebateAdminFeePmpmCents: WISCONSIN_CONTRACT.rebateAdminFeePmpmCents,
      rebatePassThroughBps: WISCONSIN_CONTRACT.rebatePassThroughBps,
      retailMaxDaysSupply: WISCONSIN_CONTRACT.retailMaxDaysSupply,
      minClaimsPerCategory: WISCONSIN_CONTRACT.minClaimsPerCategory,
      discountExclusions: JSON.stringify(WISCONSIN_CONTRACT.discountExclusions),
      rebateExclusions: JSON.stringify(WISCONSIN_CONTRACT.rebateExclusions),
      rebateMemberShareThresholdBps:
        WISCONSIN_CONTRACT.rebateMemberShareThresholdBps,
      notes: WISCONSIN_CONTRACT.notes,
    },
    update: {},
  });

  await prisma.contractRate.deleteMany({ where: { contractId: WISCONSIN_CONTRACT.id } });
  for (const r of EXHIBIT_C_RATES) {
    // Under pass-through the client row and the pharmacy row are the same
    // terms. Both are written so the invariant check has something to compare.
    for (const side of ["Pharmacy", "Client"] as const) {
      await prisma.contractRate.create({
        data: {
          contractId: WISCONSIN_CONTRACT.id,
          rateSide: side,
          lineOfBusiness: r.lineOfBusiness,
          channel: r.channel,
          drugClass: r.drugClass,
          awpDiscountBps: r.awpDiscountBps,
          dispensingFeeCents: r.dispensingFeeCents,
          lesserOfArms: PASS_THROUGH_ARMS,
          includeUandC: true,
          minRebatePerBrandClaimCents: r.minRebatePerBrandClaimCents ?? null,
          effectiveDate: new Date("2019-01-01T00:00:00Z"),
          sourceDocumentId: "etg0013-amd1-exhibit-c",
          citation: `Exhibit C, Guaranteed Pricing Terms, ${r.lineOfBusiness} ${r.channel} ${r.drugClass}: AWP less ${(r.awpDiscountBps / 100).toFixed(2)}%, dispensing fee $${(r.dispensingFeeCents / 100).toFixed(2)}${r.minRebatePerBrandClaimCents ? `, minimum rebate $${(r.minRebatePerBrandClaimCents / 100).toFixed(0)} per brand claim` : ""}.`,
        },
      });
    }
  }

  // --- Michigan / OptumRx, traditional comparator ----------------------
  await prisma.contract.upsert({
    where: { id: MICHIGAN_CONTRACT.id },
    create: {
      id: MICHIGAN_CONTRACT.id,
      name: MICHIGAN_CONTRACT.name,
      pbmName: MICHIGAN_CONTRACT.pbmName,
      sponsorName: MICHIGAN_CONTRACT.sponsorName,
      model: MICHIGAN_CONTRACT.model,
      effectiveDate: MICHIGAN_CONTRACT.effectiveDate,
      adminFeePmpmCommercialCents: MICHIGAN_CONTRACT.adminFeePmpmCommercialCents,
      adminFeePmpmEgwpCents: MICHIGAN_CONTRACT.adminFeePmpmEgwpCents,
      rebateAdminFeePmpmCents: 0,
      rebatePassThroughBps: MICHIGAN_CONTRACT.rebatePassThroughBps,
      retailMaxDaysSupply: MICHIGAN_CONTRACT.retailMaxDaysSupply,
      minClaimsPerCategory: MICHIGAN_CONTRACT.minClaimsPerCategory,
      discountExclusions: "[]",
      rebateExclusions: "[]",
      rebateMemberShareThresholdBps: 10000,
      notes: MICHIGAN_CONTRACT.notes,
    },
    update: {},
  });

  await prisma.contractRate.deleteMany({ where: { contractId: MICHIGAN_CONTRACT.id } });
  for (const r of MICHIGAN_CLIENT_RATES) {
    await prisma.contractRate.create({
      data: {
        contractId: MICHIGAN_CONTRACT.id,
        rateSide: "Client",
        lineOfBusiness: r.lineOfBusiness,
        channel: r.channel,
        drugClass: r.drugClass,
        awpDiscountBps: r.awpDiscountBps,
        dispensingFeeCents: r.dispensingFeeCents,
        lesserOfArms: TRADITIONAL_CLIENT_ARMS,
        includeUandC: false,
        minRebatePerBrandClaimCents: r.minRebatePerBrandClaimCents ?? null,
        effectiveDate: MICHIGAN_CONTRACT.effectiveDate,
        sourceDocumentId: "michigan-optumrx-scheduleb",
        citation: `Schedule B, contract year 1, ${r.channel} ${r.drugClass}: AWP less ${(r.awpDiscountBps / 100).toFixed(2)}%.`,
      },
    });
  }
  for (const r of MICHIGAN_PHARMACY_RATES) {
    await prisma.contractRate.create({
      data: {
        contractId: MICHIGAN_CONTRACT.id,
        rateSide: "Pharmacy",
        lineOfBusiness: r.lineOfBusiness,
        channel: r.channel,
        drugClass: r.drugClass,
        awpDiscountBps: r.awpDiscountBps,
        dispensingFeeCents: r.dispensingFeeCents,
        lesserOfArms: TRADITIONAL_PHARMACY_ARMS,
        includeUandC: true,
        effectiveDate: MICHIGAN_CONTRACT.effectiveDate,
        sourceDocumentId: "michigan-optumrx-scheduleb",
        citation:
          "Modeled. A PBM's pharmacy network contracts are not published, so the pharmacy side of a traditional contract has to be estimated. This is what a repricing audit does.",
      },
    });
  }

  return { clientMacMultiplier: MODELED_CLIENT_MAC_MULTIPLIER };
}

// ---------------------------------------------------------------------------

export interface PharmacySeed {
  id: string;
  npi: string;
  ncpdpId: string;
  name: string;
  chainName?: string;
  pharmacyType: "Independent" | "Chain" | "Mail" | "Specialty" | "LTC";
  city: string;
  state: string;
  zip: string;
  isDesignatedSpecialty?: boolean;
  is340B?: boolean;
  /** Weight used when picking a pharmacy for a simulated fill. */
  weight: number;
  inLimitedNetwork?: boolean;
}

export const PHARMACIES: PharmacySeed[] = [
  { id: "ph-walgreens-mad", npi: "1003819500", ncpdpId: "5528401", name: "Walgreens #4471", chainName: "Walgreens", pharmacyType: "Chain", city: "Madison", state: "WI", zip: "53703", weight: 16 },
  { id: "ph-walgreens-mke", npi: "1013918532", ncpdpId: "5529112", name: "Walgreens #2818", chainName: "Walgreens", pharmacyType: "Chain", city: "Milwaukee", state: "WI", zip: "53202", weight: 14 },
  { id: "ph-cvs-mad", npi: "1023051746", ncpdpId: "5610233", name: "CVS Pharmacy #8843", chainName: "CVS", pharmacyType: "Chain", city: "Madison", state: "WI", zip: "53711", weight: 12 },
  { id: "ph-cvs-gb", npi: "1033129318", ncpdpId: "5611884", name: "CVS Pharmacy #4102", chainName: "CVS", pharmacyType: "Chain", city: "Green Bay", state: "WI", zip: "54301", weight: 8 },
  { id: "ph-hyvee-mad", npi: "1043201457", ncpdpId: "5702118", name: "Hy-Vee Pharmacy", chainName: "Hy-Vee", pharmacyType: "Chain", city: "Madison", state: "WI", zip: "53719", weight: 9 },
  { id: "ph-picknsave", npi: "1053322049", ncpdpId: "5703347", name: "Pick 'n Save Pharmacy", chainName: "Kroger", pharmacyType: "Chain", city: "Waukesha", state: "WI", zip: "53186", weight: 8 },
  { id: "ph-meijer", npi: "1063445123", ncpdpId: "5704456", name: "Meijer Pharmacy", chainName: "Meijer", pharmacyType: "Chain", city: "Kenosha", state: "WI", zip: "53142", weight: 6 },
  { id: "ph-costco-wi", npi: "1073556234", ncpdpId: "5705562", name: "Costco Pharmacy #341", chainName: "Costco", pharmacyType: "Chain", city: "Madison", state: "WI", zip: "53718", weight: 5 },
  { id: "ph-aurora", npi: "1083667345", ncpdpId: "5706678", name: "Advocate Aurora Pharmacy", chainName: "Aurora", pharmacyType: "Chain", city: "Milwaukee", state: "WI", zip: "53215", weight: 6 },
  { id: "ph-froedtert", npi: "1093778456", ncpdpId: "5707789", name: "Froedtert Pharmacy", chainName: "Froedtert", pharmacyType: "Chain", city: "Wauwatosa", state: "WI", zip: "53226", weight: 4 },
  { id: "ph-ind-eau", npi: "1104889567", ncpdpId: "5708891", name: "Eau Claire Family Pharmacy", pharmacyType: "Independent", city: "Eau Claire", state: "WI", zip: "54701", weight: 3 },
  { id: "ph-ind-lax", npi: "1114990678", ncpdpId: "5709912", name: "La Crosse Community Drug", pharmacyType: "Independent", city: "La Crosse", state: "WI", zip: "54601", weight: 3 },
  { id: "ph-ind-osh", npi: "1125001789", ncpdpId: "5710023", name: "Oshkosh Corner Pharmacy", pharmacyType: "Independent", city: "Oshkosh", state: "WI", zip: "54901", weight: 2 },

  // Mail order
  { id: "ph-costco-mail", npi: "1135112890", ncpdpId: "5711134", name: "Costco Mail Order Pharmacy", chainName: "Costco", pharmacyType: "Mail", city: "Issaquah", state: "WA", zip: "98027", weight: 9 },

  // The two designated specialty pharmacies named in the contract.
  { id: "ph-lumicera", npi: "1146223901", ncpdpId: "5712245", name: "Lumicera Health Services", pharmacyType: "Specialty", city: "Madison", state: "WI", zip: "53717", isDesignatedSpecialty: true, weight: 7 },
  { id: "ph-uwhealth-sp", npi: "1157334012", ncpdpId: "5713356", name: "UW Health Specialty Pharmacy", pharmacyType: "Specialty", city: "Madison", state: "WI", zip: "53792", isDesignatedSpecialty: true, weight: 4 },

  // Out-of-network and excluded-channel pharmacies, used by the audit scenarios.
  { id: "ph-ltc-oakwood", npi: "1168445123", ncpdpId: "5714467", name: "Oakwood Village LTC Pharmacy", pharmacyType: "LTC", city: "Madison", state: "WI", zip: "53713", weight: 1 },
  { id: "ph-340b-clinic", npi: "1179556234", ncpdpId: "5715578", name: "Community Health 340B Pharmacy", pharmacyType: "Independent", city: "Milwaukee", state: "WI", zip: "53206", is340B: true, weight: 1 },
  { id: "ph-oon-illinois", npi: "1180667345", ncpdpId: "5716689", name: "Rockford Discount Drug", pharmacyType: "Independent", city: "Rockford", state: "IL", zip: "61101", weight: 0, inLimitedNetwork: false },
];

export async function seedPharmacies(prisma: PrismaClient) {
  await prisma.network.upsert({
    where: { id: NETWORK_LIMITED },
    create: {
      id: NETWORK_LIMITED,
      name: "NaviCare Limited Network",
      type: "Limited",
      notes:
        "Exhibit C: at no time will more than 80% of pharmacies eligible to participate in the NaviCare Broad Network be allowed to participate in the ETF specific NaviCare Limited Network. Discount and dispensing fee guarantees apply only to this network.",
    },
    update: {},
  });
  await prisma.network.upsert({
    where: { id: NETWORK_SPECIALTY },
    create: {
      id: NETWORK_SPECIALTY,
      name: "Exclusive Wisconsin Specialty Network",
      type: "Specialty",
      notes:
        "Lumicera and UW Health Services, with Diplomat as the limited distribution wrap pharmacy.",
    },
    update: {},
  });

  for (const p of PHARMACIES) {
    await prisma.pharmacy.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        npi: p.npi,
        ncpdpId: p.ncpdpId,
        name: p.name,
        chainName: p.chainName ?? null,
        pharmacyType: p.pharmacyType,
        city: p.city,
        state: p.state,
        zip: p.zip,
        is340B: p.is340B ?? false,
        isDesignatedSpecialty: p.isDesignatedSpecialty ?? false,
      },
      update: {},
    });

    if (p.inLimitedNetwork !== false) {
      await prisma.networkPharmacy.upsert({
        where: {
          networkId_pharmacyId: { networkId: NETWORK_LIMITED, pharmacyId: p.id },
        },
        create: {
          networkId: NETWORK_LIMITED,
          pharmacyId: p.id,
          status: p.isDesignatedSpecialty ? "Preferred" : "Participating",
          effectiveDate: new Date("2018-01-01T00:00:00Z"),
        },
        update: {},
      });
    }
  }
}

// ---------------------------------------------------------------------------

export async function seedSponsorAndPlans(prisma: PrismaClient) {
  await prisma.planSponsor.upsert({
    where: { id: SPONSOR_ID },
    // The employer is invented. The contract it buys on is not: Steel Potatoes
    // is priced on the Wisconsin ETF / Navitus ETG0013 rate card, which is a
    // published document, and every page that quotes a rate cites it. An
    // invented employer on real terms is the honest way to show a commercial
    // book, because the alternative is inventing the terms too.
    create: {
      id: SPONSOR_ID,
      name: "Steel Potatoes LLC",
      shortName: "Steel Potatoes",
      fundingType: "Self-insured",
      situsState: "WI",
      planYearStart: "01-01",
      pricingModel: "Pass-through",
      contractId: WISCONSIN_CONTRACT.id,
      contractName: "ETG0013",
    },
    update: {
      name: "Steel Potatoes LLC",
      shortName: "Steel Potatoes",
    },
  });

  const plans = [
    {
      ...WISCONSIN_BENEFIT_2026.iyc,
      formularyId: FORMULARY_ID,
      networkId: NETWORK_LIMITED,
    },
    {
      ...WISCONSIN_BENEFIT_2026.hdhp,
      formularyId: FORMULARY_ID,
      networkId: NETWORK_LIMITED,
    },
  ];

  for (const plan of plans) {
    await prisma.benefitPlan.upsert({
      where: { id: plan.id },
      create: {
        id: plan.id,
        sponsorId: SPONSOR_ID,
        name: plan.name,
        lineOfBusiness: plan.lineOfBusiness,
        planYear: plan.planYear,
        effectiveDate: new Date("2026-01-01T00:00:00Z"),
        formularyId: plan.formularyId,
        networkId: plan.networkId,
        deductibleIndividual: plan.deductibleIndividual,
        deductibleFamily: plan.deductibleFamily,
        deductibleIntegratedWithMedical: plan.deductibleIntegratedWithMedical,
        rxOopLimitIndividual: plan.rxOopLimitIndividual,
        rxOopLimitFamily: plan.rxOopLimitFamily,
        federalOopLimitIndividual: plan.federalOopLimitIndividual,
        federalOopLimitFamily: plan.federalOopLimitFamily,
        rxOopEligibleLevels: JSON.stringify(plan.rxOopEligibleLevels),
        dawPenaltyEnabled: true,
        specialtyChannelRestricted: true,
        specialtyPharmacyIds: JSON.stringify(["ph-lumicera", "ph-uwhealth-sp"]),
      },
      update: {},
    });

    await prisma.costShareRule.deleteMany({ where: { benefitPlanId: plan.id } });
    for (const rule of iycCostShareRules()) {
      await prisma.costShareRule.create({
        data: {
          benefitPlanId: plan.id,
          level: rule.level,
          channel: rule.channel,
          costShareType: rule.costShareType,
          copayCents: rule.copayCents ?? null,
          coinsuranceRateBps: rule.coinsuranceRateBps ?? null,
          coinsuranceMaxCents: rule.coinsuranceMaxCents ?? null,
          accumulatesToRxOop:
            plan.id === "wi-hdhp-2026" ? true : rule.accumulatesToRxOop,
          accumulatesToFederalOop: rule.accumulatesToFederalOop,
          appliesToDeductible: plan.deductibleIndividual > 0,
          sourceDocumentId: "etf-uniform-pharmacy-coc-2026",
          citation: rule.citation,
        },
      });
    }
  }
}
