/**
 * Reproduce a stored claim's derivation.
 *
 * The trace is not archived. At a hundred thousand lives the traces would be
 * several times the size of everything else in the database, and keeping them
 * would buy nothing that cannot be recovered: the engine is deterministic, and
 * every input a claim was priced from is on the claim row. So the proof behind
 * a claim is re-derived when someone asks for it, by running the same code
 * against the same inputs.
 *
 * This is a stronger claim than storing the trace would have been. A saved
 * trace is a log, and a log is only as trustworthy as the thing that wrote it.
 * A reproduction can be checked: run it again and see whether the money comes
 * out the same. The determinism suite does exactly that, holding every
 * reproduced figure against the figures stored on the claim, so a divergence
 * between the engine and the book is a test failure rather than a discovery
 * made in front of a client.
 */

import { prisma } from "@/lib/db";
import { adjudicate, type AdjudicationContext, type PriorFill } from "./adjudicate";
import { approvedPAsAsOf, loadWorld } from "./replay";
import type { AdjudicationOutcome } from "./types";
import {
  dayOfPlanYear,
  medicalDeductibleAsOf,
  medicalEncountersFor,
} from "@/lib/accumulators/medical-feed";

export interface ReproducedClaim {
  outcome: AdjudicationOutcome;
  /**
   * Whether the reproduction agrees with what the book says was paid. It is
   * shown next to the trace rather than hidden, because a proof you are asked
   * to trust is not a proof.
   */
  agreement: {
    matches: boolean;
    fields: { field: string; stored: number; reproduced: number }[];
  };
  /**
   * Set when the claim being reproduced is a reversal, naming the fill it backs
   * out. The derivation in that case belongs to the original fill, and saying so
   * is the difference between a proof and a page of unexplained negative money.
   */
  reversalOf?: { id: string; claimNumber: string };
  elapsedMs: number;
}

/** The stored figures a reproduction has to land on to be believed. */
const CHECKED_FIELDS = [
  "totalBilledCents",
  "planPaidCents",
  "patientPayCents",
  "pharmacyPaidCents",
  "allowedIngredientCostCents",
  "appliedToDeductibleCents",
] as const;

function loadClaimRow(claimId: string) {
  return prisma.claim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      claimNumber: true,
      transactionCode: true,
      reversalOfClaimId: true,
      memberId: true,
      drugId: true,
      pharmacyId: true,
      dateOfService: true,
      rxNumber: true,
      fillNumber: true,
      quantityDispensed: true,
      daysSupply: true,
      dawCode: true,
      compoundCode: true,
      usualAndCustomaryCents: true,
      ingredientCostSubmittedCents: true,
      totalBilledCents: true,
      planPaidCents: true,
      patientPayCents: true,
      pharmacyPaidCents: true,
      allowedIngredientCostCents: true,
      appliedToDeductibleCents: true,
      member: { select: { cardholderId: true, personCode: true } },
    },
  });
}

type ClaimRow = NonNullable<Awaited<ReturnType<typeof loadClaimRow>>>;

function agreementFor(stored: ClaimRow, outcome: AdjudicationOutcome) {
  const fields = CHECKED_FIELDS.map((field) => ({
    field,
    stored: stored[field],
    reproduced: outcome[field],
  }));
  return { matches: fields.every((f) => f.stored === f.reproduced), fields };
}

export async function reproduceClaim(
  claimId: string,
): Promise<ReproducedClaim | null> {
  const started = Date.now();

  const claim = await loadClaimRow(claimId);
  if (!claim) return null;

  /*
   * A reversal has no pricing of its own. It is whatever its original turned
   * out to be, negated, which is also how the book records it. Re-adjudicating
   * the reversal row as though it were a fill would price a negative quantity
   * against a fresh accumulator and disagree with the book on every figure —
   * and it would do so on a page whose whole purpose is to be believed.
   */
  if (claim.transactionCode === "B2") {
    return reproduceReversal(claim, started);
  }

  const outcome = await adjudicateStored(claim);
  if (!outcome) return null;

  return {
    outcome,
    agreement: agreementFor(claim, outcome),
    elapsedMs: Date.now() - started,
  };
}

async function reproduceReversal(
  claim: ClaimRow,
  started: number,
): Promise<ReproducedClaim | null> {
  if (!claim.reversalOfClaimId) return null;

  const original = await loadClaimRow(claim.reversalOfClaimId);
  if (!original) return null;

  const outcome = await adjudicateStored(original);
  if (!outcome) return null;

  const negated = negateMoney(outcome);
  return {
    outcome: negated,
    agreement: agreementFor(claim, negated),
    reversalOf: { id: original.id, claimNumber: original.claimNumber },
    elapsedMs: Date.now() - started,
  };
}

/**
 * The original fill's money, backed out.
 *
 * The same fields the reversal was written from, negated the same way, so a
 * reversal can never drift away from the fill it is supposed to cancel. The
 * benchmark figures are deliberately left alone: NADAC and AWP at the date of
 * service are reference prices, not money that moved.
 */
function negateMoney(o: AdjudicationOutcome): AdjudicationOutcome {
  return {
    ...o,
    allowedIngredientCostCents: -o.allowedIngredientCostCents,
    allowedDispensingFeeCents: -o.allowedDispensingFeeCents,
    totalAllowedCents: -o.totalAllowedCents,
    pharmacyPaidCents: -o.pharmacyPaidCents,
    billedIngredientCostCents: -o.billedIngredientCostCents,
    billedDispensingFeeCents: -o.billedDispensingFeeCents,
    totalBilledCents: -o.totalBilledCents,
    planPaidCents: -o.planPaidCents,
    patientPayCents: -o.patientPayCents,
    appliedToDeductibleCents: -o.appliedToDeductibleCents,
    copayCoinsuranceCents: -o.copayCoinsuranceCents,
    brandSelectionPenaltyCents: -o.brandSelectionPenaltyCents,
    estimatedRebateCents: -o.estimatedRebateCents,
  };
}

async function adjudicateStored(
  claim: ClaimRow,
): Promise<AdjudicationOutcome | null> {
  const world = await loadWorld();
  const drug = world.drugs.get(claim.drugId);
  const pharmacy = world.pharmacies.get(claim.pharmacyId);
  const memberFacts = world.members.get(claim.memberId);
  const elig = world.eligibility.get(claim.memberId);
  if (!drug || !pharmacy || !memberFacts || !elig) return null;

  const plan = world.plans.get(elig.benefitPlanId);
  if (!plan) return null;

  const { priorFills, rxOop, deductible } = await rebuildPosition(
    claim.memberId,
    claim.dateOfService,
    plan.costShareRules
      .filter((r) => r.accumulatesToRxOop)
      .map((r) => r.level),
    world,
    plan.deductibleIntegratedWithMedical ? plan.deductibleIndividual : 0,
  );

  const ctx: AdjudicationContext = {
    request: {
      dateOfService: claim.dateOfService,
      cardholderId: claim.member.cardholderId,
      personCode: claim.member.personCode,
      serviceProviderId: pharmacy.npi,
      productServiceId: drug.ndc11,
      rxNumber: claim.rxNumber,
      fillNumber: claim.fillNumber,
      quantityDispensed: claim.quantityDispensed,
      daysSupply: claim.daysSupply,
      dawCode: claim.dawCode,
      usualAndCustomaryCents: claim.usualAndCustomaryCents,
      ingredientCostSubmittedCents: claim.ingredientCostSubmittedCents,
      compoundCode: claim.compoundCode,
    },
    member: {
      id: claim.memberId,
      diagnosisCodes: memberFacts.diagnosisCodes,
      weightKg: memberFacts.weightKg,
    },
    eligibility: elig,
    plan,
    drug,
    formularyEntry: world.formulary.get(claim.drugId) ?? null,
    pharmacy,
    contract: world.contract,
    priorFills,
    accumulators: {
      rxOopAccumulatedCents: rxOop,
      federalOopAccumulatedCents: rxOop,
      deductibleAccumulatedCents: deductible,
    },
    approvedPAs: approvedPAsAsOf(
      world.approvedPAs.get(claim.memberId),
      claim.dateOfService,
    ),
  };

  return adjudicate(ctx);
}

/**
 * Rebuild what the member's position was the moment before this fill.
 *
 * The stored accumulator balance is the end of the year, and a claim dated in
 * March has to be priced against March. The balance is therefore recomputed
 * from the paid claims that precede the date, which is the same thing the
 * point-of-sale simulator does.
 */
async function rebuildPosition(
  memberId: string,
  dateOfService: Date,
  accumulatingLevels: string[],
  world: Awaited<ReturnType<typeof loadWorld>>,
  integratedDeductibleCents: number,
): Promise<{ priorFills: PriorFill[]; rxOop: number; deductible: number }> {
  const history = await prisma.claim.findMany({
    where: {
      memberId,
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
  });

  const levels = new Set(accumulatingLevels);
  let rxOop = 0;
  let deductible = 0;
  const priorFills: PriorFill[] = [];

  /*
   * Medical claims against a shared deductible. Not adjudicated here, so not
   * in the claim history above — reproducing the fill without them would price
   * it against a deductible only pharmacy had touched, and it would disagree
   * with what the member was actually charged.
   */
  if (integratedDeductibleCents > 0) {
    deductible += medicalDeductibleAsOf(
      medicalEncountersFor(memberId, integratedDeductibleCents),
      dayOfPlanYear(dateOfService),
    );
  }

  for (const c of history) {
    deductible += c.appliedToDeductibleCents;
    if (levels.size === 0 || levels.has(c.formularyLevel ?? "")) {
      rxOop += c.patientPayCents - c.brandSelectionPenaltyCents;
    }
    priorFills.push({
      dateOfService: c.dateOfService,
      daysSupply: c.daysSupply,
      quantityDispensed: c.quantityDispensed,
      drugId: c.drugId,
      therapeuticClass: world.drugs.get(c.drugId)?.therapeuticClass ?? null,
    });
  }

  return { priorFills, rxOop, deductible };
}
