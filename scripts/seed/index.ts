/**
 * Seed the simulated plan.
 *
 * Run with: npm run seed  (requires npm run ingest to have run first)
 */

import { Prisma, PrismaClient } from "../../src/generated/prisma/index.js";
import { formatCents } from "../../src/lib/money.js";
import type {
  EngineBenefitPlan,
  EngineContract,
  EngineCostShareRule,
  EngineFormularyEntry,
  EngineRate,
} from "../../src/lib/engine/adjudicate.js";
import type { Channel, PricingArm } from "../../src/lib/engine/types.js";
import { CRITERIA_TREES } from "../../src/lib/pa/criteria.js";
import { WISCONSIN_CONTRACT_ID } from "../../src/lib/contracts/wisconsin.js";
import {
  FORMULARY_ID,
  SPONSOR_ID,
  seedContracts,
  seedPharmacies,
  seedSponsorAndPlans,
} from "./world.js";
import { generatePopulation } from "./population.js";
import { generateClaims, type DrugCandidate } from "./claims.js";
import { persistPriorAuths } from "./prior-auths.js";
import { seedAuditFindings } from "./audit.js";
import { seedScenarios } from "./scenarios.js";

const prisma = new PrismaClient();

const PLAN_YEAR = 2026;
const CONTRACT_COUNT = 1200;
const SEED = 20260101;

async function loadEnginePlans(): Promise<Map<string, EngineBenefitPlan>> {
  const plans = await prisma.benefitPlan.findMany({
    include: { costShareRules: true },
  });
  const map = new Map<string, EngineBenefitPlan>();
  for (const p of plans) {
    map.set(p.id, {
      id: p.id,
      name: p.name,
      lineOfBusiness: p.lineOfBusiness as "Commercial" | "EGWP",
      deductibleIndividual: p.deductibleIndividual,
      deductibleIntegratedWithMedical: p.deductibleIntegratedWithMedical,
      rxOopLimitIndividual: p.rxOopLimitIndividual,
      federalOopLimitIndividual: p.federalOopLimitIndividual,
      dawPenaltyEnabled: p.dawPenaltyEnabled,
      specialtyChannelRestricted: p.specialtyChannelRestricted,
      costShareRules: p.costShareRules.map(
        (r): EngineCostShareRule => ({
          level: r.level,
          channel: r.channel as Channel,
          costShareType: r.costShareType as EngineCostShareRule["costShareType"],
          copayCents: r.copayCents,
          coinsuranceRateBps: r.coinsuranceRateBps,
          coinsuranceMaxCents: r.coinsuranceMaxCents,
          accumulatesToRxOop: r.accumulatesToRxOop,
          accumulatesToFederalOop: r.accumulatesToFederalOop,
          citation: r.citation,
        }),
      ),
    });
  }
  return map;
}

export async function loadEngineContract(
  contractId: string,
): Promise<EngineContract> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: { rates: true },
  });

  const toRate = (r: (typeof contract.rates)[number]): EngineRate => ({
    channel: r.channel as Channel,
    drugClass: r.drugClass as "Brand" | "Generic" | "All",
    awpDiscountBps: r.awpDiscountBps,
    dispensingFeeCents: r.dispensingFeeCents,
    lesserOfArms: JSON.parse(r.lesserOfArms) as PricingArm[],
    includeUandC: r.includeUandC,
    minRebatePerBrandClaimCents: r.minRebatePerBrandClaimCents,
  });

  const commercial = contract.rates.filter(
    (r) => r.lineOfBusiness === "Commercial",
  );

  return {
    id: contract.id,
    model: contract.model as "PassThrough" | "Traditional",
    retailMaxDaysSupply: contract.retailMaxDaysSupply,
    discountExclusions: JSON.parse(contract.discountExclusions),
    rebateExclusions: JSON.parse(contract.rebateExclusions),
    rebateMemberShareThresholdBps: contract.rebateMemberShareThresholdBps,
    rates: commercial.filter((r) => r.rateSide === "Pharmacy").map(toRate),
    clientRates: commercial.filter((r) => r.rateSide === "Client").map(toRate),
    clientMacMultiplier: contract.model === "Traditional" ? 1.75 : 1,
    rebatePassThroughBps: contract.rebatePassThroughBps,
  };
}

async function loadDrugCandidates(): Promise<DrugCandidate[]> {
  const entries = await prisma.formularyEntry.findMany({
    where: { formularyId: FORMULARY_ID },
    include: { drug: { include: { prices: true } } },
  });

  const out: DrugCandidate[] = [];
  for (const e of entries) {
    const price = e.drug.prices.find((p) => p.priceType === "NADAC");
    if (!price) continue;
    out.push({
      id: e.drug.id,
      ndc11: e.drug.ndc11,
      name: e.drug.name,
      nadacDescription: e.drug.nadacDescription,
      unitOfMeasure: e.drug.unitOfMeasure,
      nadacPerUnit: price.unitPrice,
      monyCode: e.drug.monyCode,
      isBrandLabel: e.drug.isBrandLabel,
      isSpecialty: e.drug.isSpecialty,
      therapeuticClass: e.drug.therapeuticClass,
      formulary: {
        level: e.level,
        specialCode: e.specialCode,
        requiresPA: e.requiresPA,
        requiresStep: e.requiresStep,
        hasQuantityLimit: e.hasQuantityLimit,
        diagnosisRestricted: e.diagnosisRestricted,
        mandatorySpecialty: e.mandatorySpecialty,
        notCovered: e.notCovered,
        planExclusion: e.planExclusion,
        qlQuantity: e.qlQuantity,
        qlDays: e.qlDays,
        qlRawText: e.qlRawText,
        requiredDiagnosisCodes: JSON.parse(e.requiredDiagnosisCodes) as string[],
        diagnosisRawText: e.diagnosisRawText,
      } satisfies EngineFormularyEntry,
    });
  }
  return out;
}

async function seedCriteriaTrees() {
  for (const tree of CRITERIA_TREES) {
    await prisma.sourceDocument.upsert({
      where: { id: `pa-form-${tree.id}` },
      create: {
        id: `pa-form-${tree.id}`,
        title: `${tree.name} prior authorization form`,
        publisher: "Navitus Health Solutions",
        url: tree.url,
        kind: "pa-criteria",
        retrievedAt: new Date(),
        notes: `Numbered clinical decision tree governing ${tree.scopeLabel}.`,
      },
      update: { url: tree.url },
    });

    await prisma.criteriaStep.deleteMany({ where: { treeId: tree.id } });
    await prisma.pACriteriaTree.upsert({
      where: { id: tree.id },
      create: {
        id: tree.id,
        name: tree.name,
        scopeLabel: tree.scopeLabel,
        drugPatterns: JSON.stringify(tree.drugPatterns),
        approvalDurationDays: tree.defaultApprovalDays,
        sourceDocumentId: `pa-form-${tree.id}`,
      },
      update: { drugPatterns: JSON.stringify(tree.drugPatterns) },
    });

    for (const step of tree.steps) {
      await prisma.criteriaStep.create({
        data: {
          treeId: tree.id,
          stepNumber: step.step,
          question: step.question,
          predicate: step.predicate,
          predicateArgs: JSON.stringify(step.args ?? {}),
          yesOutcome: step.yes.outcome,
          yesStep: step.yes.step ?? null,
          yesApprovalDays: step.yes.days ?? null,
          noOutcome: step.no.outcome,
          noStep: step.no.step ?? null,
          noApprovalDays: step.no.days ?? null,
          denyReason: step.no.reason ?? step.yes.reason ?? null,
          citation: step.citation,
        },
      });
    }
  }
}

async function main() {
  const started = Date.now();
  console.log("Glass plan seed\n");

  console.log("Clearing simulated data...");
  await prisma.accumulatorTransaction.deleteMany();
  await prisma.rebateAccrual.deleteMany();
  await prisma.traceStep.deleteMany();
  await prisma.pADecisionStep.deleteMany();
  await prisma.priorAuthorization.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.accumulator.deleteMany();
  await prisma.eligibilitySpan.deleteMany();
  await prisma.member.deleteMany();
  await prisma.auditFindingResult.deleteMany();
  await prisma.auditFinding.deleteMany();
  await prisma.readjudicationRun.deleteMany();
  await prisma.configVersion.deleteMany();

  console.log("Seeding contracts and rate cards...");
  await seedContracts(prisma);

  console.log("Seeding pharmacies and networks...");
  await seedPharmacies(prisma);

  console.log("Seeding sponsor and benefit plans...");
  await seedSponsorAndPlans(prisma);

  console.log("Seeding published PA criteria trees...");
  await seedCriteriaTrees();

  console.log("Seeding audit findings to replicate...");
  await seedAuditFindings(prisma);

  // -----------------------------------------------------------------------
  console.log("\nGenerating membership...");
  const members = generatePopulation({
    contractCount: CONTRACT_COUNT,
    planYear: PLAN_YEAR,
    seed: SEED,
    hdhpShare: 0.18,
  });
  console.log(`  ${members.length.toLocaleString()} members across ${CONTRACT_COUNT.toLocaleString()} contracts`);

  await prisma.member.createMany({
    data: members.map((m) => ({
      id: m.id,
      sponsorId: SPONSOR_ID,
      cardholderId: m.cardholderId,
      personCode: m.personCode,
      relationshipCode: m.relationshipCode,
      subscriberId: m.subscriberId,
      firstName: m.firstName,
      lastName: m.lastName,
      dateOfBirth: m.dateOfBirth,
      gender: m.gender,
      addressLine1: m.addressLine1,
      city: m.city,
      state: m.state,
      zip: m.zip,
      phone: m.phone,
      email: m.email,
      diagnosisCodes: JSON.stringify(m.diagnosisCodes),
      weightKg: m.weightKg,
    })),
  });

  await prisma.eligibilitySpan.createMany({
    data: members.map((m) => ({
      id: `elig-${m.id}`,
      memberId: m.id,
      benefitPlanId: m.benefitPlanId,
      effectiveDate: m.effectiveDate,
      terminationDate: m.terminationDate,
      coverageTier: m.coverageTier,
      memberType: "Active",
    })),
  });

  // -----------------------------------------------------------------------
  console.log("\nLoading drug catalog and contract terms...");
  const drugs = await loadDrugCandidates();
  const plans = await loadEnginePlans();
  const contract = await loadEngineContract(WISCONSIN_CONTRACT_ID);

  const drugsByClass = new Map<string, DrugCandidate[]>();
  for (const d of drugs) {
    const key = d.therapeuticClass ?? "UNCLASSIFIED";
    if (!drugsByClass.has(key)) drugsByClass.set(key, []);
    drugsByClass.get(key)!.push(d);
  }
  const specialtyDrugs = drugs.filter(
    (d) => d.isSpecialty && d.formulary.level === "4",
  );
  console.log(
    `  ${drugs.length.toLocaleString()} priced formulary drugs, ${specialtyDrugs.length} specialty`,
  );

  console.log("\nAdjudicating claims through the engine...");
  const {
    claims: generated,
    priorAuths: grantedPAs,
    decidedPriorAuths: decidedPAs,
  } = generateClaims({
    members,
    drugsByClass,
    allDrugs: drugs,
    specialtyDrugs,
    plans,
    contract,
    planYear: PLAN_YEAR,
    seed: SEED + 1,
  });
  console.log(`  ${generated.length.toLocaleString()} claims adjudicated`);

  // -----------------------------------------------------------------------
  console.log("\nWriting claims...");
  const claimRows: Prisma.ClaimCreateManyInput[] = [];
  const accumulatorTotals = new Map<
    string,
    { rxOop: number; fedOop: number; deductible: number; planId: string }
  >();

  for (const g of generated) {
    const o = g.outcome;
    claimRows.push({
      claimNumber: g.claimNumber,
      transactionCode: "B1",
      sponsorId: SPONSOR_ID,
      memberId: g.member.id,
      eligibilitySpanId: `elig-${g.member.id}`,
      benefitPlanId: g.member.benefitPlanId,
      pharmacyId: g.pharmacyId,
      drugId: g.drug.id,
      contractId: WISCONSIN_CONTRACT_ID,
      dateOfService: g.dateOfService,
      rxNumber: g.rxNumber,
      fillNumber: g.fillNumber,
      quantityDispensed: g.quantityDispensed,
      daysSupply: g.daysSupply,
      dawCode: g.dawCode,
      compoundCode: "1",
      usualAndCustomaryCents: g.usualAndCustomaryCents,
      ingredientCostSubmittedCents: g.ingredientCostSubmittedCents,
      grossAmountDueCents: g.ingredientCostSubmittedCents,
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
      scenarioTag: g.scenarioTag ?? null,
      traceJson: JSON.stringify(o.trace),
      adjudicatedAt: g.dateOfService,
    });

    if (o.responseStatus === "P") {
      const acc = accumulatorTotals.get(g.member.id) ?? {
        rxOop: 0,
        fedOop: 0,
        deductible: 0,
        planId: g.member.benefitPlanId,
      };
      for (const d of o.costShare?.accumulatorDeltas ?? []) {
        const cents = Math.round(d.amountMicros / 10_000);
        if (d.accumulatorType === "RxOopIndividual") acc.rxOop += cents;
        if (d.accumulatorType === "FederalOopIndividual") acc.fedOop += cents;
        if (d.accumulatorType === "DeductibleIndividual") acc.deductible += cents;
      }
      accumulatorTotals.set(g.member.id, acc);
    }
  }

  const CHUNK = 250;
  for (let i = 0; i < claimRows.length; i += CHUNK) {
    await prisma.claim.createMany({ data: claimRows.slice(i, i + CHUNK) });
    if (i % 5000 === 0 && i > 0) {
      process.stdout.write(`  ${i.toLocaleString()} / ${claimRows.length.toLocaleString()}\r`);
    }
  }
  console.log(`  ${claimRows.length.toLocaleString()} claims written        `);

  // -----------------------------------------------------------------------
  console.log("\nWriting accumulators...");
  const planLimits = new Map(
    (await prisma.benefitPlan.findMany()).map((p) => [p.id, p]),
  );
  const accumulatorRows: Prisma.AccumulatorCreateManyInput[] = [];
  for (const [memberId, acc] of accumulatorTotals) {
    const plan = planLimits.get(acc.planId);
    if (!plan) continue;
    accumulatorRows.push({
      memberId,
      benefitPlanId: acc.planId,
      accumulatorType: "RxOopIndividual",
      planYear: PLAN_YEAR,
      limitCents: plan.rxOopLimitIndividual,
      accumulatedCents: acc.rxOop,
    });
    accumulatorRows.push({
      memberId,
      benefitPlanId: acc.planId,
      accumulatorType: "FederalOopIndividual",
      planYear: PLAN_YEAR,
      limitCents: plan.federalOopLimitIndividual,
      accumulatedCents: acc.fedOop,
    });
    if (plan.deductibleIndividual > 0) {
      accumulatorRows.push({
        memberId,
        benefitPlanId: acc.planId,
        accumulatorType: "DeductibleIndividual",
        planYear: PLAN_YEAR,
        limitCents: plan.deductibleIndividual,
        accumulatedCents: acc.deductible,
      });
    }
  }
  for (let i = 0; i < accumulatorRows.length; i += 500) {
    await prisma.accumulator.createMany({ data: accumulatorRows.slice(i, i + 500) });
  }
  console.log(`  ${accumulatorRows.length.toLocaleString()} accumulators`);

  // -----------------------------------------------------------------------
  // Approvals the generator granted so specialty fills would pay. Writing them
  // down is what makes a claim replayable: without the approval on file, a
  // re-adjudication would reject a fill that originally paid.
  console.log("\nWriting standing prior authorizations...");
  const paRows: Prisma.PriorAuthorizationCreateManyInput[] = grantedPAs.map(
    (pa, i) => ({
      paNumber: `PA${PLAN_YEAR}${String(200_000 + i).padStart(7, "0")}`,
      memberId: pa.memberId,
      drugId: pa.drugId,
      requestType: "PA",
      urgency: "Standard",
      status: "Approved",
      determination: "Approved",
      approvedDays: 365,
      approvedEffectiveDate: pa.effectiveDate,
      approvedTerminationDate: pa.terminationDate,
      receivedAt: pa.effectiveDate,
      decidedAt: pa.effectiveDate,
      decidedBy: "Pharmacist",
      reviewerNote:
        "Standing approval carried into the simulation so the member's specialty therapy adjudicates. Not produced by traversing a criteria tree.",
    }),
  );
  for (let i = 0; i < paRows.length; i += 500) {
    await prisma.priorAuthorization.createMany({
      data: paRows.slice(i, i + 500),
    });
  }
  console.log(`  ${paRows.length.toLocaleString()} standing approvals`);

  // Requests that were actually decided by walking the published criteria.
  // These carry a step-by-step traversal, which is what the criteria viewer
  // renders and what the branch coverage on /proof is measured against.
  console.log("\nWriting decided prior authorizations...");
  await persistPriorAuths(prisma, decidedPAs, 300_000);
  const decidedCounts = decidedPAs.reduce<Record<string, number>>((acc, d) => {
    acc[d.outcome] = (acc[d.outcome] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `  ${decidedPAs.length.toLocaleString()} criteria traversals ` +
      `(${Object.entries(decidedCounts)
        .map(([k, v]) => `${v} ${k.toLowerCase()}`)
        .join(", ")})`,
  );

  // -----------------------------------------------------------------------
  console.log("\nSeeding demonstration scenarios...");
  await seedScenarios(prisma, { planYear: PLAN_YEAR, contract, plans });

  // -----------------------------------------------------------------------
  const stats = await prisma.claim.aggregate({
    _sum: {
      totalBilledCents: true,
      planPaidCents: true,
      patientPayCents: true,
      estimatedRebateCents: true,
    },
    _count: true,
    where: { responseStatus: "P" },
  });
  const rejected = await prisma.claim.count({ where: { responseStatus: "R" } });
  const memberCount = await prisma.member.count();

  console.log("\n" + "=".repeat(58));
  console.log("Plan summary");
  console.log("=".repeat(58));
  console.log(`  Members                 ${memberCount.toLocaleString()}`);
  console.log(`  Paid claims             ${stats._count.toLocaleString()}`);
  console.log(`  Rejected claims         ${rejected.toLocaleString()}`);
  console.log(`  Total billed            ${formatCents(stats._sum.totalBilledCents ?? 0)}`);
  console.log(`  Plan paid               ${formatCents(stats._sum.planPaidCents ?? 0)}`);
  console.log(`  Member paid             ${formatCents(stats._sum.patientPayCents ?? 0)}`);
  console.log(`  Rebates to plan         ${formatCents(stats._sum.estimatedRebateCents ?? 0)}`);
  console.log(
    `  Scripts per member      ${(stats._count / memberCount).toFixed(1)}  (ET-8933 reports 14.5)`,
  );
  console.log(
    `  Cost per member         ${formatCents(Math.round((stats._sum.totalBilledCents ?? 0) / memberCount))}  (ET-8933 reports $1,523)`,
  );
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
