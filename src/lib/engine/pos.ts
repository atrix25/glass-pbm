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

export interface PosRequest {
  memberId: string;
  drugId: string;
  pharmacyId: string;
  dateOfService: string;
  quantityDispensed: number;
  daysSupply: number;
  dawCode: string;
}

export interface PosResponse {
  outcome: AdjudicationOutcome;
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

  const [member, history] = await Promise.all([
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
        dateOfService: true,
        daysSupply: true,
        quantityDispensed: true,
        drugId: true,
        patientPayCents: true,
        appliedToDeductibleCents: true,
        formularyLevel: true,
        brandSelectionPenaltyCents: true,
      },
      orderBy: { dateOfService: "asc" },
    }),
  ]);
  if (!member) throw new Error("Unknown member");

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

  return {
    outcome,
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
