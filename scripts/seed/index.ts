/**
 * Seed the simulated plan.
 *
 * Run with: npm run seed  (requires npm run ingest to have run first)
 */

import { createHash } from "node:crypto";
import { Prisma } from "../../src/generated/prisma/index.js";
import { prisma as sharedPrisma } from "../../src/lib/db.js";
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
import { MICHIGAN_CONTRACT_ID } from "../../src/lib/contracts/michigan.js";
import {
  FORMULARY_ID,
  SPONSOR_ID,
  MICHIGAN_SPONSOR_ID,
  MICHIGAN_IYC_PLAN_ID,
  MICHIGAN_HDHP_PLAN_ID,
  seedContracts,
  seedPharmacies,
  seedSponsorAndPlans,
  seedMichiganSponsorAndPlans,
} from "./world.js";
import { Rng, generatePopulation } from "./population.js";
import {
  buildDrugPools,
  generateClaims,
  type DrugCandidate,
  type GeneratedClaim,
  type GeneratedPriorAuth,
  type MedicalTransfer,
} from "./claims.js";
import { persistPriorAuths, type DecidedPA } from "./prior-auths.js";
import { seedAuditFindings } from "./audit.js";
import { seedScenarios } from "./scenarios.js";
import { seedExceptions } from "./exceptions.js";

const prisma = sharedPrisma;

const PLAN_YEAR = 2026;
/**
 * Contracts, not lives. The population model puts a spouse on most contracts
 * and children on some, which lands a little over two lives per contract, so
 * this is the number that produces roughly a hundred thousand members.
 */
const CONTRACT_COUNT = Number(process.env.SEED_CONTRACTS ?? 48_250);
/**
 * Smaller Traditional book for Lakeside / Michigan. Enough claims to show
 * spread without doubling seed time. Override with SEED_MICHIGAN_CONTRACTS=0
 * to skip.
 */
const MICHIGAN_CONTRACT_COUNT = Number(
  process.env.SEED_MICHIGAN_CONTRACTS ?? 2_500,
);
const SEED = 20260101;
/**
 * Members per generation batch.
 *
 * The whole book does not fit in memory at this scale, so it is produced and
 * written a slice at a time. The generator threads its random state and claim
 * numbering through the slices, so the batched book is identical to the one a
 * single pass would have produced.
 */
const MEMBER_BATCH = 4_000;

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
    clientMacMultiplier: (contract.clientMacMultiplierBps ?? 10_000) / 10_000,
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
      packageSize: e.drug.packageSize,
      packageContainers: e.drug.packageContainers
        ? (JSON.parse(e.drug.packageContainers) as Record<string, number>)
        : null,
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
        qlUnit: e.qlUnit,
        qlBasis: e.qlBasis,
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

interface DayTotals {
  claimsSubmitted: number;
  claimsPaid: number;
  claimsRejected: number;
  totalBilledCents: number;
  planPaidCents: number;
  patientPayCents: number;
  pharmacyPaidCents: number;
  estimatedRebateCents: number;
  genericClaims: number;
  brandClaims: number;
  specialtyClaims: number;
  specialtyBilledCents: number;
  mailClaims: number;
  retailClaims: number;
  retail90Claims: number;
  members: Set<string>;
}

/** One cell of the dimensional rollup: a day, a dimension, and a key. */
interface DimTotals {
  claims: number;
  billedCents: number;
  planPaidCents: number;
  memberPaidCents: number;
  rebateCents: number;
  nadacCents: number;
  dispensingFeeCents: number;
  allowedCents: number;
  ingredientCostCents: number;
  awpCents: number;
}

type DimKey = `${number}|${string}|${string}`;

function addDim(
  dims: Map<DimKey, DimTotals>,
  dayMs: number,
  dimension: string,
  key: string,
  c: {
    billed: number;
    planPaid: number;
    memberPaid: number;
    rebate: number;
    nadac: number;
    dispensingFee: number;
    allowed: number;
    ingredientCost: number;
    awp: number;
  },
): void {
  const k: DimKey = `${dayMs}|${dimension}|${key}`;
  let d = dims.get(k);
  if (!d) {
    d = {
      claims: 0,
      billedCents: 0,
      planPaidCents: 0,
      memberPaidCents: 0,
      rebateCents: 0,
      nadacCents: 0,
      dispensingFeeCents: 0,
      allowedCents: 0,
      ingredientCostCents: 0,
      awpCents: 0,
    };
    dims.set(k, d);
  }
  d.claims++;
  d.billedCents += c.billed;
  d.planPaidCents += c.planPaid;
  d.memberPaidCents += c.memberPaid;
  d.rebateCents += c.rebate;
  d.nadacCents += c.nadac;
  d.dispensingFeeCents += c.dispensingFee;
  d.allowedCents += c.allowed;
  d.ingredientCostCents += c.ingredientCost;
  d.awpCents += c.awp;
}

function emptyDay(): DayTotals {
  return {
    claimsSubmitted: 0,
    claimsPaid: 0,
    claimsRejected: 0,
    totalBilledCents: 0,
    planPaidCents: 0,
    patientPayCents: 0,
    pharmacyPaidCents: 0,
    estimatedRebateCents: 0,
    genericClaims: 0,
    brandClaims: 0,
    specialtyClaims: 0,
    specialtyBilledCents: 0,
    mailClaims: 0,
    retailClaims: 0,
    retail90Claims: 0,
    members: new Set(),
  };
}

/**
 * Turn a batch of adjudicated claims into rows, folding the member
 * accumulators and the daily rollup in the same pass.
 *
 * The derivation trace is deliberately not stored. At this scale the traces
 * would be several times the size of the rest of the database, and they do not
 * need to be kept: the engine is deterministic and every input a claim was
 * priced from is on the claim row, so the trace can be reproduced exactly when
 * someone asks to see it. See src/lib/engine/reproduce.ts, and the determinism
 * test that holds reproduction to the original.
 */
function buildClaimRows(
  generated: GeneratedClaim[],
  accumulatorTotals: Map<
    string,
    { rxOop: number; fedOop: number; deductible: number; planId: string }
  >,
  days: Map<number, DayTotals>,
  dims: Map<DimKey, DimTotals>,
  classOf: Map<string, string>,
  sponsorId: string = SPONSOR_ID,
  contractId: string = WISCONSIN_CONTRACT_ID,
): Prisma.ClaimCreateManyInput[] {
  const rows: Prisma.ClaimCreateManyInput[] = [];

  for (const g of generated) {
    const o = g.outcome;
    rows.push({
      claimNumber: g.claimNumber,
      transactionCode: "B1",
      sponsorId,
      memberId: g.member.id,
      eligibilitySpanId: `elig-${g.member.id}`,
      benefitPlanId: g.member.benefitPlanId,
      pharmacyId: g.pharmacyId,
      drugId: g.drug.id,
      contractId,
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
      traceJson: null,
      adjudicatedAt: g.dateOfService,
    });

    const dayKey = g.dateOfService.getTime();
    let day = days.get(dayKey);
    if (!day) {
      day = emptyDay();
      days.set(dayKey, day);
    }
    day.claimsSubmitted++;
    day.members.add(g.member.id);

    if (o.responseStatus === "P") {
      day.claimsPaid++;
      day.totalBilledCents += o.totalBilledCents;
      day.planPaidCents += o.planPaidCents;
      day.patientPayCents += o.patientPayCents;
      day.pharmacyPaidCents += o.pharmacyPaidCents;
      day.estimatedRebateCents += o.estimatedRebateCents;
      if (o.brandGeneric === "Generic") day.genericClaims++;
      else day.brandClaims++;
      if (o.isSpecialtyClaim) {
        day.specialtyClaims++;
        day.specialtyBilledCents += o.totalBilledCents;
      }
      if (o.channel === "Mail") day.mailClaims++;
      else if (o.channel === "Retail90") day.retail90Claims++;
      else day.retailClaims++;

      const cell = {
        billed: o.totalBilledCents,
        planPaid: o.planPaidCents,
        memberPaid: o.patientPayCents,
        rebate: o.estimatedRebateCents,
        nadac: o.nadacTotalCents ?? 0,
        dispensingFee: o.billedDispensingFeeCents,
        allowed: o.totalAllowedCents,
        ingredientCost: o.billedIngredientCostCents,
        awp: o.awpTotalCents ?? 0,
      };
      addDim(dims, dayKey, "channel", o.channel, cell);
      addDim(dims, dayKey, "level", o.formularyLevel ?? "n/a", cell);
      addDim(dims, dayKey, "basis", o.pricing?.basisOfReimbursement ?? "n/a", cell);
      addDim(dims, dayKey, "drug", g.drug.id, cell);
      addDim(
        dims,
        dayKey,
        "class",
        classOf.get(g.drug.id) ?? "Unclassified",
        cell,
      );
      /*
       * The Exhibit C reconciliation cuts by channel and brand together, and
       * only over claims that carry an AWP to discount from. Rolling it up on
       * the same pass keeps the guarantee report off the claim table, and the
       * AWP filter has to live here rather than in the report so the stored
       * cell means exactly what the contract measures.
       */
      if ((o.awpTotalCents ?? 0) > 0) {
        addDim(dims, dayKey, "guarantee", `${o.channel}::${o.brandGeneric}`, cell);
      }

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
    } else {
      day.claimsRejected++;
      const code = o.rejectCodes[0] ?? "unknown";
      addDim(dims, dayKey, "reject", code, {
        billed: 0,
        planPaid: 0,
        memberPaid: 0,
        rebate: 0,
        nadac: 0,
        dispensingFee: 0,
        allowed: 0,
        ingredientCost: 0,
        awp: 0,
      });
    }
  }

  return rows;
}

async function main() {
  const started = Date.now();
  console.log("Glass plan seed\n");

  console.log("Clearing simulated data...");
  await prisma.bookDayDimension.deleteMany();
  await prisma.bookDay.deleteMany();
  await prisma.accumulatorTransaction.deleteMany();
  /*
   * The medical carrier's feed. Its file identifiers are derived from the plan
   * year and the week number, so they are stable across runs by design, and a
   * second seed collides on them unless the previous run's files are cleared.
   * The transfers cascade from the member delete below, but not before the
   * files they belong to are gone.
   */
  await prisma.accumulatorTransfer.deleteMany();
  await prisma.accumulatorFile.deleteMany();
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
  await seedMichiganSponsorAndPlans(prisma);

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

  const MEMBER_CHUNK = 2_000;
  for (let i = 0; i < members.length; i += MEMBER_CHUNK) {
    const slice = members.slice(i, i + MEMBER_CHUNK);
    await prisma.member.createMany({
      data: slice.map((m) => ({
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
      data: slice.map((m) => ({
        id: `elig-${m.id}`,
        memberId: m.id,
        benefitPlanId: m.benefitPlanId,
        effectiveDate: m.effectiveDate,
        terminationDate: m.terminationDate,
        coverageTier: m.coverageTier,
        memberType: "Active",
      })),
    });
    process.stdout.write(
      `  ${Math.min(i + MEMBER_CHUNK, members.length).toLocaleString()} / ${members.length.toLocaleString()} written\r`,
    );
  }
  console.log(`  ${members.length.toLocaleString()} members written              `);

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

  const accumulatorTotals = new Map<
    string,
    { rxOop: number; fedOop: number; deductible: number; planId: string }
  >();
  const grantedPAs: GeneratedPriorAuth[] = [];
  const decidedPAs: DecidedPA[] = [];
  const medicalTransfers: MedicalTransfer[] = [];
  const days = new Map<number, DayTotals>();
  const dims = new Map<DimKey, DimTotals>();
  const classOf = new Map(
    drugs.map((d) => [d.id, d.therapeuticClass ?? "Unclassified"]),
  );

  const rng = new Rng(SEED + 1);
  const pools = buildDrugPools(drugsByClass, drugs);
  let claimSeq = 1;
  let claimsWritten = 0;

  for (let start = 0; start < members.length; start += MEMBER_BATCH) {
    const slice = members.slice(start, start + MEMBER_BATCH);
    const batch = generateClaims({
      members: slice,
      drugsByClass,
      allDrugs: drugs,
      specialtyDrugs,
      plans,
      contract,
      planYear: PLAN_YEAR,
      seed: SEED + 1,
      rng,
      pools,
      claimSeqStart: claimSeq,
    });
    claimSeq = batch.nextClaimSeq;
    grantedPAs.push(...batch.priorAuths);
    decidedPAs.push(...batch.decidedPriorAuths);
    medicalTransfers.push(...batch.medicalTransfers);

    const claimRows = buildClaimRows(
      batch.claims,
      accumulatorTotals,
      days,
      dims,
      classOf,
    );
    const CHUNK = 500;
    for (let i = 0; i < claimRows.length; i += CHUNK) {
      try {
        await prisma.claim.createMany({ data: claimRows.slice(i, i + CHUNK) });
      } catch (err) {
        await reportClaimFkFailure(claimRows.slice(i, i + CHUNK));
        throw err;
      }
    }
    claimsWritten += claimRows.length;
    process.stdout.write(
      `  ${claimsWritten.toLocaleString()} claims adjudicated and written` +
        ` (${Math.min(start + MEMBER_BATCH, members.length).toLocaleString()} / ${members.length.toLocaleString()} members)\r`,
    );
  }
  console.log(
    `  ${claimsWritten.toLocaleString()} claims adjudicated and written                    `,
  );

  // -----------------------------------------------------------------------
  console.log("\nWriting the daily rollup...");
  const dayRows: Prisma.BookDayCreateManyInput[] = [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, d]) => ({
      id: `day-${SPONSOR_ID}-${new Date(ms).toISOString().slice(0, 10)}`,
      sponsorId: SPONSOR_ID,
      date: new Date(ms),
      claimsSubmitted: d.claimsSubmitted,
      claimsPaid: d.claimsPaid,
      claimsRejected: d.claimsRejected,
      totalBilledCents: d.totalBilledCents,
      planPaidCents: d.planPaidCents,
      patientPayCents: d.patientPayCents,
      pharmacyPaidCents: d.pharmacyPaidCents,
      estimatedRebateCents: d.estimatedRebateCents,
      genericClaims: d.genericClaims,
      brandClaims: d.brandClaims,
      specialtyClaims: d.specialtyClaims,
      specialtyBilledCents: d.specialtyBilledCents,
      mailClaims: d.mailClaims,
      retailClaims: d.retailClaims,
      retail90Claims: d.retail90Claims,
      membersFilling: d.members.size,
    }));
  await prisma.bookDay.createMany({ data: dayRows });

  const dimRows: Prisma.BookDayDimensionCreateManyInput[] = [];
  for (const [k, v] of dims) {
    const [ms, dimension, key] = k.split("|");
    dimRows.push({
      id: `${SPONSOR_ID}|${k}`,
      sponsorId: SPONSOR_ID,
      date: new Date(Number(ms)),
      dimension,
      key,
      claims: v.claims,
      billedCents: v.billedCents,
      planPaidCents: v.planPaidCents,
      memberPaidCents: v.memberPaidCents,
      rebateCents: v.rebateCents,
      nadacCents: v.nadacCents,
      dispensingFeeCents: v.dispensingFeeCents,
      allowedCents: v.allowedCents,
      ingredientCostCents: v.ingredientCostCents,
      awpCents: v.awpCents,
    });
  }
  for (let i = 0; i < dimRows.length; i += 1000) {
    await prisma.bookDayDimension.createMany({
      data: dimRows.slice(i, i + 1000),
    });
  }
  console.log(
    `  ${dayRows.length} days summarised, ${dimRows.length.toLocaleString()} dimensional cells`,
  );

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
  await writeAccumulatorFiles(medicalTransfers);

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
  await seedExceptions(prisma, { planYear: PLAN_YEAR });

  // -----------------------------------------------------------------------
  if (MICHIGAN_CONTRACT_COUNT > 0) {
    await seedMichiganUtilisation({
      drugs,
      drugsByClass,
      specialtyDrugs,
      plans,
      classOf,
    });
  }

  // -----------------------------------------------------------------------
  const stats = await prisma.claim.aggregate({
    _sum: {
      totalBilledCents: true,
      planPaidCents: true,
      patientPayCents: true,
      estimatedRebateCents: true,
    },
    _count: true,
    where: { responseStatus: "P", sponsorId: SPONSOR_ID },
  });
  const rejected = await prisma.claim.count({
    where: { responseStatus: "R", sponsorId: SPONSOR_ID },
  });
  const memberCount = await prisma.member.count({
    where: { sponsorId: SPONSOR_ID },
  });
  const miPaid = await prisma.claim.count({
    where: { responseStatus: "P", sponsorId: MICHIGAN_SPONSOR_ID },
  });
  const miSpread = await prisma.claim.aggregate({
    where: { responseStatus: "P", sponsorId: MICHIGAN_SPONSOR_ID },
    _sum: { totalBilledCents: true, totalAllowedCents: true },
  });

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
  console.log(
    `  Member share of spend   ${(((stats._sum.patientPayCents ?? 0) / (stats._sum.totalBilledCents ?? 1)) * 100).toFixed(1)}%  (ET-8933 reports 10.6%)`,
  );
  if (MICHIGAN_CONTRACT_COUNT > 0) {
    const spreadCents =
      (miSpread._sum.totalBilledCents ?? 0) - (miSpread._sum.totalAllowedCents ?? 0);
    console.log(
      `  Michigan paid claims    ${miPaid.toLocaleString()}  (spread ${formatCents(spreadCents)})`,
    );
  }
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/**
 * Isolated Traditional utilisation book for Lakeside Fabricators / Michigan.
 * Does not touch Steel Potatoes members, claims, or rollups.
 */
async function seedMichiganUtilisation(args: {
  drugs: DrugCandidate[];
  drugsByClass: Map<string, DrugCandidate[]>;
  specialtyDrugs: DrugCandidate[];
  plans: Map<string, EngineBenefitPlan>;
  classOf: Map<string, string>;
}) {
  console.log("\nGenerating Michigan Traditional book (Lakeside Fabricators)...");
  const miMembers = generatePopulation({
    contractCount: MICHIGAN_CONTRACT_COUNT,
    planYear: PLAN_YEAR,
    seed: SEED + 77,
    hdhpShare: 0.18,
    cardholderPrefix: "M",
    iycPlanId: MICHIGAN_IYC_PLAN_ID,
    hdhpPlanId: MICHIGAN_HDHP_PLAN_ID,
    state: "MI",
    cities: [
      ["Detroit", "48201"],
      ["Grand Rapids", "49503"],
      ["Ann Arbor", "48104"],
      ["Lansing", "48933"],
      ["Kalamazoo", "49007"],
      ["Flint", "48502"],
      ["Traverse City", "49684"],
      ["Marquette", "49855"],
    ],
    memberIdPrefix: "mi-",
  });
  console.log(
    `  ${miMembers.length.toLocaleString()} Michigan members across ${MICHIGAN_CONTRACT_COUNT.toLocaleString()} contracts`,
  );

  const MEMBER_CHUNK = 2_000;
  for (let i = 0; i < miMembers.length; i += MEMBER_CHUNK) {
    const slice = miMembers.slice(i, i + MEMBER_CHUNK);
    await prisma.member.createMany({
      data: slice.map((m) => ({
        id: m.id,
        sponsorId: MICHIGAN_SPONSOR_ID,
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
      data: slice.map((m) => ({
        id: `elig-${m.id}`,
        memberId: m.id,
        benefitPlanId: m.benefitPlanId,
        effectiveDate: m.effectiveDate,
        terminationDate: m.terminationDate,
        coverageTier: m.coverageTier,
        memberType: "Active",
      })),
    });
  }

  const miContract = await loadEngineContract(MICHIGAN_CONTRACT_ID);
  const miDays = new Map<number, DayTotals>();
  const miDims = new Map<DimKey, DimTotals>();
  const miAccumulators = new Map<
    string,
    { rxOop: number; fedOop: number; deductible: number; planId: string }
  >();
  const miRng = new Rng(SEED + 99);
  const miPools = buildDrugPools(args.drugsByClass, args.drugs);
  let miClaimSeq = 80_000_000;
  let miClaimsWritten = 0;

  for (let start = 0; start < miMembers.length; start += MEMBER_BATCH) {
    const slice = miMembers.slice(start, start + MEMBER_BATCH);
    const batch = generateClaims({
      members: slice,
      drugsByClass: args.drugsByClass,
      allDrugs: args.drugs,
      specialtyDrugs: args.specialtyDrugs,
      plans: args.plans,
      contract: miContract,
      planYear: PLAN_YEAR,
      seed: SEED + 99,
      rng: miRng,
      pools: miPools,
      claimSeqStart: miClaimSeq,
    });
    miClaimSeq = batch.nextClaimSeq;
    const claimRows = buildClaimRows(
      batch.claims,
      miAccumulators,
      miDays,
      miDims,
      args.classOf,
      MICHIGAN_SPONSOR_ID,
      MICHIGAN_CONTRACT_ID,
    );
    const CHUNK = 500;
    for (let i = 0; i < claimRows.length; i += CHUNK) {
      await prisma.claim.createMany({ data: claimRows.slice(i, i + CHUNK) });
    }
    miClaimsWritten += claimRows.length;
    process.stdout.write(
      `  ${miClaimsWritten.toLocaleString()} Michigan claims written` +
        ` (${Math.min(start + MEMBER_BATCH, miMembers.length).toLocaleString()} / ${miMembers.length.toLocaleString()} members)\r`,
    );
  }
  console.log(
    `  ${miClaimsWritten.toLocaleString()} Michigan claims written                    `,
  );

  const miDayRows: Prisma.BookDayCreateManyInput[] = [...miDays.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, d]) => ({
      id: `day-${MICHIGAN_SPONSOR_ID}-${new Date(ms).toISOString().slice(0, 10)}`,
      sponsorId: MICHIGAN_SPONSOR_ID,
      date: new Date(ms),
      claimsSubmitted: d.claimsSubmitted,
      claimsPaid: d.claimsPaid,
      claimsRejected: d.claimsRejected,
      totalBilledCents: d.totalBilledCents,
      planPaidCents: d.planPaidCents,
      patientPayCents: d.patientPayCents,
      pharmacyPaidCents: d.pharmacyPaidCents,
      estimatedRebateCents: d.estimatedRebateCents,
      genericClaims: d.genericClaims,
      brandClaims: d.brandClaims,
      specialtyClaims: d.specialtyClaims,
      specialtyBilledCents: d.specialtyBilledCents,
      mailClaims: d.mailClaims,
      retailClaims: d.retailClaims,
      retail90Claims: d.retail90Claims,
      membersFilling: d.members.size,
    }));
  await prisma.bookDay.createMany({ data: miDayRows });

  const miDimRows: Prisma.BookDayDimensionCreateManyInput[] = [];
  for (const [k, v] of miDims) {
    const [ms, dimension, key] = k.split("|");
    miDimRows.push({
      id: `${MICHIGAN_SPONSOR_ID}|${k}`,
      sponsorId: MICHIGAN_SPONSOR_ID,
      date: new Date(Number(ms)),
      dimension,
      key,
      claims: v.claims,
      billedCents: v.billedCents,
      planPaidCents: v.planPaidCents,
      memberPaidCents: v.memberPaidCents,
      rebateCents: v.rebateCents,
      nadacCents: v.nadacCents,
      dispensingFeeCents: v.dispensingFeeCents,
      allowedCents: v.allowedCents,
      ingredientCostCents: v.ingredientCostCents,
      awpCents: v.awpCents,
    });
  }
  for (let i = 0; i < miDimRows.length; i += 1000) {
    await prisma.bookDayDimension.createMany({
      data: miDimRows.slice(i, i + 1000),
    });
  }
  console.log(
    `  ${miDayRows.length} Michigan days, ${miDimRows.length.toLocaleString()} dimensional cells`,
  );

  const planLimits = new Map(
    (await prisma.benefitPlan.findMany({
      where: { sponsorId: MICHIGAN_SPONSOR_ID },
    })).map((p) => [p.id, p]),
  );
  const accumulatorRows: Prisma.AccumulatorCreateManyInput[] = [];
  for (const [memberId, acc] of miAccumulators) {
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
    await prisma.accumulator.createMany({
      data: accumulatorRows.slice(i, i + 500),
    });
  }
}

/**
 * Write the medical carrier's accumulator files.
 *
 * The rows are not an input to adjudication — the engine already consumed the
 * same encounters while the claims were being priced, from the same
 * deterministic generator. They are written so the balance the engine charged
 * against is inspectable rather than implicit, and so the member portal can
 * show a member why a pharmacy claim went to deductible when they had already
 * paid a hospital bill.
 *
 * Batched into weekly files with a lag, because that is how they arrive. The
 * lag is not decoration: a claim adjudicated before its file lands is priced
 * against a balance the carrier had already superseded, and that gap is where
 * integrated-deductible disputes actually come from.
 */
async function writeAccumulatorFiles(transfers: MedicalTransfer[]) {
  if (transfers.length === 0) return;
  console.log("\nWriting the medical carrier's accumulator files...");

  const yearStart = Date.UTC(PLAN_YEAR, 0, 1);
  const WEEK = 7 * 86_400_000;
  /** Business days between a service being incurred and the file carrying it. */
  const FILE_LAG_DAYS = 9;

  interface Pending {
    rows: Prisma.AccumulatorTransferCreateManyInput[];
    totalCents: number;
  }
  const byWeek = new Map<number, Pending>();

  for (const t of transfers) {
    for (const e of t.encounters) {
      const week = Math.floor(e.day / 7);
      const bucket = byWeek.get(week) ?? { rows: [], totalCents: 0 };
      const incurredAt = new Date(yearStart + e.day * 86_400_000);
      bucket.rows.push({
        memberId: t.memberId,
        accumulatorType: "Deductible",
        incurredAt,
        amountCents: e.amountCents,
        fileId: accumulatorFileId(week),
        receivedAt: new Date(
          yearStart + (week * 7 + 7 + FILE_LAG_DAYS) * 86_400_000,
        ),
        serviceDescription: e.description,
      });
      bucket.totalCents += e.amountCents;
      byWeek.set(week, bucket);
    }
  }

  const fileRows: Prisma.AccumulatorFileCreateManyInput[] = [];
  for (const [week, bucket] of [...byWeek.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    /*
     * Hashed over the record contents rather than assigned, so the same book
     * produces the same file identity and a reader can tell whether a file
     * they were shown is the file that was loaded.
     */
    const body = bucket.rows
      .map(
        (r) =>
          `${r.memberId}|${(r.incurredAt as Date).toISOString().slice(0, 10)}|${r.amountCents}|${r.serviceDescription}`,
      )
      .sort()
      .join("\n");
    fileRows.push({
      id: accumulatorFileId(week),
      sender: "Wisconsin ETF medical carrier, integrated accumulator feed",
      receivedAt: new Date(
        yearStart + (week * 7 + 7 + FILE_LAG_DAYS) * 86_400_000,
      ),
      periodStart: new Date(yearStart + week * WEEK),
      periodEnd: new Date(yearStart + week * WEEK + WEEK - 1),
      recordCount: bucket.rows.length,
      totalCents: bucket.totalCents,
      contentHash: createHash("sha256").update(body).digest("hex"),
    });
  }
  await prisma.accumulatorFile.createMany({ data: fileRows });

  let written = 0;
  for (const bucket of byWeek.values()) {
    for (let i = 0; i < bucket.rows.length; i += 1000) {
      await prisma.accumulatorTransfer.createMany({
        data: bucket.rows.slice(i, i + 1000),
      });
      written += Math.min(1000, bucket.rows.length - i);
    }
  }
  console.log(
    `  ${fileRows.length} weekly files, ${written.toLocaleString()} deductible records for ${transfers.length.toLocaleString()} members`,
  );
}

/**
 * Name the reference a batch of claims points at and cannot find.
 *
 * SQLite reports a foreign key failure without saying which key, and Prisma
 * passes that along, so a batch insert of five hundred claims fails with
 * nothing to go on. This checks each reference against what is actually in the
 * database and names the first one missing.
 */
async function reportClaimFkFailure(
  rows: Prisma.ClaimCreateManyInput[],
): Promise<void> {
  const ids = async (
    table: string,
    values: Iterable<string | null | undefined>,
  ) => {
    const wanted = [...new Set([...values].filter(Boolean))] as string[];
    if (wanted.length === 0) return;
    const found = new Set(
      (
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM ${table} WHERE id IN (${wanted.map(() => "?").join(",")})`,
          ...wanted,
        )
      ).map((r) => r.id),
    );
    const missing = wanted.filter((v) => !found.has(v));
    if (missing.length > 0) {
      console.error(
        `\n  ${table}: ${missing.length} of ${wanted.length} referenced rows do not exist`,
      );
      console.error(`    ${missing.slice(0, 8).join(", ")}`);
    }
  };

  console.error("\nChecking which reference the failed batch cannot resolve:");
  await ids("PlanSponsor", rows.map((r) => r.sponsorId));
  await ids("Member", rows.map((r) => r.memberId));
  await ids("EligibilitySpan", rows.map((r) => r.eligibilitySpanId));
  await ids("BenefitPlan", rows.map((r) => r.benefitPlanId));
  await ids("Pharmacy", rows.map((r) => r.pharmacyId));
  await ids("Drug", rows.map((r) => r.drugId));
  await ids("Contract", rows.map((r) => r.contractId));
  await ids("ConfigVersion", rows.map((r) => r.configVersionId));
}

function accumulatorFileId(week: number): string {
  return `acc-${PLAN_YEAR}-w${String(week + 1).padStart(2, "0")}`;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
