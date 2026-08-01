/**
 * Claim generation.
 *
 * Every claim here goes through the real adjudication engine. Nothing is
 * fabricated: the paid amounts, the member cost share, the rejects, and the
 * accumulator balances are all products of the same code path a live claim
 * would take, priced off real NADAC and the real formulary.
 *
 * The generator's only job is to decide who fills what, when, and where.
 */

import {
  adjudicate,
  type AdjudicationContext,
  type EngineBenefitPlan,
  type EngineContract,
  type EngineDrug,
  type EngineFormularyEntry,
  type EnginePharmacy,
  type PriorFill,
} from "../../src/lib/engine/adjudicate.js";
import type { Channel } from "../../src/lib/engine/types.js";
import { Rng, type GeneratedMember, PROFILES } from "./population.js";
import { PHARMACIES } from "./world.js";
import {
  createPriorAuthDecider,
  isCriteriaGoverned,
  type DecidedPA,
} from "./prior-auths.js";

export interface DrugCandidate {
  id: string;
  ndc11: string;
  name: string;
  nadacDescription: string | null;
  unitOfMeasure: string;
  nadacPerUnit: number;
  monyCode: string;
  isBrandLabel: boolean;
  isSpecialty: boolean;
  therapeuticClass: string | null;
  formulary: EngineFormularyEntry;
}

/**
 * Map a dispensed quantity onto the NADAC pricing unit.
 *
 * NADAC prices per EA, ML, or GM, and an "EA" can be a single tablet or a
 * four-pack of autoinjectors depending on the product. Getting this wrong is
 * the difference between an $8,800 claim and a $35,000 one, so the decision
 * reads the NDC description rather than guessing from the dosage form.
 */
export function quantityForFill(
  drug: DrugCandidate,
  daysSupply: number,
  rng: Rng,
): number {
  const desc = (drug.nadacDescription ?? drug.name).toUpperCase();
  const uom = drug.unitOfMeasure;
  const price = drug.nadacPerUnit;
  const months = Math.max(1, Math.round(daysSupply / 30));

  if (uom === "GM") {
    // Metered dose inhalers are priced per gram of canister contents, and a
    // canister holds somewhere between five and eighteen grams. Treating one
    // as if it were a sixty gram tube of ointment overstates the claim by an
    // order of magnitude, and inhalers are common enough to distort the whole
    // report.
    if (/INHALER|AEROSPHERE|RESPIMAT|\bHFA\b|\bAERO\b|DISKUS|INHAL/.test(desc)) {
      const canister = rng.pick([6, 8.5, 10.7, 12, 14]);
      return Number((canister * months).toFixed(1));
    }
    // Otherwise unit price separates a tube of hydrocortisone from a
    // specialty topical more reliably than the dosage form does.
    if (price >= 50) return rng.pick([15, 30]);
    if (price >= 5) return rng.pick([30, 45, 60]);
    return rng.pick([30, 45, 60, 80]) * (daysSupply >= 84 ? 2 : 1);
  }

  if (uom === "ML") {
    // A stated package volume is the best available signal. Take care not to
    // read the denominator of a concentration such as "40,000 UNIT/ML".
    const volumeMatch = /(?:^|[\s(/])(\d+(?:\.\d+)?)\s*ML\b/.exec(desc);
    const statedVolume = volumeMatch ? parseFloat(volumeMatch[1]) : null;

    if (/SYRINGE|AUTOINJECTOR|AUTO-INJECTOR|\bPEN\b|CARTRIDGE/.test(desc)) {
      const perDose = statedVolume && statedVolume <= 5 ? statedVolume : 1;
      const doses = daysSupply >= 84 ? 6 : daysSupply >= 56 ? 4 : 2;
      return Number((perDose * doses).toFixed(2));
    }

    // Fall back to price tiers. A product costing hundreds of dollars per
    // millilitre is a biologic dispensed in single millilitres; a product
    // costing pennies is an oral liquid dispensed by the bottle.
    if (price >= 100) return rng.pick([0.5, 1, 2]);
    if (price >= 25) return rng.pick([1, 2, 3]) * months;
    if (price >= 5) return rng.pick([2.5, 5, 10]);
    if (price >= 0.5) return rng.pick([5, 10, 15, 30]);
    if (/VIAL|NEBU|INHAL/.test(desc)) return rng.pick([75, 150]);
    return rng.pick([100, 120, 150, 240]);
  }

  // EA is the ambiguous one. It can mean one tablet, or one four-pack of
  // autoinjectors, or one bottle of nasal spray. Deciding by dosage form is
  // far more reliable than deciding by price, because oral specialty tablets
  // are genuinely expensive AND genuinely dispensed thirty at a time.
  const isCountableOralDose =
    /\bTABLET|\bTABS?\b|\bCAPSULE|\bCAPS?\b|\bODT\b|\bCHEWABLE|\bSUBLINGUAL|\bTROCHE|\bWAFER/.test(
      desc,
    );

  if (!isCountableOralDose) {
    if (/SYRINGE|AUTOINJECTOR|AUTO-INJECTOR|\bPEN\b|VIAL|AMPUL/.test(desc)) {
      return daysSupply >= 84 ? 6 : daysSupply >= 56 ? 4 : 2;
    }
    if (/PATCH/.test(desc)) return daysSupply >= 84 ? 12 : 4;
    if (/SUPPOSITORY|LOZENGE|\bFILM\b/.test(desc)) {
      return Math.min(daysSupply, 30);
    }
    if (/STRIP|LANCET/.test(desc)) return rng.pick([50, 100]);
    // Sprays, inhalers, bottles, kits, packs, meters and devices are all
    // dispensed as whole packages.
    return months;
  }

  // A high per-tablet price means an oral specialty product, which is still
  // one tablet a day rather than two.
  if (price >= 50) return daysSupply;

  // Tablets and capsules: one or two a day is the overwhelming majority.
  const perDay = rng.bool(0.78) ? 1 : 2;
  return daysSupply * perDay;
}

/**
 * The pharmacy's cash price. Set above the contracted rate for most fills,
 * but deliberately below it on a small share, because U&C landing under the
 * contract rate is exactly the case that separates a lesser-of that includes
 * usual and customary from one that does not.
 */
function usualAndCustomaryCents(
  nadacTotalCents: number,
  rng: Rng,
): number {
  if (rng.bool(0.04)) {
    // Discount-program pricing at a grocery or club pharmacy.
    return Math.round(nadacTotalCents * (0.9 + rng.next() * 0.25));
  }
  return Math.round(nadacTotalCents * (1.35 + rng.next() * 1.4));
}

export interface ClaimGenerationInput {
  members: GeneratedMember[];
  drugsByClass: Map<string, DrugCandidate[]>;
  allDrugs: DrugCandidate[];
  specialtyDrugs: DrugCandidate[];
  plans: Map<string, EngineBenefitPlan>;
  contract: EngineContract;
  planYear: number;
  seed: number;
}

export interface GeneratedClaim {
  claimNumber: string;
  member: GeneratedMember;
  drug: DrugCandidate;
  pharmacyId: string;
  dateOfService: Date;
  rxNumber: string;
  fillNumber: number;
  quantityDispensed: number;
  daysSupply: number;
  dawCode: string;
  usualAndCustomaryCents: number;
  /** Persisted so a claim can be replayed byte-for-byte against a new config. */
  ingredientCostSubmittedCents: number;
  outcome: ReturnType<typeof adjudicate>;
  scenarioTag?: string;
}

/**
 * A prior authorization the generator granted so a specialty member's fills
 * would pay. These are written to the database rather than kept in memory,
 * because a claim cannot be replayed against a new benefit configuration
 * unless the approvals that let it through are on file.
 */
export interface GeneratedPriorAuth {
  memberId: string;
  drugId: string;
  effectiveDate: Date;
  terminationDate: Date;
}

export interface ClaimGenerationResult {
  claims: GeneratedClaim[];
  priorAuths: GeneratedPriorAuth[];
  /** Requests decided by walking published criteria, with their traversals. */
  decidedPriorAuths: DecidedPA[];
}

/** Therapeutic classes a member with this diagnosis is likely to fill from. */
const DIAGNOSIS_TO_CLASS: Record<string, string[]> = {
  I10: ["ANTIHYPERTENSIVES", "BETA BLOCKERS", "DIURETICS", "CALCIUM CHANNEL BLOCKERS", "ACE INHIBITORS"],
  E11: ["ANTIDIABETICS", "DIAGNOSTIC PRODUCTS", "MEDICAL DEVICES AND SUPPLIES"],
  E78: ["ANTIHYPERLIPIDEMICS", "CARDIOVASCULAR AGENTS - MISC."],
  F32: ["ANTIDEPRESSANTS", "ANTIANXIETY AGENTS"],
  J45: ["ANTIASTHMATIC AND BRONCHODILATOR AGENTS", "CORTICOSTEROIDS"],
  J44: ["ANTIASTHMATIC AND BRONCHODILATOR AGENTS"],
  K21: ["ULCER DRUGS", "GASTROINTESTINAL AGENTS - MISC."],
  N18: ["ELECTROLYTES/MINERALS/METALS/VITAMINS", "HEMATOPOIETIC AGENTS"],
  I48: ["ANTICOAGULANTS", "ANTIARRHYTHMICS"],
  M17: ["ANALGESICS - ANTI-INFLAMMATORY", "ANALGESICS - NONNARCOTIC"],
  L40: ["DERMATOLOGICALS", "ANALGESICS - ANTI-INFLAMMATORY"],
  M05: ["ANALGESICS - ANTI-INFLAMMATORY"],
  M06: ["ANALGESICS - ANTI-INFLAMMATORY"],
  K50: ["GASTROINTESTINAL AGENTS - MISC."],
  K51: ["GASTROINTESTINAL AGENTS - MISC."],
  L20: ["DERMATOLOGICALS"],
  G35: ["PSYCHOTHERAPEUTIC AND NEUROLOGICAL AGENTS - MISC."],
  J06: ["ANTIBIOTICS", "PENICILLINS", "MACROLIDES", "CEPHALOSPORINS", "COUGH/COLD/ALLERGY"],
  L03: ["ANTIBIOTICS", "PENICILLINS", "TETRACYCLINES"],
  M25: ["ANALGESICS - NONNARCOTIC", "ANALGESICS - ANTI-INFLAMMATORY"],
};

/**
 * Biologics a member with this diagnosis would plausibly be started on.
 *
 * Only the products with a transcribed criteria form are listed, because the
 * point is to send requests through the trees that can actually be walked.
 */
const DIAGNOSIS_TO_BIOLOGIC: Record<string, string[]> = {
  // Plaque psoriasis: an IL-23 inhibitor or a TNF inhibitor.
  L40: ["SKYRIZI", "ADALIMUMAB", "HUMIRA", "HYRIMOZ", "YUFLYMA"],
  // Atopic dermatitis.
  L20: ["DUPIXENT"],
  // Severe eosinophilic asthma, where dupilumab is an add-on. The published
  // form lists the indication, but only the atopic dermatitis branch is
  // transcribed, so these requests deny at step 4 and say so.
  J45: ["DUPIXENT"],
  // Rheumatoid arthritis.
  M05: ["ADALIMUMAB", "HUMIRA", "HYRIMOZ", "YUFLYMA"],
  M06: ["ADALIMUMAB", "HUMIRA", "HYRIMOZ", "YUFLYMA"],
  // Inflammatory bowel disease. Risankizumab is indicated here too, but only
  // the plaque psoriasis branch of its form is transcribed, so routing these
  // members to it would produce denials that say more about this project's
  // coverage than about the request.
  K50: ["ADALIMUMAB", "HUMIRA", "HYRIMOZ", "YUFLYMA"],
  K51: ["ADALIMUMAB", "HUMIRA", "HYRIMOZ", "YUFLYMA"],
};

/**
 * Classes an acute fill is drawn from, with weights.
 *
 * Weighting matters because the formulary has 103 dermatologicals and 12
 * penicillins, so drawing uniformly across classes would make eczema cream
 * more common than amoxicillin. Antivirals are deliberately absent: the class
 * is dominated by HIV and hepatitis regimens costing thousands a month, which
 * are chronic specialty therapy rather than something you pick up for a cold.
 */
const ACUTE_CLASS_WEIGHTS: Array<[string, number]> = [
  ["ANTIBIOTICS", 14],
  ["PENICILLINS", 12],
  ["MACROLIDES", 8],
  ["CEPHALOSPORINS", 8],
  ["TETRACYCLINES", 5],
  ["COUGH/COLD/ALLERGY", 12],
  ["ANALGESICS - NONNARCOTIC", 10],
  ["ANALGESICS - OPIOID", 5],
  ["CORTICOSTEROIDS", 7],
  ["DERMATOLOGICALS", 6],
  ["OPHTHALMIC AGENTS", 4],
  ["ANTIEMETICS", 3],
  ["ANTIFUNGALS", 3],
  ["MUSCULOSKELETAL THERAPY AGENTS", 3],
];

const ACUTE_CLASSES = ACUTE_CLASS_WEIGHTS.map(([c]) => c);

function pickFromClasses(
  classes: string[],
  drugsByClass: Map<string, DrugCandidate[]>,
  rng: Rng,
  filter?: (d: DrugCandidate) => boolean,
): DrugCandidate | null {
  const pool: DrugCandidate[] = [];
  for (const c of classes) {
    const drugs = drugsByClass.get(c);
    if (drugs) pool.push(...drugs);
  }
  const eligible = filter ? pool.filter(filter) : pool;
  if (eligible.length === 0) return null;
  return rng.pick(eligible);
}

const COVERED_LEVELS = new Set(["1", "2", "3", "4", "$0"]);

/**
 * Therapeutic classes mix ordinary drugs with biologics. "Gastrointestinal
 * agents - misc." contains both omeprazole and Skyrizi. A member with reflux
 * should reach the first and not the second, so the non-specialty pools
 * exclude anything priced like a biologic. Members reach those products
 * through the specialty pathway, which carries the prior authorization and
 * the designated pharmacy requirement with it.
 */
const SPECIALTY_PRICE_THRESHOLD_PER_UNIT = 100;

function isRoutineTherapy(d: DrugCandidate): boolean {
  return (
    COVERED_LEVELS.has(d.formulary.level) &&
    !d.isSpecialty &&
    d.formulary.level !== "4" &&
    d.nadacPerUnit < SPECIALTY_PRICE_THRESHOLD_PER_UNIT
  );
}

export function generateClaims(
  input: ClaimGenerationInput,
): ClaimGenerationResult {
  const rng = new Rng(input.seed);
  const claims: GeneratedClaim[] = [];
  const grantedPAs: GeneratedPriorAuth[] = [];
  const decidedPAs: DecidedPA[] = [];
  const decidePA = createPriorAuthDecider(rng);
  const yearStart = Date.UTC(input.planYear, 0, 1);

  const retailPharmacies = PHARMACIES.filter(
    (p) => p.weight > 0 && p.pharmacyType !== "Specialty" && p.pharmacyType !== "Mail",
  );
  const mailPharmacy = PHARMACIES.find((p) => p.pharmacyType === "Mail")!;
  const specialtyPharmacies = PHARMACIES.filter((p) => p.isDesignatedSpecialty);

  let claimSeq = 1;

  for (const member of input.members) {
    const profile = PROFILES.find((p) => p.id === member.profileId)!;
    const plan = input.plans.get(member.benefitPlanId);
    if (!plan) continue;

    // --- Choose this member's therapy set --------------------------------
    const chronicCount = rng.int(...profile.chronicDrugs);
    const chronicDrugs: DrugCandidate[] = [];
    const relevantClasses = member.diagnosisCodes.flatMap(
      (dx) => DIAGNOSIS_TO_CLASS[dx] ?? [],
    );

    for (let i = 0; i < chronicCount; i++) {
      const drug =
        pickFromClasses(
          relevantClasses.length > 0 ? relevantClasses : ACUTE_CLASSES,
          input.drugsByClass,
          rng,
          isRoutineTherapy,
        ) ?? rng.pick(input.allDrugs.filter(isRoutineTherapy));
      if (drug && !chronicDrugs.some((d) => d.id === drug.id)) {
        chronicDrugs.push(drug);
      }
    }

    const onSpecialty =
      rng.bool(profile.specialtyProbability) && input.specialtyDrugs.length > 0;
    /*
     * A biologic follows the diagnosis. Drawing one uniformly from the
     * specialty catalog would put members with rheumatoid arthritis on
     * dupilumab, and the prior authorization would then deny for want of an
     * atopic dermatitis diagnosis. That denial would be a fault of the
     * simulation rather than of the request, and it would make the criteria
     * engine look stricter than it is.
     */
    const indicated = onSpecialty
      ? input.specialtyDrugs.filter((d) =>
          member.diagnosisCodes.some((dx) =>
            (DIAGNOSIS_TO_BIOLOGIC[dx] ?? []).some((p) =>
              d.name.toUpperCase().includes(p),
            ),
          ),
        )
      : [];
    const specialtyDrug = !onSpecialty
      ? null
      : indicated.length > 0
        ? rng.pick(indicated)
        : rng.pick(input.specialtyDrugs);

    // --- Channel preference ------------------------------------------------
    // ET-8933 reports a meaningful mail and retail-90 share for maintenance
    // therapy. Members pick a habit and mostly stick to it.
    const usesMail = rng.bool(0.18);
    const uses90Day = rng.bool(0.34);
    const homePharmacy = rng.weighted(retailPharmacies, (p) => p.weight);

    const priorFills: PriorFill[] = [];
    const accumulators = {
      rxOopAccumulatedCents: 0,
      federalOopAccumulatedCents: 0,
      deductibleAccumulatedCents: 0,
    };
    const approvedPAs: { drugId: string; effectiveDate: Date; terminationDate: Date | null }[] = [];

    /*
     * Specialty therapy is authorized by actually walking the published
     * criteria, not by granting the member an approval because the seed says
     * so. Where a drug is governed by a transcribed form, the request goes
     * through the same engine the demo uses, and the fill only pays if the
     * traversal approved it. Drugs with no transcribed form still get a
     * standing approval, because refusing coverage on the grounds that this
     * project has not transcribed the criteria would be an artifact of the
     * build rather than anything the plan does.
     */
    if (specialtyDrug) {
      const firstFill = new Date(yearStart + rng.int(0, 45) * 86_400_000);
      const decided = isCriteriaGoverned(specialtyDrug.name)
        ? decidePA({
            memberId: member.id,
            drugId: specialtyDrug.id,
            drugName: specialtyDrug.name,
            firstFillDate: firstFill,
            planYearEnd: new Date(Date.UTC(input.planYear, 11, 31)),
            diagnosisCodes: member.diagnosisCodes,
            filledDrugNames: chronicDrugs.map((d) => d.name),
            ageYears: Math.floor(
              (yearStart - member.dateOfBirth.getTime()) / 31_557_600_000,
            ),
            // Weight is not modelled on the member, and only matters for the
            // weight-band dosing branch, so it is drawn here.
            weightKg: rng.int(45, 130),
          })
        : [];

      if (decided.length > 0) {
        decidedPAs.push(...decided);
        // Every approval in the chain counts, since a four-month term means a
        // member on therapy all year is covered by a succession of them. They
        // are written from the decisions themselves rather than being pushed
        // onto the standing-grant list.
        for (const d of decided) {
          if (d.outcome === "Approved" && d.effectiveDate) {
            approvedPAs.push({
              drugId: specialtyDrug.id,
              effectiveDate: d.effectiveDate,
              terminationDate: d.terminationDate,
            });
          }
        }
      } else if (rng.bool(0.85)) {
        const grant = {
          drugId: specialtyDrug.id,
          effectiveDate: new Date(yearStart),
          terminationDate: new Date(Date.UTC(input.planYear, 11, 31)),
        };
        approvedPAs.push(grant);
        grantedPAs.push({ memberId: member.id, ...grant });
      }
    }

    // --- Build the fill calendar -------------------------------------------
    interface PlannedFill {
      drug: DrugCandidate;
      day: number;
      daysSupply: number;
      channel: Channel;
      fillNumber: number;
      rxNumber: string;
    }
    const planned: PlannedFill[] = [];

    for (const [idx, drug] of chronicDrugs.entries()) {
      const daysSupply = uses90Day || usesMail ? 90 : 30;
      const interval = daysSupply === 90 ? 90 : 30;
      const startDay = rng.int(0, interval - 1);
      const rxNumber = String(4_000_000 + claimSeq * 13 + idx);
      let fillNumber = 0;
      for (let day = startDay; day < 365; day += interval) {
        // Adherence is not perfect; roughly a fifth of expected refills
        // never happen, which is what makes adherence reporting meaningful.
        if (fillNumber > 0 && rng.bool(0.18)) {
          fillNumber++;
          continue;
        }
        planned.push({
          drug,
          day: day + rng.int(-3, 5),
          daysSupply,
          channel: usesMail ? "Mail" : daysSupply === 90 ? "Retail90" : "Retail",
          fillNumber,
          rxNumber,
        });
        fillNumber++;
      }
    }

    if (specialtyDrug) {
      const daysSupply = 28;
      const rxNumber = String(4_500_000 + claimSeq * 7);
      let fillNumber = 0;
      for (let day = rng.int(0, 27); day < 365; day += daysSupply) {
        if (fillNumber > 0 && rng.bool(0.08)) {
          fillNumber++;
          continue;
        }
        planned.push({
          drug: specialtyDrug,
          day,
          daysSupply,
          channel: "Specialty",
          fillNumber,
          rxNumber,
        });
        fillNumber++;
      }
    }

    // Acute fills scattered through the year.
    const [minScripts, maxScripts] = profile.scriptsPerYear;
    const targetTotal = rng.int(minScripts, maxScripts);
    const acuteCount = Math.max(0, targetTotal - planned.length);
    for (let i = 0; i < acuteCount; i++) {
      // Pick the class by clinical frequency first, then a drug inside it, so
      // the formulary's uneven drug counts per class do not become the
      // utilization mix.
      const [className] = rng.weighted(ACUTE_CLASS_WEIGHTS, ([, w]) => w);
      const drug =
        pickFromClasses(
          [className],
          input.drugsByClass,
          rng,
          isRoutineTherapy,
        ) ?? pickFromClasses(ACUTE_CLASSES, input.drugsByClass, rng, isRoutineTherapy);
      if (!drug) continue;
      planned.push({
        drug,
        day: rng.int(0, 364),
        daysSupply: rng.pick([5, 7, 10, 14, 30]),
        channel: "Retail",
        fillNumber: 0,
        rxNumber: String(5_000_000 + claimSeq * 11 + i),
      });
    }

    planned.sort((a, b) => a.day - b.day);

    // --- Adjudicate ---------------------------------------------------------
    for (const fill of planned) {
      if (fill.day < 0 || fill.day > 364) continue;
      const dateOfService = new Date(yearStart + fill.day * 86_400_000);

      if (dateOfService < member.effectiveDate) continue;
      if (member.terminationDate && dateOfService > member.terminationDate) {
        // Keep a few post-termination fills so the eligibility reject is real.
        if (!rng.bool(0.03)) continue;
      }

      const pharmacySeed =
        fill.channel === "Specialty"
          ? rng.pick(specialtyPharmacies)
          : fill.channel === "Mail"
            ? mailPharmacy
            : homePharmacy;

      const quantity = quantityForFill(fill.drug, fill.daysSupply, rng);
      const nadacTotalCents = Math.round(
        fill.drug.nadacPerUnit * quantity * 100,
      );

      // DAW 1 on a small share of brand fills, which triggers the penalty.
      const dawCode =
        fill.drug.isBrandLabel && rng.bool(0.05) ? "1" : "0";

      const enginePharmacy: EnginePharmacy = {
        id: pharmacySeed.id,
        npi: pharmacySeed.npi,
        name: pharmacySeed.name,
        pharmacyType: pharmacySeed.pharmacyType,
        isDesignatedSpecialty: pharmacySeed.isDesignatedSpecialty ?? false,
        is340B: pharmacySeed.is340B ?? false,
        inNetwork: pharmacySeed.inLimitedNetwork !== false,
      };

      const engineDrug: EngineDrug = {
        id: fill.drug.id,
        ndc11: fill.drug.ndc11,
        name: fill.drug.name,
        monyCode: fill.drug.monyCode,
        isBrandLabel: fill.drug.isBrandLabel,
        isSpecialty: fill.drug.isSpecialty,
        therapeuticClass: fill.drug.therapeuticClass,
        nadacPerUnit: fill.drug.nadacPerUnit,
      };

      // A pharmacy bills its own price and lets the processor reprice it, so
      // the submitted ingredient cost tracks the cash price rather than the
      // contract. Submitting at the contracted rate would make the lesser-of
      // trivially self-fulfilling.
      const uandcCents = usualAndCustomaryCents(nadacTotalCents, rng);
      const submittedCents = Math.round(uandcCents * (0.94 + rng.next() * 0.1));

      const ctx: AdjudicationContext = {
        request: {
          dateOfService,
          cardholderId: member.cardholderId,
          personCode: member.personCode,
          serviceProviderId: pharmacySeed.npi,
          productServiceId: fill.drug.ndc11,
          rxNumber: fill.rxNumber,
          fillNumber: fill.fillNumber,
          quantityDispensed: quantity,
          daysSupply: fill.daysSupply,
          dawCode,
          usualAndCustomaryCents: uandcCents,
          ingredientCostSubmittedCents: submittedCents,
          compoundCode: "1",
        },
        member: {
          id: member.id,
          diagnosisCodes: member.diagnosisCodes,
          weightKg: member.weightKg,
        },
        eligibility: {
          id: `elig-${member.id}`,
          effectiveDate: member.effectiveDate,
          terminationDate: member.terminationDate,
          benefitPlanId: member.benefitPlanId,
        },
        plan,
        drug: engineDrug,
        formularyEntry: fill.drug.formulary,
        pharmacy: enginePharmacy,
        contract: input.contract,
        priorFills,
        accumulators: { ...accumulators },
        approvedPAs,
      };

      const outcome = adjudicate(ctx);

      claims.push({
        claimNumber: `CLM${String(claimSeq).padStart(9, "0")}`,
        member,
        drug: fill.drug,
        pharmacyId: pharmacySeed.id,
        dateOfService,
        rxNumber: fill.rxNumber,
        fillNumber: fill.fillNumber,
        quantityDispensed: quantity,
        daysSupply: fill.daysSupply,
        dawCode,
        usualAndCustomaryCents: ctx.request.usualAndCustomaryCents,
        ingredientCostSubmittedCents: submittedCents,
        outcome,
      });
      claimSeq++;

      if (outcome.responseStatus === "P") {
        priorFills.push({
          dateOfService,
          daysSupply: fill.daysSupply,
          quantityDispensed: quantity,
          drugId: fill.drug.id,
          therapeuticClass: fill.drug.therapeuticClass,
        });
        for (const delta of outcome.costShare?.accumulatorDeltas ?? []) {
          const cents = Math.round(delta.amountMicros / 10_000);
          if (delta.accumulatorType === "RxOopIndividual") {
            accumulators.rxOopAccumulatedCents += cents;
          } else if (delta.accumulatorType === "FederalOopIndividual") {
            accumulators.federalOopAccumulatedCents += cents;
          } else if (delta.accumulatorType === "DeductibleIndividual") {
            accumulators.deductibleAccumulatedCents += cents;
          }
        }
      }
    }
  }

  return { claims, priorAuths: grantedPAs, decidedPriorAuths: decidedPAs };
}
