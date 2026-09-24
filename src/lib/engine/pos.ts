/**
 * Point-of-sale simulation.
 *
 * Submits one hypothetical fill through the live engine, against the member's
 * real position: their prior fills, their accumulated out-of-pocket, their
 * approved authorizations. That last part is what makes this more than a
 * calculator. A pharmacy asking "what will this cost" gets a different answer
 * in March than in January, and a system that ignores the member's history
 * will quote a copay that the counter then contradicts.
 *
 * Nothing is written. This is a B1 billing request evaluated and discarded,
 * which is what a test claim is.
 */

import { prisma } from "@/lib/db";
import {
  adjudicate,
  type AdjudicationContext,
  type PriorFill,
} from "./adjudicate";
import { loadWorld } from "./replay";
import type { AdjudicationOutcome } from "./types";
import {
  screenFill,
  type ConcurrentFill,
  type DurConflict,
} from "@/lib/clinical/prospective";
import { dailyMme } from "@/lib/clinical/opioids";
import {
  dayOfPlanYear,
  medicalDeductibleAsOf,
  medicalEncountersFor,
} from "@/lib/accumulators/medical-feed";

export interface PosRequest {
  memberId: string;
  drugId: string;
  pharmacyId: string;
  dateOfService: string;
  quantityDispensed: number;
  daysSupply: number;
  dawCode: string;
  /** 411-DB. Optional: without it the DUR segment cannot say "other prescriber". */
  prescriberNpi?: string | null;
  /**
   * 418-DK. Value "3" is Emergency, which is how the pharmacy asks for the
   * weekend and holiday supply. The plan does not infer it, because dispensing
   * an emergency supply is the pharmacist's call and inferring it would reprice
   * fills that were never submitted that way.
   */
  levelOfService?: string | null;
}

export interface PosResponse {
  outcome: AdjudicationOutcome;
  /**
   * The NCPDP DUR/PPS response segment. Advisory: a conflict is transmitted
   * alongside the pricing, and for a major one the pharmacy is expected to
   * intervene and send a professional service code back. Nothing here changes
   * what the claim pays.
   */
  dur: DurConflict[];
  /** Fills still inside their days supply on the date of service. */
  activeTherapy: Array<{
    name: string;
    dateOfService: string;
    daysSupply: number;
    dailyMme: number | null;
    samePharmacy: boolean;
  }>;
  /** What the member's position looked like when the claim was priced. */
  context: {
    memberName: string;
    cardholderId: string;
    planName: string;
    drugName: string;
    ndc11: string;
    pharmacyName: string;
    priorFills: number;
    lastFillDate: string | null;
    rxOopAccumulatedCents: number;
    rxOopLimitCents: number;
    deductibleAccumulatedCents: number;
    deductibleCents: number;
    approvedPAs: { drugName: string; through: string | null }[];
  };
}

export async function simulateFill(req: PosRequest): Promise<PosResponse> {
  const world = await loadWorld();

  const drug = world.drugs.get(req.drugId);
  const pharmacy = world.pharmacies.get(req.pharmacyId);
  const memberFacts = world.members.get(req.memberId);
  const elig = world.eligibility.get(req.memberId);
  if (!drug) throw new Error("Unknown drug");
  if (!pharmacy) throw new Error("Unknown pharmacy");
  if (!memberFacts || !elig) throw new Error("Unknown member");

  const plan = world.plans.get(elig.benefitPlanId);
  if (!plan) throw new Error("Member is not attached to a benefit plan");

  const dateOfService = new Date(`${req.dateOfService}T00:00:00.000Z`);

  const [member, history, sameDay, opioids] = await Promise.all([
    prisma.member.findUnique({
      where: { id: req.memberId },
      select: { firstName: true, lastName: true, cardholderId: true },
    }),
    prisma.claim.findMany({
      where: {
        memberId: req.memberId,
        responseStatus: "P",
        dateOfService: { lt: dateOfService },
      },
      select: {
        claimNumber: true,
        dateOfService: true,
        daysSupply: true,
        quantityDispensed: true,
        drugId: true,
        prescriberNpi: true,
        pharmacyId: true,
        patientPayCents: true,
        appliedToDeductibleCents: true,
        formularyLevel: true,
        brandSelectionPenaltyCents: true,
      },
      orderBy: { dateOfService: "asc" },
    }),
    /*
     * Fills dispensed the same day are concurrent therapy for clinical
     * purposes and are not part of pricing, so they are fetched separately.
     * Two prescriptions started the same morning at two pharmacies is the
     * exact case only the processor can see, and cutting the window strictly
     * before the date of service would drop it.
     *
     * A same-day fill of the same product is excluded: that is a duplicate
     * submission, which the engine answers with a reject code rather than a
     * clinical conflict.
     */
    prisma.claim.findMany({
      where: {
        memberId: req.memberId,
        responseStatus: "P",
        dateOfService,
        drugId: { not: req.drugId },
      },
      select: {
        claimNumber: true,
        dateOfService: true,
        daysSupply: true,
        quantityDispensed: true,
        drugId: true,
        prescriberNpi: true,
        pharmacyId: true,
      },
    }),
    prisma.opioidProduct.findMany({ where: { convertible: true } }),
  ]);
  if (!member) throw new Error("Unknown member");

  const opioidByDrug = new Map(opioids.map((o) => [o.drugId, o]));
  const mmeOf = (drugId: string, quantity: number, days: number) => {
    const product = opioidByDrug.get(drugId);
    if (!product) return null;
    return dailyMme({
      strengthMg: product.strengthMg,
      mmeFactor: product.mmeFactor,
      isTransdermal: product.isTransdermal,
      quantityDispensed: quantity,
      daysSupply: days,
    });
  };

  /*
   * The accumulator is rebuilt from the claims that precede this date rather
   * than read from the stored balance, because the stored balance is the end
   * of the year. A fill dated in March has to be priced against March.
   */
  const rxOopLevels = new Set(
    plan.costShareRules.filter((r) => r.accumulatesToRxOop).map((r) => r.level),
  );
  let rxOop = 0;
  let deductible = 0;

  /*
   * The medical side of an integrated deductible, which this system receives
   * rather than adjudicates. Counted as of the date of service for the same
   * reason the pharmacy balance is rebuilt from dated claims: a fill in March
   * is priced against the deductible as it stood in March.
   *
   * Those dollars also count toward the combined out-of-pocket maximum. On the
   * HDHP the deductible and the $2,500 MOOP share one pocket; omitting the
   * medical credit from Rx OOP lets pharmacy collect another full $2,500 after
   * medical already took the member through the deductible.
   */
  if (plan.deductibleIntegratedWithMedical) {
    const medicalCents = medicalDeductibleAsOf(
      medicalEncountersFor(req.memberId, plan.deductibleIndividual),
      dayOfPlanYear(dateOfService),
    );
    deductible += medicalCents;
    rxOop += medicalCents;
  }

  const priorFills: PriorFill[] = [];
  for (const c of history) {
    deductible += c.appliedToDeductibleCents;
    if (rxOopLevels.size === 0 || rxOopLevels.has(c.formularyLevel ?? "")) {
      rxOop += c.patientPayCents - c.brandSelectionPenaltyCents;
    }
    const filled = world.drugs.get(c.drugId);
    priorFills.push({
      dateOfService: c.dateOfService,
      daysSupply: c.daysSupply,
      quantityDispensed: c.quantityDispensed,
      drugId: c.drugId,
      therapeuticClass: filled?.therapeuticClass ?? null,
    });
  }

  /*
   * The pharmacy's cash price is not a plan input, so there is nothing in the
   * database to read it from. It is set above the contract rate here so the
   * usual-and-customary arm does not silently win every simulated fill and
   * make the contract look irrelevant.
   */
  const nadacTotalCents = Math.round(
    drug.nadacPerUnit * req.quantityDispensed * 100,
  );
  const usualAndCustomaryCents = Math.max(
    500,
    Math.round(nadacTotalCents * 1.9),
  );

  const ctx: AdjudicationContext = {
    request: {
      dateOfService,
      cardholderId: member.cardholderId,
      personCode: "01",
      serviceProviderId: pharmacy.npi,
      productServiceId: drug.ndc11,
      rxNumber: "SIMULATED",
      fillNumber: priorFills.filter((f) => f.drugId === req.drugId).length,
      quantityDispensed: req.quantityDispensed,
      daysSupply: req.daysSupply,
      dawCode: req.dawCode,
      usualAndCustomaryCents,
      ingredientCostSubmittedCents: Math.round(usualAndCustomaryCents * 0.98),
      compoundCode: "1",
      levelOfService: req.levelOfService ?? undefined,
    },
    member: {
      id: req.memberId,
      diagnosisCodes: memberFacts.diagnosisCodes,
      weightKg: memberFacts.weightKg,
    },
    eligibility: elig,
    plan,
    drug,
    formularyEntry: world.formulary.get(req.drugId) ?? null,
    pharmacy,
    contract: world.contract,
    priorFills,
    accumulators: {
      rxOopAccumulatedCents: rxOop,
      federalOopAccumulatedCents: rxOop,
      deductibleAccumulatedCents: deductible,
    },
    approvedPAs: world.approvedPAs.get(req.memberId) ?? [],
  };

  const outcome = adjudicate(ctx);
  const lastFill = history[history.length - 1];

  /*
   * Clinical screening runs on the submitted fill whether or not it paid. A
   * claim rejected for a quantity limit is still a claim the pharmacy may
   * resubmit, and a major interaction is worth transmitting either way.
   */
  const concurrent: ConcurrentFill[] = [...history, ...sameDay].map((c) => {
    const filled = world.drugs.get(c.drugId);
    return {
      claimNumber: c.claimNumber,
      drugId: c.drugId,
      name: filled?.name ?? c.drugId,
      molecule: filled?.molecule ?? null,
      therapeuticClass: filled?.therapeuticClass ?? null,
      dateOfService: c.dateOfService,
      daysSupply: c.daysSupply,
      quantityDispensed: c.quantityDispensed,
      prescriberNpi: c.prescriberNpi,
      pharmacyId: c.pharmacyId,
      dailyMme: mmeOf(c.drugId, c.quantityDispensed, c.daysSupply),
    };
  });

  const candidateMme = mmeOf(req.drugId, req.quantityDispensed, req.daysSupply);
  const dur = screenFill(
    {
      drugId: req.drugId,
      name: drug.name,
      molecule: drug.molecule,
      therapeuticClass: drug.therapeuticClass ?? null,
      dateOfService,
      daysSupply: req.daysSupply,
      quantityDispensed: req.quantityDispensed,
      prescriberNpi: req.prescriberNpi ?? null,
      pharmacyId: req.pharmacyId,
      dailyMme: candidateMme,
    },
    concurrent,
  );

  const activeTherapy = concurrent
    .filter(
      (f) =>
        f.dateOfService.getTime() + f.daysSupply * 86_400_000 >
        dateOfService.getTime(),
    )
    .map((f) => ({
      name: f.name,
      dateOfService: f.dateOfService.toISOString().slice(0, 10),
      daysSupply: f.daysSupply,
      dailyMme: f.dailyMme,
      samePharmacy: f.pharmacyId === req.pharmacyId,
    }));

  return {
    outcome,
    dur,
    activeTherapy,
    context: {
      memberName: `${member.firstName} ${member.lastName}`,
      cardholderId: member.cardholderId,
      planName: plan.name,
      drugName: drug.name,
      ndc11: drug.ndc11,
      pharmacyName: pharmacy.name,
      priorFills: history.length,
      lastFillDate: lastFill?.dateOfService.toISOString().slice(0, 10) ?? null,
      rxOopAccumulatedCents: rxOop,
      rxOopLimitCents: plan.rxOopLimitIndividual,
      deductibleAccumulatedCents: deductible,
      deductibleCents: plan.deductibleIndividual,
      approvedPAs: (world.approvedPAs.get(req.memberId) ?? []).map((pa) => ({
        drugName: world.drugs.get(pa.drugId)?.name ?? pa.drugId,
        through: pa.terminationDate?.toISOString().slice(0, 10) ?? null,
      })),
    },
  };
}
