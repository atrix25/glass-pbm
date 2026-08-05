/**
 * Plants deliberate program-integrity cases in the book.
 *
 * The generated population is random, and random data contains no fraud. Run
 * the detectors against it and they correctly find almost nothing, which is
 * reassuring about their specificity and useless as evidence that they work.
 * So this plants a small number of cases with a coherent story and leaves the
 * detectors to find them unaided: they are never told where to look, and the
 * proof harness asserts afterwards that every planted case surfaced.
 *
 * Two of the three cases need no new claims at all. A prescriber who writes an
 * improbable share of controlled substances and a pharmacy that dispenses an
 * improbable share of them are both patterns in the attribution of claims that
 * already exist, so they are made by moving prescriber and pharmacy on claims
 * already in the book. Pharmacies only ever move between retail siblings, so
 * channel, contract rate and every exclusion stay exactly as adjudicated.
 *
 * The overutilisation case does need new claims, because the pattern is a dose
 * nobody in the book happens to reach. Those go through the real engine and
 * carry a scenario tag, which keeps them out of the daily rollups and leaves
 * the book's own totals untouched.
 *
 *   npx tsx scripts/seed-integrity-cases.ts
 */

import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
import {
  adjudicate,
  type AdjudicationContext,
  type EngineBenefitPlan,
  type EngineContract,
  type EngineCostShareRule,
  type EngineFormularyEntry,
  type EngineRate,
} from "../src/lib/engine/adjudicate.js";
import type { Channel, PricingArm } from "../src/lib/engine/types.js";
import { loadWorld } from "../src/lib/engine/replay.js";
import { PHARMACIES, SPONSOR_ID } from "./seed/world.js";
import { CONTROLLED_CLASSES } from "../src/lib/clinical/interactions.js";

const PLAN_YEAR = 2026;
const CONTRACT_ID = "etg0013";
const FORMULARY_ID = "navitus-etf-2026";
const CASE_FILE = "data/integrity-cases.json";

export interface SeededCaseRegistry {
  members: Array<{ id: string; caseId: string; story: string }>;
  prescribers: Array<{ npi: string; caseId: string; story: string }>;
  pharmacies: Array<{ id: string; caseId: string; story: string }>;
}

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

async function loadEngineContract(): Promise<EngineContract> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: CONTRACT_ID },
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
    clientMacMultiplier: 1,
    rebatePassThroughBps: contract.rebatePassThroughBps,
  };
}

const controlledList = CONTROLLED_CLASSES.map(
  (c) => `'${c.replace(/'/g, "''")}'`,
).join(",");

/** The share of one subject's paid claims that fall in a controlled class. */
async function controlledShare(
  column: "prescriberNpi" | "pharmacyId",
  value: string,
): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<
    Array<{ total: number; controlled: number }>
  >(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN d.therapeuticClass IN (${controlledList}) THEN 1 ELSE 0 END) AS controlled
    FROM Claim c JOIN Drug d ON d.id = c.drugId
    WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1' AND c.${column} = '${value}'
  `);
  const total = Number(row?.total ?? 0);
  return total === 0 ? 0 : Number(row.controlled) / total;
}

async function main() {
  const started = Date.now();
  const registry: SeededCaseRegistry = {
    members: [],
    prescribers: [],
    pharmacies: [],
  };

  // Start from a clean slate so this is repeatable.
  await prisma.claim.deleteMany({
    where: { scenarioTag: { startsWith: "integrity-" } },
  });
  await prisma.prescriber.updateMany({
    where: { seededCase: { not: null } },
    data: { seededCase: null },
  });

  await seedPrescriberCase(registry);
  await seedPharmacyCase(registry);
  await seedOverutilisationCase(registry);

  writeFileSync(CASE_FILE, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`\nRegistry written to ${CASE_FILE}`);
  console.log(
    `${registry.members.length} members, ${registry.prescribers.length} prescribers, ` +
      `${registry.pharmacies.length} pharmacies planted`,
  );
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/**
 * A family physician writing controlled substances at a rate no other family
 * physician approaches.
 *
 * Built by moving claims that already exist onto one prescriber. Nothing about
 * the claims changes; only who is recorded as having written them.
 */
async function seedPrescriberCase(registry: SeededCaseRegistry) {
  const target = await prisma.prescriber.findFirstOrThrow({
    where: { specialty: "Family Medicine" },
    orderBy: { npi: "asc" },
  });

  // Clear whatever this prescriber currently holds so the share is not diluted
  // by an existing panel, then hand them a book that is mostly controlled.
  const others = await prisma.prescriber.findMany({
    where: { specialty: "Family Medicine", npi: { not: target.npi } },
    select: { npi: true },
    take: 40,
  });
  const spread = others.map((o) => `'${o.npi}'`).join(",");
  await prisma.$executeRawUnsafe(`
    UPDATE Claim SET prescriberNpi = (
      SELECT npi FROM (SELECT ${spread.split(",").map((n, i) => `${n} AS npi, ${i} AS i`).join(" UNION ALL SELECT ")})
      WHERE i = ABS(CAST(SUBSTR(Claim.claimNumber, 4) AS INTEGER)) % ${others.length}
    )
    WHERE prescriberNpi = '${target.npi}'
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE Claim SET prescriberNpi = '${target.npi}'
    WHERE id IN (
      SELECT c.id FROM Claim c JOIN Drug d ON d.id = c.drugId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND d.therapeuticClass IN (${controlledList})
      ORDER BY c.claimNumber LIMIT 420
    )
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE Claim SET prescriberNpi = '${target.npi}'
    WHERE id IN (
      SELECT c.id FROM Claim c JOIN Drug d ON d.id = c.drugId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND (d.therapeuticClass NOT IN (${controlledList}) OR d.therapeuticClass IS NULL)
      ORDER BY c.claimNumber LIMIT 240
    )
  `);

  const share = await controlledShare("prescriberNpi", target.npi);
  const story =
    `${(share * 100).toFixed(0)} per cent of this family physician's prescriptions are ` +
    `controlled substances, against a specialty median near five per cent.`;
  await prisma.prescriber.update({
    where: { npi: target.npi },
    data: { seededCase: story },
  });
  registry.prescribers.push({
    npi: target.npi,
    caseId: "prescriber-concentration",
    story,
  });
  console.log(
    `Prescriber case: ${target.firstName} ${target.lastName}, ${target.credential} (${target.npi})`,
  );
}

/**
 * An independent pharmacy dispensing controlled substances well above the rest
 * of the network.
 *
 * Fills only ever move between retail pharmacies, so the channel on every
 * claim is unchanged and so is everything the contract priced off it.
 */
async function seedPharmacyCase(registry: SeededCaseRegistry) {
  const targetId = "ph-ind-osh";
  await prisma.$executeRawUnsafe(`
    UPDATE Claim SET pharmacyId = '${targetId}'
    WHERE id IN (
      SELECT c.id FROM Claim c
      JOIN Drug d ON d.id = c.drugId
      JOIN Pharmacy p ON p.id = c.pharmacyId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND d.therapeuticClass IN (${controlledList})
        AND p.pharmacyType IN ('Chain', 'Independent')
        AND p.is340B = 0 AND p.id <> 'ph-oon-illinois'
      ORDER BY c.claimNumber DESC LIMIT 3200
    )
  `);

  const pharmacy = await prisma.pharmacy.findUniqueOrThrow({
    where: { id: targetId },
  });
  const share = await controlledShare("pharmacyId", targetId);
  const story =
    `${(share * 100).toFixed(0)} per cent of what this pharmacy dispenses is a controlled ` +
    `substance, against a network median near five per cent.`;
  registry.pharmacies.push({
    id: targetId,
    caseId: "pharmacy-mix",
    story,
  });
  console.log(`Pharmacy case: ${pharmacy.name}`);
}


/** How many overutilisation members the case set needs. */
const WANTED_CASES = 3;

interface PlannedFill {
  dateOfService: Date;
  fillNumber: number;
  drug: {
    id: string;
    ndc11: string;
    name: string;
    monyCode: string;
    isBrandLabel: boolean;
    isSpecialty: boolean;
    therapeuticClass: string | null;
    unitOfMeasure: string;
    packageSize: number;
    packageContainers: string | null;
  };
  nadacPerUnit: number;
  quantity: number;
  daysSupply: number;
  uandcCents: number;
  ingredientCostSubmittedCents: number;
  prescriber: { npi: string };
  pharmacy: {
    id: string;
    npi: string;
    name: string;
    pharmacyType: string;
    isDesignatedSpecialty?: boolean;
    is340B?: boolean;
  };
  formularyEntry: EngineFormularyEntry;
}

interface RunningPosition {
  rxOopAccumulatedCents: number;
  federalOopAccumulatedCents: number;
  deductibleAccumulatedCents: number;
}

/**
 * Splice a course of therapy into a member's year and price it in place.
 *
 * Two things have to be true of a planted case, and they pull against each
 * other. The new fills have to be priced as though they had really arrived at
 * the counter on those dates, which means seeing the member's position at that
 * moment rather than an empty one. And the member's existing claims have to
 * come out unchanged, because they are already stored, already rolled up, and
 * already reported.
 *
 * Both are settled by walking the year once, in date order, with the new fills
 * merged into the real ones. New fills are adjudicated and kept; existing ones
 * are re-adjudicated and checked. Fifteen fills consume deductible and
 * out-of-pocket credit, so a claim the member made in July can genuinely move
 * across a limit because of one inserted in March. That is not a bug, it is
 * what would have happened — but the rest of the book has already been written
 * on the assumption it did not. Rather than repair the book, this returns null
 * and the caller tries the next member.
 */
async function spliceIntoYear(
  memberId: string,
  planned: PlannedFill[],
  ctx: {
    world: Awaited<ReturnType<typeof loadWorld>>;
    plans: Map<string, EngineBenefitPlan>;
    contract: EngineContract;
    therapeuticClassById: Map<string, string | null>;
  },
): Promise<Array<{
  fill: PlannedFill;
  outcome: ReturnType<typeof adjudicate>;
  rxNumber: string;
}> | null> {
  const { world, plans, contract, therapeuticClassById } = ctx;
  const elig = world.eligibility.get(memberId);
  const plan = elig ? plans.get(elig.benefitPlanId) : null;
  const facts = world.members.get(memberId);
  if (!elig || !plan || !facts) return null;

  const existing = await prisma.claim.findMany({
    where: { memberId, transactionCode: "B1", scenarioTag: null },
    orderBy: [{ dateOfService: "asc" }, { claimNumber: "asc" }],
  });

  const acc: RunningPosition = {
    rxOopAccumulatedCents: 0,
    federalOopAccumulatedCents: 0,
    deductibleAccumulatedCents: 0,
  };
  const priorFills: Array<{
    dateOfService: Date;
    daysSupply: number;
    quantityDispensed: number;
    drugId: string;
    therapeuticClass: string | null;
  }> = [];

  function absorb(outcome: ReturnType<typeof adjudicate>) {
    for (const d of outcome.costShare?.accumulatorDeltas ?? []) {
      const cents = Math.round(d.amountMicros / 10_000);
      if (d.accumulatorType === "RxOopIndividual")
        acc.rxOopAccumulatedCents += cents;
      if (d.accumulatorType === "FederalOopIndividual")
        acc.federalOopAccumulatedCents += cents;
      if (d.accumulatorType === "DeductibleIndividual")
        acc.deductibleAccumulatedCents += cents;
    }
  }

  const queue = [
    ...existing.map((c) => ({ at: c.dateOfService, stored: c, fill: null })),
    ...planned.map((f) => ({ at: f.dateOfService, stored: null, fill: f })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const results: Array<{
    fill: PlannedFill;
    outcome: ReturnType<typeof adjudicate>;
    rxNumber: string;
  }> = [];
  let rxSeq = 0;

  for (const item of queue) {
    if (item.fill) {
      const f = item.fill;
      rxSeq++;
      const rxNumber = `RX${String(9_400_000 + rxSeq).slice(-7)}`;
      const outcome = adjudicate({
        request: {
          dateOfService: f.dateOfService,
          cardholderId: "",
          personCode: "01",
          serviceProviderId: f.pharmacy.npi,
          productServiceId: f.drug.ndc11,
          rxNumber,
          fillNumber: f.fillNumber,
          quantityDispensed: f.quantity,
          daysSupply: f.daysSupply,
          dawCode: "0",
          usualAndCustomaryCents: f.uandcCents,
          ingredientCostSubmittedCents: f.ingredientCostSubmittedCents,
          compoundCode: "1",
        },
        member: { id: memberId, diagnosisCodes: ["M54"], weightKg: 82 },
        eligibility: elig,
        plan,
        drug: {
          ...f.drug,
          nadacPerUnit: f.nadacPerUnit,
          // Parsed rather than spread: the column holds JSON, and handing the
          // engine the string would leave it believing it had package data
          // while every container lookup came back empty.
          packageContainers: f.drug.packageContainers
            ? (JSON.parse(f.drug.packageContainers) as Record<string, number>)
            : null,
        },
        formularyEntry: f.formularyEntry,
        pharmacy: {
          id: f.pharmacy.id,
          npi: f.pharmacy.npi,
          name: f.pharmacy.name,
          pharmacyType: f.pharmacy.pharmacyType,
          isDesignatedSpecialty: f.pharmacy.isDesignatedSpecialty ?? false,
          is340B: f.pharmacy.is340B ?? false,
          inNetwork: true,
        },
        contract,
        priorFills,
        accumulators: { ...acc },
        approvedPAs: [],
      });

      // A rejected planted fill contributes no dose, which is the whole
      // purpose of the case, so the candidate is no good.
      if (outcome.responseStatus !== "P") return null;

      absorb(outcome);
      priorFills.push({
        dateOfService: f.dateOfService,
        daysSupply: f.daysSupply,
        quantityDispensed: f.quantity,
        drugId: f.drug.id,
        therapeuticClass: f.drug.therapeuticClass,
      });
      results.push({ fill: f, outcome, rxNumber });
      continue;
    }

    const c = item.stored!;
    const drug = world.drugs.get(c.drugId);
    const pharmacy = world.pharmacies.get(c.pharmacyId);
    if (!drug || !pharmacy) return null;

    const outcome = adjudicate({
      request: {
        dateOfService: c.dateOfService,
        cardholderId: "",
        personCode: "01",
        serviceProviderId: pharmacy.npi,
        productServiceId: drug.ndc11,
        rxNumber: c.rxNumber,
        fillNumber: c.fillNumber,
        quantityDispensed: c.quantityDispensed,
        daysSupply: c.daysSupply,
        dawCode: c.dawCode,
        usualAndCustomaryCents: c.usualAndCustomaryCents,
        ingredientCostSubmittedCents: c.ingredientCostSubmittedCents,
        compoundCode: c.compoundCode,
      },
      member: {
        id: memberId,
        diagnosisCodes: facts.diagnosisCodes,
        weightKg: facts.weightKg,
      },
      eligibility: elig,
      plan,
      drug,
      formularyEntry: world.formulary.get(c.drugId) ?? null,
      pharmacy,
      contract,
      priorFills,
      accumulators: { ...acc },
      approvedPAs: world.approvedPAs.get(memberId) ?? [],
    });

    /*
     * Plan and member pay matching is not enough. On an HDHP a fill can cost
     * the member the same dollar amount before and after the deductible is met
     * (the copay is simply capped at the total), while appliedToDeductible
     * flips from the whole fill to zero. Leaving that unchecked let planted
     * early-year fills consume the deductible on paper while the member's
     * existing claims kept their old appliedToDeductible figures — so every
     * derivation for those claims disagreed with the book.
     */
    if (
      outcome.responseStatus !== c.responseStatus ||
      outcome.planPaidCents !== c.planPaidCents ||
      outcome.patientPayCents !== c.patientPayCents ||
      outcome.appliedToDeductibleCents !== c.appliedToDeductibleCents ||
      outcome.totalBilledCents !== c.totalBilledCents
    ) {
      return null;
    }

    if (outcome.responseStatus === "P") {
      absorb(outcome);
      priorFills.push({
        dateOfService: c.dateOfService,
        daysSupply: c.daysSupply,
        quantityDispensed: c.quantityDispensed,
        drugId: c.drugId,
        therapeuticClass: therapeuticClassById.get(c.drugId) ?? null,
      });
    }
  }

  return results;
}

/**
 * Members meeting the federal overutilisation criteria: a high daily dose
 * assembled from several prescribers across several pharmacies.
 *
 * These need real claims, because no member in the generated book reaches the
 * dose. Every fill below goes through the same engine as the rest of the book
 * and is priced by the same contract.
 */
async function seedOverutilisationCase(registry: SeededCaseRegistry) {
  const plans = await loadEnginePlans();
  const contract = await loadEngineContract();
  /*
   * Eligibility comes from the engine's own world rather than a query written
   * here. A member can hold more than one span, and picking a different one
   * than the engine would picks a different benefit design: the fill would be
   * seeded under one plan and replayed under another, and the difference would
   * surface as a phantom pricing failure.
   */
  const world = await loadWorld();

  /*
   * Three overlapping opioids adding to roughly 170 MME a day, well past the
   * CDC ceiling. All three are unrestricted on this formulary: no prior
   * authorisation, no step therapy, no quantity limit. That is the point. The
   * pattern is not built by defeating a control, it is built in the space
   * where the plan has no control at all, which is exactly where surveillance
   * has to do the work.
   */
  const drugIds = [
    "drug-00054094525", // tapentadol 100 mg, 40 MME per tablet
    "drug-00406851001", // oxycodone IR 10 mg, 15 MME per tablet
    "drug-00406324301", // hydromorphone 2 mg, 10 MME per tablet
  ];
  const drugs = await prisma.drug.findMany({
    where: { id: { in: drugIds } },
    include: {
      prices: true,
      formularyEntries: { where: { formularyId: FORMULARY_ID } },
    },
  });
  const drugById = new Map(drugs.map((d) => [d.id, d]));

  const therapeuticClassById = new Map(
    (
      await prisma.drug.findMany({
        select: { id: true, therapeuticClass: true },
      })
    ).map((d) => [d.id, d.therapeuticClass]),
  );

  const prescribers = await prisma.prescriber.findMany({
    where: { specialty: { in: ["Pain Management", "Family Medicine"] } },
    take: 9,
    orderBy: { npi: "desc" },
  });
  const pharmacies = PHARMACIES.filter(
    (p) =>
      (p.pharmacyType === "Chain" || p.pharmacyType === "Independent") &&
      !p.is340B &&
      p.inLimitedNetwork !== false,
  ).slice(0, 6);

  /*
   * Each member is priced on their own plan, not a representative one. These
   * fills sit in the middle of a real claim history, so they have to see the
   * same benefit design and the same accumulator balances the rest of that
   * member's year saw. Pricing them against a stand-in plan with empty
   * accumulators produces claims that charge a member who has already met her
   * out-of-pocket maximum, which replay catches immediately.
   */
  const candidates = await prisma.$queryRawUnsafe<
    Array<{ memberId: string; firstName: string; lastName: string }>
  >(`
    SELECT c.memberId AS memberId, m.firstName AS firstName, m.lastName AS lastName
    FROM Claim c
    JOIN Drug d ON d.id = c.drugId
    JOIN Member m ON m.id = c.memberId
    JOIN EligibilitySpan e ON e.memberId = m.id
    WHERE c.responseStatus = 'P' AND d.therapeuticClass = 'ANALGESICS - OPIOID'
      AND e.terminationDate IS NULL
    GROUP BY c.memberId
    HAVING COUNT(*) >= 6
    ORDER BY c.memberId LIMIT 400
  `);

  const [{ maxSeq }] = await prisma.$queryRaw<Array<{ maxSeq: bigint | null }>>`
    SELECT MAX(CAST(SUBSTR(claimNumber, 4) AS INTEGER)) AS maxSeq FROM Claim
  `;
  let seq = Number(maxSeq ?? 0) + 5000;

  const rows: Array<Record<string, unknown>> = [];
  let accepted = 0;

  for (const member of candidates) {
    if (accepted >= WANTED_CASES) break;

    const elig = world.eligibility.get(member.memberId);
    if (!elig) continue;
    const plan = plans.get(elig.benefitPlanId);
    if (!plan) continue;

    // Five months of therapy, each month layering all three products.
    const planned: PlannedFill[] = [];
    for (let month = 0; month < 5; month++) {
      for (let di = 0; di < drugIds.length; di++) {
        const drug = drugById.get(drugIds[di]);
        const entry = drug?.formularyEntries[0];
        if (!drug || !entry) continue;

        const quantity = di === 0 ? 60 : di === 1 ? 120 : 90;
        const nadacPerUnit = drug.prices[0]?.unitPrice ?? 0.5;
        const uandcCents = Math.round(nadacPerUnit * quantity * 165);
        planned.push({
          dateOfService: new Date(Date.UTC(PLAN_YEAR, 1 + month, 3 + di * 2)),
          fillNumber: month,
          drug,
          nadacPerUnit,
          quantity,
          daysSupply: 30,
          uandcCents,
          ingredientCostSubmittedCents: Math.round(uandcCents * 0.96),
          // Prescriber and pharmacy rotate on every fill, which is the pattern.
          prescriber: prescribers[(accepted * 3 + month * 3 + di) % prescribers.length],
          pharmacy: pharmacies[(accepted * 2 + month + di) % pharmacies.length],
          formularyEntry: {
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
            requiredDiagnosisCodes: JSON.parse(
              entry.requiredDiagnosisCodes,
            ) as string[],
            diagnosisRawText: entry.diagnosisRawText,
          } satisfies EngineFormularyEntry,
        });
      }
    }

    const spliced = await spliceIntoYear(
      member.memberId,
      planned,
      { world, plans, contract, therapeuticClassById },
    );
    if (!spliced) continue;

    const caseIndex = accepted + 1;
    for (const { fill, outcome, rxNumber } of spliced) {
      seq++;
      rows.push({
        claimNumber: `CLM${String(seq).padStart(9, "0")}`,
        transactionCode: "B1",
        sponsorId: SPONSOR_ID,
        memberId: member.memberId,
        eligibilitySpanId: elig.id,
        benefitPlanId: elig.benefitPlanId,
        pharmacyId: fill.pharmacy.id,
        drugId: fill.drug.id,
        contractId: contract.id,
        dateOfService: fill.dateOfService,
        rxNumber,
        fillNumber: fill.fillNumber,
        quantityDispensed: fill.quantity,
        daysSupply: fill.daysSupply,
        dawCode: "0",
        prescriberNpi: fill.prescriber.npi,
        compoundCode: "1",
        usualAndCustomaryCents: fill.uandcCents,
        ingredientCostSubmittedCents: fill.ingredientCostSubmittedCents,
        grossAmountDueCents: fill.ingredientCostSubmittedCents,
        responseStatus: outcome.responseStatus,
        rejectCodes: JSON.stringify(outcome.rejectCodes),
        rejectMessage: outcome.rejectMessage ?? null,
        allowedIngredientCostCents: outcome.allowedIngredientCostCents,
        allowedDispensingFeeCents: outcome.allowedDispensingFeeCents,
        totalAllowedCents: outcome.totalAllowedCents,
        basisOfReimbursement: outcome.pricing?.basisOfReimbursement ?? null,
        pharmacyPaidCents: outcome.pharmacyPaidCents,
        billedIngredientCostCents: outcome.billedIngredientCostCents,
        billedDispensingFeeCents: outcome.billedDispensingFeeCents,
        totalBilledCents: outcome.totalBilledCents,
        planPaidCents: outcome.planPaidCents,
        patientPayCents: outcome.patientPayCents,
        appliedToDeductibleCents: outcome.appliedToDeductibleCents,
        copayCoinsuranceCents: outcome.copayCoinsuranceCents,
        brandSelectionPenaltyCents: outcome.brandSelectionPenaltyCents,
        awpUnitAtDos: outcome.awpUnitAtDos ?? null,
        awpTotalCents: outcome.awpTotalCents ?? null,
        nadacUnitAtDos: outcome.nadacUnitAtDos ?? null,
        nadacTotalCents: outcome.nadacTotalCents ?? null,
        macUnitAtDos: outcome.macUnitAtDos ?? null,
        awpIsSimulated: outcome.awpIsSimulated,
        brandGenericClass: outcome.brandGeneric,
        channel: outcome.channel,
        formularyLevel: outcome.formularyLevel ?? null,
        isSpecialtyClaim: outcome.isSpecialtyClaim,
        excludedFromDiscountGuarantee: outcome.excludedFromDiscountGuarantee,
        discountExclusionReason: outcome.discountExclusionReason ?? null,
        rebateEligible: outcome.rebateEligible,
        rebateExclusionReason: outcome.rebateExclusionReason ?? null,
        estimatedRebateCents: outcome.estimatedRebateCents,
        scenarioTag: `integrity-overutilisation-${caseIndex}`,
        traceJson: JSON.stringify(outcome.trace),
        adjudicatedAt: fill.dateOfService,
      });
    }

    accepted++;
    registry.members.push({
      id: member.memberId,
      caseId: "opioid-overutilisation",
      story:
        "Three overlapping opioids taking the daily dose past the CDC ceiling, assembled from prescribers and pharmacies that rotate on every fill.",
    });
    console.log(
      `Overutilisation case: ${member.firstName} ${member.lastName} (${member.memberId})`,
    );
  }

  if (accepted < WANTED_CASES) {
    throw new Error(
      `Only ${accepted} of ${WANTED_CASES} overutilisation cases could be placed ` +
        `without disturbing an existing claim. Widen the candidate pool.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.claim.createMany({ data: rows as any });
  console.log(`  ${rows.length} adjudicated fills written`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
