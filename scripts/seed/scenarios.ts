/**
 * Scripted demonstration scenarios.
 *
 * The generated population produces realistic aggregates but leaves the
 * interesting individual cases to chance. These members exist so that a
 * specific, checkable story is always on screen: a member who hits the
 * out-of-pocket cap, a prior authorization that approves at step 7 and one
 * that denies at step 8, a claim where the pharmacy's cash price beat the
 * contract, and the handful of rejects worth explaining out loud.
 *
 * Every claim below still goes through the real engine. The scenario only
 * controls the inputs.
 */

import type { PrismaClient } from "../../src/generated/prisma/index.js";
import {
  adjudicate,
  type AdjudicationContext,
  type EngineBenefitPlan,
  type EngineContract,
  type EngineFormularyEntry,
} from "../../src/lib/engine/adjudicate.js";
import {
  evaluateQuantityLimit,
  type QuantityLimitBasis,
} from "../../src/lib/engine/quantity-limit.js";
import { determinePA, paDeadlines, type PAFacts } from "../../src/lib/pa/engine.js";
import { CRITERIA_TREES, findTreeForDrug } from "../../src/lib/pa/criteria.js";
import { PHARMACIES, SPONSOR_ID } from "./world.js";

export const DEMO_MEMBERS = [
  {
    id: "mbr-DEMO-0001-01",
    cardholderId: "W900000001",
    personCode: "01",
    firstName: "Margaret",
    lastName: "Olson",
    dateOfBirth: new Date("1961-04-18T00:00:00Z"),
    gender: "F",
    city: "Madison",
    zip: "53711",
    phone: "6085550142",
    diagnosisCodes: ["I10", "E11", "E78", "M17"],
    weightKg: 78,
    benefitPlanId: "wi-iyc-2026",
    story:
      "Four chronic conditions, reaches the prescription out-of-pocket limit in August, and takes one Level 3 drug that does not count toward it.",
  },
  {
    id: "mbr-DEMO-0002-01",
    cardholderId: "W900000002",
    personCode: "01",
    firstName: "David",
    lastName: "Krueger",
    dateOfBirth: new Date("1979-09-03T00:00:00Z"),
    gender: "M",
    city: "Milwaukee",
    zip: "53211",
    phone: "4145550188",
    diagnosisCodes: ["L40"],
    weightKg: 91,
    benefitPlanId: "wi-iyc-2026",
    story:
      "Plaque psoriasis on Skyrizi. Prior authorization approved at step 7 after a documented methotrexate trial.",
  },
  {
    id: "mbr-DEMO-0003-01",
    cardholderId: "W900000003",
    personCode: "01",
    firstName: "Jennifer",
    lastName: "Vang",
    dateOfBirth: new Date("1988-01-22T00:00:00Z"),
    gender: "F",
    city: "Green Bay",
    zip: "54301",
    phone: "9205550171",
    diagnosisCodes: ["L40"],
    weightKg: 64,
    benefitPlanId: "wi-iyc-2026",
    story:
      "Same drug, same diagnosis, denied at step 8. No trial of phototherapy, methotrexate, or acitretin, and no contraindication documented.",
  },
  {
    id: "mbr-DEMO-0004-01",
    cardholderId: "W900000004",
    personCode: "01",
    firstName: "Thomas",
    lastName: "Meyer",
    dateOfBirth: new Date("1972-06-30T00:00:00Z"),
    gender: "M",
    city: "Eau Claire",
    zip: "54701",
    phone: "7155550163",
    diagnosisCodes: ["I10", "K21"],
    weightKg: 96,
    benefitPlanId: "wi-iyc-2026",
    story:
      "The edge cases: a refill rejected as too soon, a brand chosen over an available generic, a fill at an out-of-network pharmacy, and one claim where the pharmacy's cash price came in under the contract rate.",
  },
] as const;

interface ScenarioDeps {
  planYear: number;
  contract: EngineContract;
  plans: Map<string, EngineBenefitPlan>;
}

interface DrugRow {
  id: string;
  ndc11: string;
  name: string;
  monyCode: string;
  isBrandLabel: boolean;
  isSpecialty: boolean;
  therapeuticClass: string | null;
  unitOfMeasure: string;
  packageSize: number;
  packageContainers: Record<string, number> | null;
  nadacDescription: string | null;
  nadacPerUnit: number;
  formulary: EngineFormularyEntry;
}

/**
 * Resolve a drug for a scripted scenario.
 *
 * Two things here are not incidental. Combination products are excluded from a
 * name search, because "metformin" matching KAZANO (alogliptin/metformin, not
 * covered) silently turns a scripted maintenance fill into twelve rejections.
 * And a name search prefers a product whose name *starts* with the term, so
 * the demo member on metformin is on metformin.
 */
async function loadDrug(
  prisma: PrismaClient,
  where: {
    nameContains?: string;
    level?: string;
    specialty?: boolean;
    brand?: boolean;
  },
): Promise<DrugRow | null> {
  const base = {
    ...(where.level ? { level: where.level } : {}),
    notCovered: false,
    planExclusion: false,
    drug: {
      ...(where.specialty !== undefined ? { isSpecialty: where.specialty } : {}),
      ...(where.brand !== undefined ? { isBrandLabel: where.brand } : {}),
      prices: { some: { priceType: "NADAC" as const } },
    },
  };
  const include = { drug: { include: { prices: true } } } as const;
  const orderBy = { drug: { name: "asc" as const } };

  let entry = where.nameContains
    ? await prisma.formularyEntry.findFirst({
        where: {
          ...base,
          drug: { ...base.drug, name: { startsWith: where.nameContains } },
        },
        include,
        orderBy,
      })
    : null;

  entry ??= await prisma.formularyEntry.findFirst({
    where: where.nameContains
      ? {
          ...base,
          drug: { ...base.drug, name: { contains: where.nameContains } },
        }
      : base,
    include,
    orderBy,
  });
  if (!entry) return null;
  const price = entry.drug.prices.find((p) => p.priceType === "NADAC");
  if (!price) return null;

  return {
    id: entry.drug.id,
    ndc11: entry.drug.ndc11,
    name: entry.drug.name,
    monyCode: entry.drug.monyCode,
    isBrandLabel: entry.drug.isBrandLabel,
    isSpecialty: entry.drug.isSpecialty,
    therapeuticClass: entry.drug.therapeuticClass,
    unitOfMeasure: entry.drug.unitOfMeasure,
    packageSize: entry.drug.packageSize,
    packageContainers: entry.drug.packageContainers
      ? (JSON.parse(entry.drug.packageContainers) as Record<string, number>)
      : null,
    nadacDescription: entry.drug.nadacDescription,
    nadacPerUnit: price.unitPrice,
    formulary: {
      level: entry.level,
      specialCode: entry.specialCode,
      requiresPA: entry.requiresPA,
      requiresStep: entry.requiresStep,
      hasQuantityLimit: entry.hasQuantityLimit,
      diagnosisRestricted: entry.diagnosisRestricted,
      mandatorySpecialty: entry.mandatorySpecialty,
      notCovered: entry.notCovered,
      planExclusion: entry.planExclusion,
      qlQuantity: entry.qlQuantity,
      qlDays: entry.qlDays,
      qlUnit: entry.qlUnit,
      qlBasis: entry.qlBasis,
      qlRawText: entry.qlRawText,
      requiredDiagnosisCodes: JSON.parse(entry.requiredDiagnosisCodes),
      diagnosisRawText: entry.diagnosisRawText,
    },
  };
}

export async function seedScenarios(prisma: PrismaClient, deps: ScenarioDeps) {
  const { planYear, contract, plans } = deps;
  const yearStart = Date.UTC(planYear, 0, 1);
  const day = (n: number) => new Date(yearStart + n * 86_400_000);

  // --- Members -----------------------------------------------------------
  for (const m of DEMO_MEMBERS) {
    await prisma.member.upsert({
      where: { id: m.id },
      create: {
        id: m.id,
        sponsorId: SPONSOR_ID,
        cardholderId: m.cardholderId,
        personCode: m.personCode,
        relationshipCode: "1",
        firstName: m.firstName,
        lastName: m.lastName,
        dateOfBirth: m.dateOfBirth,
        gender: m.gender,
        addressLine1: "1 Demonstration Way",
        city: m.city,
        state: "WI",
        zip: m.zip,
        phone: m.phone,
        email: `${m.firstName.toLowerCase()}.${m.lastName.toLowerCase()}@example.wi.gov`,
        diagnosisCodes: JSON.stringify(m.diagnosisCodes),
        weightKg: m.weightKg,
      },
      update: {},
    });
    await prisma.eligibilitySpan.upsert({
      where: { id: `elig-${m.id}` },
      create: {
        id: `elig-${m.id}`,
        memberId: m.id,
        benefitPlanId: m.benefitPlanId,
        effectiveDate: new Date(yearStart),
        coverageTier: "Individual",
        memberType: "Active",
      },
      update: {},
    });
  }

  // --- Drugs used by the scenarios ---------------------------------------
  const skyrizi = await loadDrug(prisma, { nameContains: "SKYRIZI" });
  const lipitorGeneric = await loadDrug(prisma, { nameContains: "atorvastatin" });
  const metformin = await loadDrug(prisma, { nameContains: "metformin" });
  // A Level 2 brand for her diabetes. At roughly $317 of acquisition cost a
  // month, 20% coinsurance clears the $50 per-fill cap every time, which is
  // what carries her to the $600 limit inside the plan year. Without a drug in
  // this band the limit is unreachable on $5 copays and the scripted story
  // would be a claim the data does not support.
  const level2Brand = await loadDrug(prisma, { nameContains: "JANUMET XR" });
  const lisinopril = await loadDrug(prisma, { nameContains: "lisinopril" });
  const level3 = await loadDrug(prisma, { level: "3", brand: true });
  const brandWithGeneric = await loadDrug(prisma, { level: "3", brand: true });
  const omeprazole = await loadDrug(prisma, { nameContains: "omeprazole" });

  const plan = plans.get("wi-iyc-2026")!;
  const walgreens = PHARMACIES.find((p) => p.id === "ph-walgreens-mad")!;
  const lumicera = PHARMACIES.find((p) => p.id === "ph-lumicera")!;
  const oon = PHARMACIES.find((p) => p.id === "ph-oon-illinois")!;

  /*
   * Numbered above the generated book rather than at a fixed offset inside
   * it. The book is sized by the population, so any fixed offset is a
   * collision waiting for the membership to grow past it.
   */
  const [{ maxSeq }] = await prisma.$queryRaw<Array<{ maxSeq: bigint | null }>>`
    SELECT MAX(CAST(SUBSTR(claimNumber, 4) AS INTEGER)) AS maxSeq FROM Claim
  `;
  let seq = Number(maxSeq ?? 0) + 1000;
  const claimRows: Parameters<typeof prisma.claim.create>[0]["data"][] = [];

  interface RunArgs {
    memberId: string;
    diagnosisCodes: string[];
    drug: DrugRow;
    pharmacy: (typeof PHARMACIES)[number];
    dateOfService: Date;
    quantity: number;
    daysSupply: number;
    dawCode?: string;
    uandcCents: number;
    priorFills?: AdjudicationContext["priorFills"];
    accumulators?: AdjudicationContext["accumulators"];
    approvedPAs?: AdjudicationContext["approvedPAs"];
    scenarioTag: string;
    rxNumber: string;
    fillNumber?: number;
  }

  const run = (args: RunArgs) => {
    const ctx: AdjudicationContext = {
      request: {
        dateOfService: args.dateOfService,
        cardholderId: "",
        personCode: "01",
        serviceProviderId: args.pharmacy.npi,
        productServiceId: args.drug.ndc11,
        rxNumber: args.rxNumber,
        fillNumber: args.fillNumber ?? 0,
        quantityDispensed: args.quantity,
        daysSupply: args.daysSupply,
        dawCode: args.dawCode ?? "0",
        usualAndCustomaryCents: args.uandcCents,
        // The pharmacy bills its own price; the processor reprices it.
        ingredientCostSubmittedCents:
          args.uandcCents > 0
            ? Math.round(args.uandcCents * 0.96)
            : Math.round(args.drug.nadacPerUnit * args.quantity * 180),
        compoundCode: "1",
      },
      member: {
        id: args.memberId,
        diagnosisCodes: args.diagnosisCodes,
        weightKg: 80,
      },
      eligibility: {
        id: `elig-${args.memberId}`,
        effectiveDate: new Date(yearStart),
        terminationDate: null,
        benefitPlanId: "wi-iyc-2026",
      },
      plan,
      drug: {
        id: args.drug.id,
        ndc11: args.drug.ndc11,
        name: args.drug.name,
        monyCode: args.drug.monyCode,
        isBrandLabel: args.drug.isBrandLabel,
        isSpecialty: args.drug.isSpecialty,
        therapeuticClass: args.drug.therapeuticClass,
        nadacPerUnit: args.drug.nadacPerUnit,
        // Carried so a scenario claim adjudicates the same way here as it does
        // when the replay engine loads it back out of the database. Omitting
        // them let the engine fall back to "billed by the each", which made a
        // quantity limit written in injections enforceable at seed time and
        // unenforceable on replay.
        unitOfMeasure: args.drug.unitOfMeasure,
        packageSize: args.drug.packageSize,
        packageContainers: args.drug.packageContainers,
      },
      formularyEntry: args.drug.formulary,
      pharmacy: {
        id: args.pharmacy.id,
        npi: args.pharmacy.npi,
        name: args.pharmacy.name,
        pharmacyType: args.pharmacy.pharmacyType,
        isDesignatedSpecialty: args.pharmacy.isDesignatedSpecialty ?? false,
        is340B: args.pharmacy.is340B ?? false,
        inNetwork: args.pharmacy.inLimitedNetwork !== false,
      },
      contract,
      priorFills: args.priorFills ?? [],
      accumulators:
        args.accumulators ?? {
          rxOopAccumulatedCents: 0,
          federalOopAccumulatedCents: 0,
          deductibleAccumulatedCents: 0,
        },
      approvedPAs: args.approvedPAs ?? [],
    };

    const o = adjudicate(ctx);
    seq++;
    claimRows.push({
      claimNumber: `CLM${String(seq).padStart(9, "0")}`,
      transactionCode: "B1",
      sponsorId: SPONSOR_ID,
      memberId: args.memberId,
      eligibilitySpanId: `elig-${args.memberId}`,
      benefitPlanId: "wi-iyc-2026",
      pharmacyId: args.pharmacy.id,
      drugId: args.drug.id,
      contractId: contract.id,
      dateOfService: args.dateOfService,
      rxNumber: args.rxNumber,
      fillNumber: args.fillNumber ?? 0,
      quantityDispensed: args.quantity,
      daysSupply: args.daysSupply,
      dawCode: args.dawCode ?? "0",
      compoundCode: "1",
      usualAndCustomaryCents: args.uandcCents,
      ingredientCostSubmittedCents: ctx.request.ingredientCostSubmittedCents ?? 0,
      grossAmountDueCents: ctx.request.ingredientCostSubmittedCents ?? 0,
      responseStatus: o.responseStatus,
      rejectCodes: JSON.stringify(o.rejectCodes),
      rejectMessage: o.rejectMessage ?? null,
      allowedIngredientCostCents: o.allowedIngredientCostCents,
      allowedDispensingFeeCents: o.allowedDispensingFeeCents,
      totalAllowedCents: o.totalAllowedCents,
      basisOfReimbursement: o.pricing?.basisOfReimbursement ?? null,
      pharmacyPaidCents: o.pharmacyPaidCents,
      billedIngredientCostCents: o.billedIngredientCostCents,
      billedDispensingFeeCents: o.billedDispensingFeeCents,
      totalBilledCents: o.totalBilledCents,
      planPaidCents: o.planPaidCents,
      patientPayCents: o.patientPayCents,
      appliedToDeductibleCents: o.appliedToDeductibleCents,
      copayCoinsuranceCents: o.copayCoinsuranceCents,
      brandSelectionPenaltyCents: o.brandSelectionPenaltyCents,
      awpUnitAtDos: o.awpUnitAtDos ?? null,
      awpTotalCents: o.awpTotalCents ?? null,
      nadacUnitAtDos: o.nadacUnitAtDos ?? null,
      nadacTotalCents: o.nadacTotalCents ?? null,
      macUnitAtDos: o.macUnitAtDos ?? null,
      awpIsSimulated: o.awpIsSimulated,
      brandGenericClass: o.brandGeneric,
      channel: o.channel,
      formularyLevel: o.formularyLevel ?? null,
      isSpecialtyClaim: o.isSpecialtyClaim,
      excludedFromDiscountGuarantee: o.excludedFromDiscountGuarantee,
      discountExclusionReason: o.discountExclusionReason ?? null,
      rebateEligible: o.rebateEligible,
      rebateExclusionReason: o.rebateExclusionReason ?? null,
      estimatedRebateCents: o.estimatedRebateCents,
      scenarioTag: args.scenarioTag,
      traceJson: JSON.stringify(o.trace),
      adjudicatedAt: args.dateOfService,
    });
    return o;
  };

  // =======================================================================
  // Margaret Olson: reaches the out-of-pocket limit, and one Level 3 drug
  // that never counts toward it.
  // =======================================================================
  const margaret = DEMO_MEMBERS[0];
  const maintenance = [
    level2Brand ?? metformin,
    lisinopril,
    lipitorGeneric,
    omeprazole,
  ].filter((d): d is DrugRow => Boolean(d));

  {
    const acc = {
      rxOopAccumulatedCents: 0,
      federalOopAccumulatedCents: 0,
      deductibleAccumulatedCents: 0,
    };
    const prior: AdjudicationContext["priorFills"] = [];

    for (let month = 0; month < 12; month++) {
      const dos = day(month * 30 + 4);
      for (const [i, drug] of maintenance.entries()) {
        const o = run({
          memberId: margaret.id,
          diagnosisCodes: [...margaret.diagnosisCodes],
          drug,
          pharmacy: walgreens,
          dateOfService: dos,
          quantity: 30,
          daysSupply: 30,
          uandcCents: Math.round(drug.nadacPerUnit * 30 * 100 * 2.1),
          priorFills: [...prior],
          accumulators: { ...acc },
          scenarioTag: "demo-margaret-maintenance",
          rxNumber: String(7_100_000 + i),
          fillNumber: month,
        });
        if (o.responseStatus === "P") {
          prior.push({
            dateOfService: dos,
            daysSupply: 30,
            quantityDispensed: 30,
            drugId: drug.id,
            therapeuticClass: drug.therapeuticClass,
          });
          for (const d of o.costShare?.accumulatorDeltas ?? []) {
            const cents = Math.round(d.amountMicros / 10_000);
            if (d.accumulatorType === "RxOopIndividual") acc.rxOopAccumulatedCents += cents;
            if (d.accumulatorType === "FederalOopIndividual") acc.federalOopAccumulatedCents += cents;
          }
        }
      }

      // The Level 3 brand: 40% coinsurance, capped at $150, and it does not
      // move the $600 limit no matter how much she pays.
      if (level3) {
        const dos3 = day(month * 30 + 11);
        const o = run({
          memberId: margaret.id,
          diagnosisCodes: [...margaret.diagnosisCodes],
          drug: level3,
          pharmacy: walgreens,
          dateOfService: dos3,
          quantity: 30,
          daysSupply: 30,
          uandcCents: Math.round(level3.nadacPerUnit * 30 * 100 * 1.8),
          priorFills: [...prior],
          accumulators: { ...acc },
          scenarioTag: "demo-margaret-level3",
          rxNumber: "7100099",
          fillNumber: month,
        });
        if (o.responseStatus === "P") {
          prior.push({
            dateOfService: dos3,
            daysSupply: 30,
            quantityDispensed: 30,
            drugId: level3.id,
            therapeuticClass: level3.therapeuticClass,
          });
          for (const d of o.costShare?.accumulatorDeltas ?? []) {
            const cents = Math.round(d.amountMicros / 10_000);
            if (d.accumulatorType === "RxOopIndividual") acc.rxOopAccumulatedCents += cents;
            if (d.accumulatorType === "FederalOopIndividual") acc.federalOopAccumulatedCents += cents;
          }
        }
      }
    }
  }

  // =======================================================================
  // David Krueger: Skyrizi with an approved prior authorization.
  // =======================================================================
  const david = DEMO_MEMBERS[1];
  if (skyrizi) {
    const paEffective = day(20);
    const acc = {
      rxOopAccumulatedCents: 0,
      federalOopAccumulatedCents: 0,
      deductibleAccumulatedCents: 0,
    };
    const prior: AdjudicationContext["priorFills"] = [];

    // A methotrexate trial earlier in the year, which is what step 7 reads.
    const methotrexate = await loadDrug(prisma, { nameContains: "methotrexate" });
    if (methotrexate) {
      for (let w = 0; w < 3; w++) {
        const dos = day(w * 30 + 2);
        run({
          memberId: david.id,
          diagnosisCodes: [...david.diagnosisCodes],
          drug: methotrexate,
          pharmacy: walgreens,
          dateOfService: dos,
          quantity: 8,
          daysSupply: 28,
          uandcCents: 4200,
          priorFills: [...prior],
          accumulators: { ...acc },
          scenarioTag: "demo-david-steptherapy",
          rxNumber: "7200001",
          fillNumber: w,
        });
        prior.push({
          dateOfService: dos,
          daysSupply: 28,
          quantityDispensed: 8,
          drugId: methotrexate.id,
          therapeuticClass: methotrexate.therapeuticClass,
        });
      }
    }

    // The rejected fill that triggers the prior authorization request.
    run({
      memberId: david.id,
      diagnosisCodes: [...david.diagnosisCodes],
      drug: skyrizi,
      pharmacy: lumicera,
      dateOfService: day(14),
      quantity: 2,
      daysSupply: 84,
      uandcCents: 0,
      priorFills: [...prior],
      accumulators: { ...acc },
      scenarioTag: "demo-david-pa-reject",
      rxNumber: "7200010",
    });

    // Then the approved fills.
    for (let q = 0; q < 4; q++) {
      const dos = day(21 + q * 84);
      if (dos.getTime() > yearStart + 364 * 86_400_000) break;
      const o = run({
        memberId: david.id,
        diagnosisCodes: [...david.diagnosisCodes],
        drug: skyrizi,
        pharmacy: lumicera,
        dateOfService: dos,
        quantity: 2,
        daysSupply: 84,
        uandcCents: 0,
        priorFills: [...prior],
        accumulators: { ...acc },
        approvedPAs: [
          {
            drugId: skyrizi.id,
            effectiveDate: paEffective,
            terminationDate: day(20 + 122),
          },
        ],
        scenarioTag: "demo-david-specialty",
        rxNumber: "7200010",
        fillNumber: q,
      });
      if (o.responseStatus === "P") {
        prior.push({
          dateOfService: dos,
          daysSupply: 84,
          quantityDispensed: 2,
          drugId: skyrizi.id,
          therapeuticClass: skyrizi.therapeuticClass,
        });
        for (const d of o.costShare?.accumulatorDeltas ?? []) {
          const cents = Math.round(d.amountMicros / 10_000);
          if (d.accumulatorType === "FederalOopIndividual") acc.federalOopAccumulatedCents += cents;
        }
      }
    }
  }

  // =======================================================================
  // Thomas Meyer: the edge cases.
  // =======================================================================
  const thomas = DEMO_MEMBERS[3];
  if (lisinopril) {
    const first = day(30);
    run({
      memberId: thomas.id,
      diagnosisCodes: [...thomas.diagnosisCodes],
      drug: lisinopril,
      pharmacy: walgreens,
      dateOfService: first,
      quantity: 30,
      daysSupply: 30,
      uandcCents: 1450,
      scenarioTag: "demo-thomas-baseline",
      rxNumber: "7300001",
    });

    // Refill after 11 days: the 75% threshold has not been met.
    run({
      memberId: thomas.id,
      diagnosisCodes: [...thomas.diagnosisCodes],
      drug: lisinopril,
      pharmacy: walgreens,
      dateOfService: day(41),
      quantity: 30,
      daysSupply: 30,
      uandcCents: 1450,
      priorFills: [
        {
          dateOfService: first,
          daysSupply: 30,
          quantityDispensed: 30,
          drugId: lisinopril.id,
          therapeuticClass: lisinopril.therapeuticClass,
        },
      ],
      scenarioTag: "demo-thomas-refill-too-soon",
      rxNumber: "7300001",
      fillNumber: 1,
    });

    // Out of network.
    run({
      memberId: thomas.id,
      diagnosisCodes: [...thomas.diagnosisCodes],
      drug: lisinopril,
      pharmacy: oon,
      dateOfService: day(75),
      quantity: 30,
      daysSupply: 30,
      uandcCents: 1900,
      scenarioTag: "demo-thomas-out-of-network",
      rxNumber: "7300002",
    });

    // The pharmacy's cash price lands under the contract rate.
    run({
      memberId: thomas.id,
      diagnosisCodes: [...thomas.diagnosisCodes],
      drug: lisinopril,
      pharmacy: walgreens,
      dateOfService: day(90),
      quantity: 90,
      daysSupply: 90,
      uandcCents: 900,
      scenarioTag: "demo-thomas-uandc-wins",
      rxNumber: "7300003",
    });
  }

  if (brandWithGeneric) {
    run({
      memberId: thomas.id,
      diagnosisCodes: [...thomas.diagnosisCodes],
      drug: brandWithGeneric,
      pharmacy: walgreens,
      dateOfService: day(120),
      quantity: 30,
      daysSupply: 30,
      dawCode: "1",
      uandcCents: Math.round(brandWithGeneric.nadacPerUnit * 30 * 100 * 1.9),
      scenarioTag: "demo-thomas-daw-penalty",
      rxNumber: "7300004",
    });
  }

  /*
   * A quantity limit breach, which is the audit finding we replicate.
   *
   * The drug is chosen by asking the engine whether the limit would actually
   * fire, rather than by taking the first row with numbers in it. A limit of
   * "1 inj/84 days" on a drug the pharmacy bills by the millilitre cannot be
   * enforced without knowing how many millilitres are in an injection, so a
   * scenario built on one demonstrates nothing: it either passes, and the demo
   * shows no breach, or it refuses on a unit mismatch, which is the bug rather
   * than the finding.
   */
  const qlCandidates = await prisma.formularyEntry.findMany({
    where: {
      formularyId: "navitus-etf-2026",
      hasQuantityLimit: true,
      qlQuantity: { not: null },
      qlDays: { not: null },
      level: { in: ["1", "2", "3"] },
      // Nothing else on the entry may reject first, or the claim would show a
      // different finding than the one the scenario is named for.
      requiresPA: false,
      requiresStep: false,
      diagnosisRestricted: false,
      mandatorySpecialty: false,
      notCovered: false,
      planExclusion: false,
      drug: { prices: { some: { priceType: "NADAC" } } },
    },
    include: { drug: { include: { prices: true } } },
    orderBy: { drug: { name: "asc" } },
    take: 200,
  });

  const breach = qlCandidates
    .map((entry) => {
      const containers = entry.drug.packageContainers
        ? (JSON.parse(entry.drug.packageContainers) as Record<string, number>)
        : null;
      // Two and a half times the daily allowance over a thirty day supply, the
      // same shape as Vascepa dispensed at ten a day against a limit of four.
      const quantity = Math.ceil((entry.qlQuantity! / entry.qlDays!) * 30 * 2.5);
      const verdict = evaluateQuantityLimit({
        limit: {
          quantity: entry.qlQuantity!,
          unit: entry.qlUnit,
          basis: (entry.qlBasis as QuantityLimitBasis | null) ?? "dispensing-unit",
          periodDays: entry.qlDays,
          rawText: entry.qlRawText,
        },
        quantityDispensed: quantity,
        daysSupply: 30,
        dateOfService: day(150),
        packageSize: entry.drug.packageSize,
        unitOfMeasure: entry.drug.unitOfMeasure,
        packageContainers: containers,
        priorFills: [],
        planYearStart: new Date(yearStart),
      });
      return { entry, containers, quantity, verdict };
    })
    .find((c) => c.verdict.enforceable && !c.verdict.withinLimit);

  if (breach) {
    const { entry: qlDrug, containers, quantity } = breach;
    const price = qlDrug.drug.prices.find((p) => p.priceType === "NADAC")!;
    const drug: DrugRow = {
      id: qlDrug.drug.id,
      ndc11: qlDrug.drug.ndc11,
      name: qlDrug.drug.name,
      monyCode: qlDrug.drug.monyCode,
      isBrandLabel: qlDrug.drug.isBrandLabel,
      isSpecialty: qlDrug.drug.isSpecialty,
      therapeuticClass: qlDrug.drug.therapeuticClass,
      unitOfMeasure: qlDrug.drug.unitOfMeasure,
      packageSize: qlDrug.drug.packageSize,
      packageContainers: containers,
      nadacDescription: qlDrug.drug.nadacDescription,
      nadacPerUnit: price.unitPrice,
      formulary: {
        level: qlDrug.level,
        specialCode: qlDrug.specialCode,
        requiresPA: qlDrug.requiresPA,
        requiresStep: qlDrug.requiresStep,
        hasQuantityLimit: true,
        diagnosisRestricted: qlDrug.diagnosisRestricted,
        mandatorySpecialty: qlDrug.mandatorySpecialty,
        notCovered: qlDrug.notCovered,
        planExclusion: qlDrug.planExclusion,
        qlQuantity: qlDrug.qlQuantity,
        qlDays: qlDrug.qlDays,
        qlUnit: qlDrug.qlUnit,
        qlBasis: qlDrug.qlBasis,
        qlRawText: qlDrug.qlRawText,
        requiredDiagnosisCodes: [],
        diagnosisRawText: null,
      },
    };
    run({
      memberId: thomas.id,
      diagnosisCodes: [...thomas.diagnosisCodes],
      drug,
      pharmacy: walgreens,
      dateOfService: day(150),
      quantity,
      daysSupply: 30,
      uandcCents: Math.round(price.unitPrice * quantity * 100 * 1.7),
      scenarioTag: "audit-quantity-limit",
      rxNumber: "7300005",
    });
  }

  // A long term care claim, which Exhibit C excludes from the guarantees.
  const ltc = PHARMACIES.find((p) => p.pharmacyType === "LTC")!;
  if (metformin) {
    run({
      memberId: thomas.id,
      diagnosisCodes: [...thomas.diagnosisCodes],
      drug: metformin,
      pharmacy: ltc,
      dateOfService: day(180),
      quantity: 60,
      daysSupply: 30,
      uandcCents: 2400,
      scenarioTag: "audit-ltc-classification",
      rxNumber: "7300006",
    });
  }

  for (const row of claimRows) {
    await prisma.claim.create({ data: row });
  }
  console.log(`  ${claimRows.length} scenario claims`);

  // =======================================================================
  // Prior authorizations
  // =======================================================================
  await seedPriorAuths(prisma, { planYear, skyrizi });
}

async function seedPriorAuths(
  prisma: PrismaClient,
  args: { planYear: number; skyrizi: DrugRow | null },
) {
  const { skyrizi } = args;
  if (!skyrizi) return;

  const tree = findTreeForDrug(skyrizi.name) ?? CRITERIA_TREES[0];
  const yearStart = Date.UTC(args.planYear, 0, 1);
  const day = (n: number) => new Date(yearStart + n * 86_400_000);

  const cases: Array<{
    paNumber: string;
    memberId: string;
    facts: PAFacts;
    receivedAt: Date;
    urgency: "Standard" | "Expedited";
    prescriberName: string;
  }> = [
    {
      paNumber: "PA2026000101",
      memberId: DEMO_MEMBERS[1].id,
      receivedAt: day(15),
      urgency: "Standard",
      prescriberName: "Dr. Anita Rao, Dermatology",
      facts: {
        condition: "plaque-psoriasis-initial",
        prescriberSpecialty: "Dermatology",
        memberDiagnosisCodes: ["L40"],
        memberAgeYears: 46,
        memberWeightKg: 91,
        filledDrugNames: ["methotrexate tab"],
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
        },
      },
    },
    {
      paNumber: "PA2026000102",
      memberId: DEMO_MEMBERS[2].id,
      receivedAt: day(40),
      urgency: "Standard",
      prescriberName: "Dr. Michael Torres, Dermatology",
      facts: {
        condition: "plaque-psoriasis-initial",
        prescriberSpecialty: "Dermatology",
        memberDiagnosisCodes: ["L40"],
        memberAgeYears: 38,
        memberWeightKg: 64,
        filledDrugNames: [],
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
          allAlternativesContraindicated: false,
        },
      },
    },
    {
      paNumber: "PA2026000103",
      memberId: DEMO_MEMBERS[2].id,
      receivedAt: day(52),
      urgency: "Expedited",
      prescriberName: "Dr. Michael Torres, Dermatology",
      facts: {
        condition: "plaque-psoriasis-initial",
        prescriberSpecialty: "Dermatology",
        memberDiagnosisCodes: ["L40"],
        memberAgeYears: 38,
        memberWeightKg: 64,
        filledDrugNames: [],
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
          allAlternativesContraindicated: true,
          contraindicationsListed: true,
        },
      },
    },
    {
      paNumber: "PA2026000104",
      memberId: DEMO_MEMBERS[0].id,
      receivedAt: day(60),
      urgency: "Standard",
      prescriberName: "Dr. Susan Lindqvist, Internal Medicine",
      facts: {
        condition: "plaque-psoriasis-initial",
        prescriberSpecialty: "Internal Medicine",
        memberDiagnosisCodes: ["I10", "E11"],
        memberAgeYears: 64,
        memberWeightKg: 78,
        filledDrugNames: [],
        answers: {},
      },
    },
  ];

  const criteriaSteps = await prisma.criteriaStep.findMany({
    where: { treeId: tree.id },
  });
  const stepIdByNumber = new Map(
    criteriaSteps.map((s) => [s.stepNumber, s.id]),
  );

  for (const c of cases) {
    const determination = determinePA(tree, c.facts);
    const sla = paDeadlines(c.receivedAt, c.urgency, "Commercial").binding;
    const decidedAt = new Date(
      c.receivedAt.getTime() + (c.urgency === "Expedited" ? 4 : 26) * 3_600_000,
    );

    const status =
      determination.outcome === "Approved"
        ? "Approved"
        : determination.outcome === "Denied"
          ? "Denied"
          : "InReview";

    const pa = await prisma.priorAuthorization.create({
      data: {
        paNumber: c.paNumber,
        memberId: c.memberId,
        drugId: skyrizi.id,
        treeId: tree.id,
        requestType: "PA",
        urgency: c.urgency,
        prescriberName: c.prescriberName,
        requestedQuantity: 2,
        requestedDaysSupply: 84,
        questionResponses: JSON.stringify(c.facts),
        status,
        determination: determination.outcome,
        decidingStepNumber: determination.decidingStep ?? null,
        denyReason: determination.reason ?? null,
        approvedDays: determination.approvedDays ?? null,
        approvedEffectiveDate:
          determination.outcome === "Approved" ? decidedAt : null,
        approvedTerminationDate:
          determination.outcome === "Approved"
            ? new Date(
                decidedAt.getTime() +
                  (determination.approvedDays ?? 365) * 86_400_000,
              )
            : null,
        receivedAt: c.receivedAt,
        decisionDueAt: sla.dueAt,
        decidedAt: determination.outcome === "Escalated" ? null : decidedAt,
        /*
         * Automation may confirm that published criteria are met, because that
         * is a reading of a document. It may not issue an adverse
         * determination. A denial is a clinical decision with appeal rights
         * attached, so the traversal stops and a pharmacist signs it. The
         * criteria path is identical either way; what differs is who is
         * accountable for the outcome.
         */
        decidedBy:
          determination.outcome === "Escalated"
            ? null
            : determination.outcome === "Denied"
              ? "Pharmacist"
              : "AI",
        escalated: determination.outcome !== "Approved",
        reviewerNote:
          determination.outcome === "Escalated"
            ? "Routed to a pharmacist. The criteria set requires a dermatologist and the submitting prescriber is Internal Medicine, so the request needs clinical judgement rather than an automatic denial."
            : determination.outcome === "Denied"
              ? "The criteria traversal reached a denial at the step cited. Automation does not issue denials, so a pharmacist reviewed the path and the submitted documentation before the determination was released."
              : null,
      },
    });

    for (const [i, step] of determination.path.entries()) {
      const criteriaStepId = stepIdByNumber.get(step.step);
      if (criteriaStepId) {
        await prisma.pADecisionStep.create({
          data: {
            paId: pa.id,
            criteriaStepId,
            seq: i,
            answer: step.answer,
            evidence: step.evidence,
          },
        });
      }
      await prisma.traceStep.create({
        data: {
          paId: pa.id,
          seq: i,
          ruleId: `pa.criteria.step-${step.step}`,
          stage: "pa",
          question: step.question,
          inputs: JSON.stringify({ step: step.step }),
          output: JSON.stringify({ answer: step.answer, next: step.next }),
          fired: true,
          detail: step.evidence,
          sourceDocumentId: `pa-form-${tree.id}`,
          citation: step.citation,
        },
      });
    }
  }

  console.log(`  ${cases.length} prior authorizations determined`);
}
