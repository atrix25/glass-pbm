/**
 * Replay every stored claim against a benefit configuration.
 *
 * This is the same code path used to model a proposed change and to prove the
 * engine is deterministic. Replaying with no overrides must reproduce the
 * stored adjudication exactly; anything else means a stored claim cannot be
 * defended, which would make every other transparency claim in this system
 * hollow.
 */

import { prisma } from "@/lib/db";
import { PLAN_YEAR_END } from "@/lib/clock";
import { hashString } from "@/lib/hash";
import {
  dayOfPlanYear,
  medicalEncountersFor,
  type MedicalEncounter,
} from "@/lib/accumulators/medical-feed";
import {
  adjudicate,
  type AdjudicationContext,
  type EngineBenefitPlan,
  type EngineContract,
  type EngineCostShareRule,
  type EngineDrug,
  type EngineFormularyEntry,
  type EnginePharmacy,
  type EngineRate,
  type PriorFill,
} from "./adjudicate";
import {
  DEFAULT_ASSUMPTIONS,
  type BenchmarkAssumptions,
} from "./benchmark";
import type { Channel, PricingArm } from "./types";
import { ReadingAccumulator, type NpsReading } from "@/lib/nps/reading";
import {
  ExperienceTally,
  NO_FIXED_SIGNALS,
  firstRejectCode,
  type FillOutcome,
  type FixedSignals,
} from "@/lib/nps/tally";

// ---------------------------------------------------------------------------
// The levers a plan sponsor can actually pull
// ---------------------------------------------------------------------------

export interface CostShareOverride {
  level: string;
  costShareType?: "Copay" | "Coinsurance" | "NotCovered" | "Zero";
  copayCents?: number;
  coinsuranceRateBps?: number;
  coinsuranceMaxCents?: number;
  accumulatesToRxOop?: boolean;
}

export interface FormularyOverride {
  /** Match by drug id, or by a case-insensitive substring of the drug name. */
  drugId?: string;
  nameContains?: string;
  level?: string;
  requiresPA?: boolean;
  requiresStep?: boolean;
  hasQuantityLimit?: boolean;
}

export interface ConfigOverride {
  costShare?: CostShareOverride[];
  rxOopLimitIndividual?: number;
  federalOopLimitIndividual?: number;
  dawPenaltyEnabled?: boolean;
  specialtyChannelRestricted?: boolean;
  refillThreshold?: number;
  formulary?: FormularyOverride[];
  assumptions?: Partial<BenchmarkAssumptions>;
  /** Swap the contract's lesser-of arms, e.g. to drop usual & customary. */
  lesserOfArms?: PricingArm[];
  /** Override the AWP discount for a channel and drug class, in basis points. */
  rateOverrides?: {
    channel: Channel;
    drugClass: "Brand" | "Generic" | "All";
    awpDiscountBps?: number;
    dispensingFeeCents?: number;
  }[];
}

// ---------------------------------------------------------------------------
// World loading
// ---------------------------------------------------------------------------

interface ReplayWorld {
  plans: Map<string, EngineBenefitPlan>;
  contract: EngineContract;
  drugs: Map<string, EngineDrug & { isBrandLabel: boolean; molecule: string | null }>;
  formulary: Map<string, EngineFormularyEntry>;
  pharmacies: Map<string, EnginePharmacy>;
  members: Map<string, { diagnosisCodes: string[]; weightKg: number | null }>;
  eligibility: Map<
    string,
    { id: string; effectiveDate: Date; terminationDate: Date | null; benefitPlanId: string }
  >;
  approvedPAs: Map<
    string,
    { drugId: string; effectiveDate: Date; terminationDate: Date | null }[]
  >;
}

let worldCache: { world: ReplayWorld; loadedAt: number } | null = null;
const WORLD_TTL_MS = 60_000;

export async function loadWorld(force = false): Promise<ReplayWorld> {
  if (!force && worldCache && Date.now() - worldCache.loadedAt < WORLD_TTL_MS) {
    return worldCache.world;
  }

  const [planRows, contractRow, drugRows, entryRows, pharmacyRows, memberRows, spanRows, paRows, networkLinks] =
    await Promise.all([
      prisma.benefitPlan.findMany({ include: { costShareRules: true } }),
      prisma.contract.findUnique({
        where: { id: "etg0013" },
        include: { rates: true },
      }),
      prisma.drug.findMany({
        select: {
          id: true,
          ndc11: true,
          name: true,
          monyCode: true,
          isBrandLabel: true,
          isSpecialty: true,
          therapeuticClass: true,
          // Carried for clinical screening rather than pricing: duplication is
          // a question about active ingredients, not about products.
          molecule: true,
          // A quantity limit written in packages needs these to mean anything
          // against a quantity billed in grams.
          packageSize: true,
          unitOfMeasure: true,
          packageContainers: true,
          prices: { where: { priceType: "NADAC" }, select: { unitPrice: true } },
        },
      }),
      prisma.formularyEntry.findMany({ where: { formularyId: "navitus-etf-2026" } }),
      prisma.pharmacy.findMany(),
      prisma.member.findMany({ select: { id: true, diagnosisCodes: true, weightKg: true } }),
      prisma.eligibilitySpan.findMany(),
      prisma.priorAuthorization.findMany({
        where: { determination: "Approved" },
        select: {
          memberId: true,
          drugId: true,
          approvedEffectiveDate: true,
          approvedTerminationDate: true,
        },
      }),
      prisma.networkPharmacy.findMany({ where: { networkId: "navicare-limited" } }),
    ]);

  if (!contractRow) throw new Error("Contract etg0013 not found");

  const inNetwork = new Set(networkLinks.map((n) => n.pharmacyId));

  const plans = new Map<string, EngineBenefitPlan>();
  for (const p of planRows) {
    plans.set(p.id, {
      id: p.id,
      name: p.name,
      lineOfBusiness: p.lineOfBusiness as "Commercial" | "EGWP",
      deductibleIndividual: p.deductibleIndividual,
      deductibleIntegratedWithMedical: p.deductibleIntegratedWithMedical,
      rxOopLimitIndividual: p.rxOopLimitIndividual,
      federalOopLimitIndividual: p.federalOopLimitIndividual,
      dawPenaltyEnabled: p.dawPenaltyEnabled,
      specialtyChannelRestricted: p.specialtyChannelRestricted,
      costShareRules: p.costShareRules.map((r) => ({
        level: r.level,
        channel: r.channel as Channel,
        costShareType: r.costShareType as EngineCostShareRule["costShareType"],
        copayCents: r.copayCents,
        coinsuranceRateBps: r.coinsuranceRateBps,
        coinsuranceMaxCents: r.coinsuranceMaxCents,
        accumulatesToRxOop: r.accumulatesToRxOop,
        accumulatesToFederalOop: r.accumulatesToFederalOop,
        citation: r.citation,
      })),
    });
  }

  const rates: EngineRate[] = contractRow.rates
    .filter((r) => r.rateSide === "Pharmacy" && r.lineOfBusiness === "Commercial")
    .map((r) => ({
      channel: r.channel as Channel,
      drugClass: r.drugClass as "Brand" | "Generic" | "All",
      awpDiscountBps: r.awpDiscountBps,
      dispensingFeeCents: r.dispensingFeeCents,
      lesserOfArms: JSON.parse(r.lesserOfArms) as PricingArm[],
      includeUandC: r.includeUandC,
      minRebatePerBrandClaimCents: r.minRebatePerBrandClaimCents,
    }));

  const contract: EngineContract = {
    id: contractRow.id,
    model: contractRow.model as "PassThrough" | "Traditional",
    retailMaxDaysSupply: contractRow.retailMaxDaysSupply,
    discountExclusions: JSON.parse(contractRow.discountExclusions),
    rebateExclusions: JSON.parse(contractRow.rebateExclusions),
    rebateMemberShareThresholdBps: contractRow.rebateMemberShareThresholdBps,
    rates,
    rebatePassThroughBps: contractRow.rebatePassThroughBps,
  };

  const drugs = new Map<
    string,
    EngineDrug & { isBrandLabel: boolean; molecule: string | null }
  >();
  for (const d of drugRows) {
    drugs.set(d.id, {
      id: d.id,
      ndc11: d.ndc11,
      name: d.name,
      monyCode: d.monyCode,
      isBrandLabel: d.isBrandLabel,
      isSpecialty: d.isSpecialty,
      therapeuticClass: d.therapeuticClass,
      molecule: d.molecule,
      nadacPerUnit: d.prices[0]?.unitPrice ?? 0,
      packageSize: d.packageSize,
      unitOfMeasure: d.unitOfMeasure,
      packageContainers: d.packageContainers
        ? (JSON.parse(d.packageContainers) as Record<string, number>)
        : null,
    });
  }

  const formulary = new Map<string, EngineFormularyEntry>();
  for (const e of entryRows) {
    formulary.set(e.drugId, {
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
      requiredDiagnosisCodes: JSON.parse(e.requiredDiagnosisCodes),
      diagnosisRawText: e.diagnosisRawText,
    });
  }

  const pharmacies = new Map<string, EnginePharmacy>();
  for (const p of pharmacyRows) {
    pharmacies.set(p.id, {
      id: p.id,
      npi: p.npi,
      name: p.name,
      pharmacyType: p.pharmacyType,
      isDesignatedSpecialty: p.isDesignatedSpecialty,
      is340B: p.is340B,
      inNetwork: inNetwork.has(p.id),
    });
  }

  const members = new Map(
    memberRows.map((m) => [
      m.id,
      {
        diagnosisCodes: JSON.parse(m.diagnosisCodes) as string[],
        weightKg: m.weightKg,
      },
    ]),
  );

  const eligibility = new Map(
    spanRows.map((s) => [
      s.memberId,
      {
        id: s.id,
        effectiveDate: s.effectiveDate,
        terminationDate: s.terminationDate,
        benefitPlanId: s.benefitPlanId,
      },
    ]),
  );

  const approvedPAs = new Map<
    string,
    { drugId: string; effectiveDate: Date; terminationDate: Date | null }[]
  >();
  for (const pa of paRows) {
    if (!pa.approvedEffectiveDate) continue;
    const list = approvedPAs.get(pa.memberId) ?? [];
    list.push({
      drugId: pa.drugId,
      effectiveDate: pa.approvedEffectiveDate,
      terminationDate: pa.approvedTerminationDate,
    });
    approvedPAs.set(pa.memberId, list);
  }

  const world: ReplayWorld = {
    plans,
    contract,
    drugs,
    formulary,
    pharmacies,
    members,
    eligibility,
    approvedPAs,
  };
  worldCache = { world, loadedAt: Date.now() };
  return world;
}

// ---------------------------------------------------------------------------
// Applying an override
// ---------------------------------------------------------------------------

function applyPlanOverride(
  plan: EngineBenefitPlan,
  o: ConfigOverride,
): EngineBenefitPlan {
  const rules = plan.costShareRules.map((r) => {
    const patch = o.costShare?.find((c) => c.level === r.level);
    if (!patch) return r;
    return {
      ...r,
      costShareType: patch.costShareType ?? r.costShareType,
      copayCents:
        patch.copayCents !== undefined ? patch.copayCents : r.copayCents,
      coinsuranceRateBps:
        patch.coinsuranceRateBps !== undefined
          ? patch.coinsuranceRateBps
          : r.coinsuranceRateBps,
      coinsuranceMaxCents:
        patch.coinsuranceMaxCents !== undefined
          ? patch.coinsuranceMaxCents
          : r.coinsuranceMaxCents,
      accumulatesToRxOop:
        patch.accumulatesToRxOop !== undefined
          ? patch.accumulatesToRxOop
          : r.accumulatesToRxOop,
    };
  });

  return {
    ...plan,
    rxOopLimitIndividual: o.rxOopLimitIndividual ?? plan.rxOopLimitIndividual,
    federalOopLimitIndividual:
      o.federalOopLimitIndividual ?? plan.federalOopLimitIndividual,
    dawPenaltyEnabled: o.dawPenaltyEnabled ?? plan.dawPenaltyEnabled,
    specialtyChannelRestricted:
      o.specialtyChannelRestricted ?? plan.specialtyChannelRestricted,
    costShareRules: rules,
  };
}

function applyContractOverride(
  contract: EngineContract,
  o: ConfigOverride,
): EngineContract {
  if (!o.lesserOfArms && !o.rateOverrides) return contract;
  return {
    ...contract,
    rates: contract.rates.map((r) => {
      const patch = o.rateOverrides?.find(
        (x) => x.channel === r.channel && x.drugClass === r.drugClass,
      );
      return {
        ...r,
        lesserOfArms: o.lesserOfArms ?? r.lesserOfArms,
        includeUandC: o.lesserOfArms
          ? o.lesserOfArms.includes("UANDC")
          : r.includeUandC,
        awpDiscountBps: patch?.awpDiscountBps ?? r.awpDiscountBps,
        dispensingFeeCents: patch?.dispensingFeeCents ?? r.dispensingFeeCents,
      };
    }),
  };
}

function applyFormularyOverride(
  entry: EngineFormularyEntry,
  drugName: string,
  drugId: string,
  o: ConfigOverride,
): EngineFormularyEntry {
  const patches = (o.formulary ?? []).filter(
    (f) =>
      (f.drugId && f.drugId === drugId) ||
      (f.nameContains &&
        drugName.toUpperCase().includes(f.nameContains.toUpperCase())),
  );
  if (patches.length === 0) return entry;
  let next = entry;
  for (const p of patches) {
    next = {
      ...next,
      level: p.level ?? next.level,
      requiresPA: p.requiresPA ?? next.requiresPA,
      requiresStep: p.requiresStep ?? next.requiresStep,
      hasQuantityLimit: p.hasQuantityLimit ?? next.hasQuantityLimit,
      notCovered: p.level === "NC" ? true : next.notCovered,
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------

/**
 * How a stored B2 contributes to the before/after totals under an override.
 *
 * The before side is always the stored reversal. The after side is the
 * negation of the re-priced original when that original still paid, or zero
 * when it did not — never "omit the row", which would leave the baseline
 * carrying clawed-back dollars as if they were still plan-paid.
 */
export function reversalReplayDelta(args: {
  stored: {
    planPaidCents: number;
    patientPayCents: number;
    rebateCents: number;
    totalBilledCents: number;
  };
  replayedOriginal: {
    plan: number;
    member: number;
    rebate: number;
    billed: number;
  } | null;
}): {
  planPaidBeforeCents: number;
  planPaidAfterCents: number;
  memberPaidBeforeCents: number;
  memberPaidAfterCents: number;
  rebateBeforeCents: number;
  rebateAfterCents: number;
  changed: boolean;
} {
  const { stored, replayedOriginal: original } = args;
  const planPaidAfterCents = original ? -original.plan : 0;
  const memberPaidAfterCents = original ? -original.member : 0;
  const rebateAfterCents = original ? -original.rebate : 0;
  const changed = original
    ? stored.planPaidCents !== -original.plan ||
      stored.patientPayCents !== -original.member ||
      stored.totalBilledCents !== -original.billed
    : stored.planPaidCents !== 0 ||
      stored.patientPayCents !== 0 ||
      stored.rebateCents !== 0;
  return {
    planPaidBeforeCents: stored.planPaidCents,
    planPaidAfterCents,
    memberPaidBeforeCents: stored.patientPayCents,
    memberPaidAfterCents,
    rebateBeforeCents: stored.rebateCents,
    rebateAfterCents,
    changed,
  };
}

export interface ClaimDiff {
  claimId: string;
  claimNumber: string;
  memberId: string;
  memberName: string;
  drugName: string;
  dateOfService: Date;
  level: string | null;
  channel: string;
  before: {
    status: string;
    rejectCode: string | null;
    totalBilledCents: number;
    planPaidCents: number;
    patientPayCents: number;
  };
  after: {
    status: string;
    rejectCode: string | null;
    totalBilledCents: number;
    planPaidCents: number;
    patientPayCents: number;
  };
  planDeltaCents: number;
  memberDeltaCents: number;
  /** What kind of change this is, for grouping in the UI. */
  kind: "cost" | "newly-rejected" | "newly-paid";
}

export interface ReplayResult {
  claimsEvaluated: number;
  claimsChanged: number;
  membersAffected: number;
  planPaidBeforeCents: number;
  planPaidAfterCents: number;
  memberPaidBeforeCents: number;
  memberPaidAfterCents: number;
  rebateBeforeCents: number;
  rebateAfterCents: number;
  newRejects: number;
  newlyPaid: number;
  /** Members whose full-year out of pocket moved by more than a dollar. */
  memberImpacts: {
    memberId: string;
    memberName: string;
    beforeCents: number;
    afterCents: number;
    deltaCents: number;
    claims: number;
  }[];
  diffs: ClaimDiff[];
  /**
   * What the change does to how members would rate the benefit, present only
   * when asked for with { nps: true }. The pairing is the point: a proposal
   * that saves the plan two million dollars and costs seven points of member
   * experience is a different proposal from one that saves the same money and
   * costs nothing.
   */
  nps?: { before: NpsReading; after: NpsReading };
  /**
   * The fraction of members this ran against. One for a full run.
   *
   * Carried on the result rather than remembered by the caller, so a figure
   * can never be presented as measured when it was projected.
   */
  sampleRate: number;
  elapsedMs: number;
}

interface ReplayClaimRow {
  id: string;
  claimNumber: string;
  memberId: string;
  drugId: string;
  pharmacyId: string;
  dateOfService: Date;
  rxNumber: string;
  fillNumber: number;
  quantityDispensed: number;
  daysSupply: number;
  dawCode: string;
  compoundCode: string;
  usualAndCustomaryCents: number;
  ingredientCostSubmittedCents: number;
  transactionCode: string;
  reversalOfClaimId: string | null;
  responseStatus: string;
  rejectCodes: string;
  totalBilledCents: number;
  planPaidCents: number;
  patientPayCents: number;
  appliedToDeductibleCents: number;
  brandSelectionPenaltyCents: number;
  estimatedRebateCents: number;
  formularyLevel: string | null;
  channel: string;
  firstName: string;
  lastName: string;
  drugName: string;
}

/**
 * Whether a member is in the sample.
 *
 * By a hash of their id, so the sample is the same every time it is drawn. That
 * matters more than it sounds: a projection that shuffled its sample between
 * runs would report a slightly different answer each time somebody pressed the
 * button, and the difference would be indistinguishable from the effect of
 * whatever they had just changed.
 *
 * A separate hash namespace from temperament and from survey response, so the
 * sample cannot correlate with either. Drawing a sample that happened to favour
 * generous members would bias the projection in exactly the flattering
 * direction nobody would think to check.
 */
function inSample(rate: number): (m: { id: string }) => boolean {
  return (m) => hashString(`${m.id}:sample`) / 4294967296 < rate;
}

/**
 * Stream the book one block of members at a time.
 *
 * Loading a million and a half claims to re-price them would need gigabytes
 * before the first claim was evaluated. Members are the natural unit to page
 * by, because a member's accumulator has to be rebuilt from their own claims
 * in date order and never depends on anyone else's. Blocking by member keeps
 * that ordering intact while bounding what is resident to one block.
 */
async function* streamClaimsByMember(
  cutoff: Date,
  blockSize = 400,
  sampleRate = 1,
): AsyncGenerator<ReplayClaimRow[]> {
  let cursor: string | null = null;
  // Paging over the member table is cheap; pulling their claims is not. When
  // only a fraction of members will survive the filter, take bigger bites so
  // the fixed cost of a round trip is not paid for a handful of members.
  const take = sampleRate < 1 ? Math.ceil(blockSize / sampleRate) : blockSize;

  for (;;) {
    const page: { id: string }[] = await prisma.member.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) return;
    cursor = page[page.length - 1].id;

    const members = sampleRate < 1 ? page.filter(inSample(sampleRate)) : page;
    if (members.length === 0) continue;

    /*
     * Placeholders are written out and bound positionally rather than built
     * with Prisma.join.
     *
     * Prisma.join returns a Sql object that the tagged-template form only
     * recognises when the helper and the client come from the same module
     * instance. Under the bundler that is not guaranteed, and when it fails it
     * fails silently: the object is bound as an ordinary parameter, the IN
     * clause matches nothing, and the replay reports that it re-adjudicated
     * zero claims and found no differences. A change console that answers
     * "nothing would change" to every question is worse than one that errors,
     * because it looks like a result.
     */
    const ids = members.map((m) => m.id);
    const rows = await prisma.$queryRawUnsafe<ReplayClaimRow[]>(
      `SELECT c.id, c.claimNumber, c.memberId, c.drugId, c.pharmacyId,
              c.dateOfService, c.rxNumber, c.fillNumber, c.quantityDispensed,
              c.daysSupply, c.dawCode, c.compoundCode, c.usualAndCustomaryCents,
              c.ingredientCostSubmittedCents, c.transactionCode, c.reversalOfClaimId,
              c.responseStatus, c.rejectCodes,
              c.totalBilledCents, c.planPaidCents, c.patientPayCents,
              c.appliedToDeductibleCents, c.brandSelectionPenaltyCents,
              c.estimatedRebateCents, c.formularyLevel, c.channel,
              m.firstName, m.lastName, d.name AS drugName
       FROM Claim c
       JOIN Member m ON m.id = c.memberId
       JOIN Drug d   ON d.id = c.drugId
       WHERE c.memberId IN (${ids.map(() => "?").join(",")})
         AND c.dateOfService <= ?
       ORDER BY c.memberId, c.dateOfService, c.claimNumber`,
      ...ids,
      cutoff,
    );
    if (rows.length > 0) yield rows;
  }
}

function fillOutcomeFromRow(row: ReplayClaimRow): FillOutcome {
  return {
    responseStatus: row.responseStatus,
    transactionCode: row.transactionCode,
    patientPayCents: row.patientPayCents,
    appliedToDeductibleCents: row.appliedToDeductibleCents,
    brandSelectionPenaltyCents: row.brandSelectionPenaltyCents,
    channel: row.channel,
    rejectCode: firstRejectCode(row.rejectCodes),
  };
}

/**
 * The parts of a member's experience a re-pricing leaves alone.
 *
 * Loaded in three grouped statements rather than per member, since the whole
 * book is about to be walked anyway and a hundred thousand round trips would
 * cost more than the replay itself.
 */
async function loadFixedSignals(
  cutoff: Date,
): Promise<Map<string, FixedSignals>> {
  const standardMs = 72 * 3_600_000;
  const expeditedMs = 24 * 3_600_000;

  const [pas, durs, clawbacks] = await Promise.all([
    prisma.$queryRaw<
      {
        memberId: string;
        denied: bigint | number;
        slow: bigint | number;
        onTime: bigint | number;
      }[]
    >`
      SELECT p.memberId AS memberId,
             SUM(CASE WHEN p.determination = 'Denied' THEN 1 ELSE 0 END) AS denied,
             SUM(CASE WHEN p.determination = 'Approved'
                       AND (p.decidedAt - p.receivedAt) >
                           (CASE WHEN p.urgency = 'Expedited' THEN ${expeditedMs} ELSE ${standardMs} END)
                      THEN 1 ELSE 0 END) AS slow,
             SUM(CASE WHEN p.determination = 'Approved'
                       AND (p.decidedAt - p.receivedAt) <=
                           (CASE WHEN p.urgency = 'Expedited' THEN ${expeditedMs} ELSE ${standardMs} END)
                      THEN 1 ELSE 0 END) AS onTime
      FROM PriorAuthorization p
      WHERE p.decidedAt IS NOT NULL AND p.decidedAt <= ${cutoff}
      GROUP BY p.memberId
    `,
    prisma.$queryRaw<{ memberId: string; major: bigint | number }[]>`
      SELECT memberId, COUNT(*) AS major
      FROM DurAlert
      WHERE severity = 'Major' AND dateOfService <= ${cutoff}
      GROUP BY memberId
    `,
    prisma.$queryRaw<{ memberId: string }[]>`
      SELECT DISTINCT c.memberId AS memberId
      FROM Claim c
      JOIN EligibilitySpan e ON e.memberId = c.memberId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND e.retroReportedAt IS NOT NULL
        AND e.retroReportedAt <= ${cutoff}
        AND c.dateOfService > e.reportedTerminationDate
        AND c.dateOfService <= ${cutoff}
    `,
  ]);

  const map = new Map<string, FixedSignals>();
  const at = (id: string): FixedSignals => {
    let s = map.get(id);
    if (!s) {
      s = { ...NO_FIXED_SIGNALS };
      map.set(id, s);
    }
    return s;
  };

  for (const r of pas) {
    const s = at(r.memberId);
    s.paDenied = Number(r.denied);
    s.paSlow = Number(r.slow);
    s.paOnTime = Number(r.onTime);
  }
  for (const r of durs) at(r.memberId).majorDurAlerts = Number(r.major);
  for (const r of clawbacks) at(r.memberId).retroClawback = true;

  return map;
}

export async function replay(
  override: ConfigOverride = {},
  opts: {
    maxDiffs?: number;
    asOf?: Date;
    nps?: boolean;
    /**
     * Run against a fraction of members rather than all of them.
     *
     * The engine, the schedule and the arithmetic are identical; there are
     * simply fewer members in the book it sees. That makes a projection an
     * understatement of confidence rather than a different kind of claim: it
     * is the same measurement, taken on less of the population, and it can be
     * checked against the full run a minute later.
     */
    sampleRate?: number;
  } = {},
): Promise<ReplayResult> {
  const started = Date.now();
  const world = await loadWorld();
  const maxDiffs = opts.maxDiffs ?? 250;
  const sampleRate = Math.min(1, Math.max(0.001, opts.sampleRate ?? 1));
  /*
   * A change is evaluated against the book that exists, not against fills
   * that have not happened. Re-pricing next November would be inventing an
   * impact rather than measuring one.
   */
  const cutoff = opts.asOf ?? PLAN_YEAR_END;

  const assumptions: BenchmarkAssumptions = {
    ...DEFAULT_ASSUMPTIONS,
    ...override.assumptions,
  };
  const contract = applyContractOverride(world.contract, override);
  const planCache = new Map<string, EngineBenefitPlan>();

  const result: ReplayResult = {
    claimsEvaluated: 0,
    claimsChanged: 0,
    membersAffected: 0,
    planPaidBeforeCents: 0,
    planPaidAfterCents: 0,
    memberPaidBeforeCents: 0,
    memberPaidAfterCents: 0,
    rebateBeforeCents: 0,
    rebateAfterCents: 0,
    newRejects: 0,
    newlyPaid: 0,
    memberImpacts: [],
    diffs: [],
    sampleRate,
    elapsedMs: 0,
  };

  /*
   * The member-experience side, built alongside the money.
   *
   * Two tallies run per member, one fed the stored outcome and one the
   * re-priced outcome, and each is scored and folded into an accumulator when
   * the member changes. Nothing accumulates across members, so the cost of
   * this is a pair of small objects however large the book gets.
   *
   * Signals a re-pricing cannot change — a denied authorisation, a clinical
   * alert, a retroactive termination — are loaded once and given to both
   * sides, so the reported delta is the part the benefit change caused rather
   * than history reappearing on one side of the comparison.
   */
  const npsOn = opts.nps === true;
  const fixedSignals = npsOn ? await loadFixedSignals(cutoff) : new Map();
  const npsBefore = new ReadingAccumulator();
  const npsAfter = new ReadingAccumulator();
  let tallyBefore: ExperienceTally | null = null;
  let tallyAfter: ExperienceTally | null = null;

  const closeMember = () => {
    if (tallyBefore) npsBefore.add(tallyBefore.exp);
    if (tallyAfter) npsAfter.add(tallyAfter.exp);
    tallyBefore = null;
    tallyAfter = null;
  };

  let currentMember = "";
  let priorFills: PriorFill[] = [];
  let acc = {
    rxOopAccumulatedCents: 0,
    federalOopAccumulatedCents: 0,
    deductibleAccumulatedCents: 0,
  };
  const memberTotals = new Map<
    string,
    { name: string; before: number; after: number; claims: number; changed: boolean }
  >();

  /*
   * Outcomes of this member's re-priced fills, so a reversal can be settled
   * against the fill as re-priced rather than as originally stored. Reset with
   * the accumulators when the member changes.
   */
  let replayed = new Map<
    string,
    { plan: number; member: number; billed: number; rebate: number }
  >();

  /*
   * The medical half of an integrated deductible for the member being replayed.
   * Resolved lazily, because it needs the effective plan and the plan is only
   * known once a claim has been read. Held with a cursor so the balance climbs
   * as the member's fills move through the year, matching how the book was
   * priced the first time.
   */
  let medicalEncounters: MedicalEncounter[] | null = null;
  let medicalCursor = 0;

  for await (const block of streamClaimsByMember(cutoff, 400, sampleRate)) {
  for (const row of block) {
    if (row.memberId !== currentMember) {
      if (npsOn) {
        closeMember();
        const fixed = fixedSignals.get(row.memberId) ?? NO_FIXED_SIGNALS;
        tallyBefore = new ExperienceTally(row.memberId, fixed);
        tallyAfter = new ExperienceTally(row.memberId, fixed);
      }
      currentMember = row.memberId;
      priorFills = [];
      replayed = new Map();
      acc = {
        rxOopAccumulatedCents: 0,
        federalOopAccumulatedCents: 0,
        deductibleAccumulatedCents: 0,
      };
      medicalEncounters = null;
      medicalCursor = 0;
    }

    /*
     * A reversal is not re-adjudicated. It has no pricing of its own: it is
     * whatever its original turned out to be, negated. Pricing it a second
     * time would let a reversal drift away from the fill it is supposed to
     * cancel, which is the one thing a reversal must never do.
     *
     * It also does not put accumulator credit back for the purposes of
     * re-pricing later fills. Withdrawing credit mid-year would change the
     * cost share on everything the member filled afterwards, and a change
     * console that reported those as the effect of a formulary edit would be
     * lying about its own arithmetic. The credit is withdrawn on the member's
     * ledger, where it belongs; what a benefit change costs is measured
     * against fills as they were priced.
     */
    if (row.transactionCode === "B2") {
      /*
       * Counted on both sides before anything else happens. A reversal exists
       * because a fill was undone, and re-pricing the book does not un-undo
       * it; letting it land on only one side would show a member's experience
       * changing when all that changed was the price of the fill behind it.
       */
      if (npsOn) {
        const fill = fillOutcomeFromRow(row);
        tallyBefore?.add(fill);
        tallyAfter?.add(fill);
      }

      /*
       * The before side always includes the stored B2. Skipping it when the
       * re-priced original is absent (newly rejected under an override, or
       * never paid) drops the clawback from the baseline and reports the
       * original fill's dollars as still plan-paid — so excluding an
       * already-reversed drug invents phantom savings equal to the fill.
       */
      const original = replayed.get(row.reversalOfClaimId ?? "") ?? null;
      const delta = reversalReplayDelta({
        stored: {
          planPaidCents: row.planPaidCents,
          patientPayCents: row.patientPayCents,
          rebateCents: row.estimatedRebateCents,
          totalBilledCents: row.totalBilledCents,
        },
        replayedOriginal: original,
      });
      result.claimsEvaluated++;
      result.planPaidBeforeCents += delta.planPaidBeforeCents;
      result.planPaidAfterCents += delta.planPaidAfterCents;
      result.memberPaidBeforeCents += delta.memberPaidBeforeCents;
      result.memberPaidAfterCents += delta.memberPaidAfterCents;
      result.rebateBeforeCents += delta.rebateBeforeCents;
      result.rebateAfterCents += delta.rebateAfterCents;
      if (delta.changed) result.claimsChanged++;
      continue;
    }

    const drug = world.drugs.get(row.drugId);
    const pharmacy = world.pharmacies.get(row.pharmacyId);
    const member = world.members.get(row.memberId);
    const elig = world.eligibility.get(row.memberId);
    if (!drug || !pharmacy || !member || !elig) continue;

    const basePlan = world.plans.get(elig.benefitPlanId);
    if (!basePlan) continue;
    let plan = planCache.get(elig.benefitPlanId);
    if (!plan) {
      plan = applyPlanOverride(basePlan, override);
      planCache.set(elig.benefitPlanId, plan);
    }

    const baseEntry = world.formulary.get(row.drugId) ?? null;
    const entry = baseEntry
      ? applyFormularyOverride(baseEntry, drug.name, drug.id, override)
      : null;

    if (medicalEncounters === null) {
      medicalEncounters = plan.deductibleIntegratedWithMedical
        ? medicalEncountersFor(row.memberId, plan.deductibleIndividual)
        : [];
    }
    const fillDay = dayOfPlanYear(new Date(row.dateOfService));
    while (
      medicalCursor < medicalEncounters.length &&
      medicalEncounters[medicalCursor]!.day < fillDay
    ) {
      acc.deductibleAccumulatedCents +=
        medicalEncounters[medicalCursor]!.amountCents;
      medicalCursor++;
    }

    const ctx: AdjudicationContext = {
      request: {
        dateOfService: new Date(row.dateOfService),
        cardholderId: "",
        personCode: "01",
        serviceProviderId: pharmacy.npi,
        productServiceId: drug.ndc11,
        rxNumber: row.rxNumber,
        fillNumber: row.fillNumber,
        quantityDispensed: row.quantityDispensed,
        daysSupply: row.daysSupply,
        dawCode: row.dawCode,
        usualAndCustomaryCents: row.usualAndCustomaryCents,
        ingredientCostSubmittedCents: row.ingredientCostSubmittedCents,
        compoundCode: row.compoundCode,
      },
      member: { id: row.memberId, diagnosisCodes: member.diagnosisCodes, weightKg: member.weightKg },
      eligibility: elig,
      plan,
      drug,
      formularyEntry: entry,
      pharmacy,
      contract,
      priorFills,
      accumulators: { ...acc },
      approvedPAs: world.approvedPAs.get(row.memberId) ?? [],
      assumptions,
      refillThreshold: override.refillThreshold,
    };

    const out = adjudicate(ctx);
    result.claimsEvaluated++;

    if (npsOn) {
      tallyBefore?.add(fillOutcomeFromRow(row));
      tallyAfter?.add({
        responseStatus: out.responseStatus,
        transactionCode: "B1",
        patientPayCents: out.patientPayCents,
        appliedToDeductibleCents: out.appliedToDeductibleCents,
        brandSelectionPenaltyCents: out.brandSelectionPenaltyCents,
        channel: out.channel,
        rejectCode: out.rejectCodes[0] ?? null,
      });
    }

    if (out.responseStatus === "P") {
      replayed.set(row.id, {
        plan: out.planPaidCents,
        member: out.patientPayCents,
        billed: out.totalBilledCents,
        rebate: out.estimatedRebateCents,
      });
      priorFills.push({
        dateOfService: new Date(row.dateOfService),
        daysSupply: row.daysSupply,
        quantityDispensed: row.quantityDispensed,
        drugId: row.drugId,
        therapeuticClass: drug.therapeuticClass,
      });
      for (const d of out.costShare?.accumulatorDeltas ?? []) {
        const cents = Math.round(d.amountMicros / 10_000);
        if (d.accumulatorType === "RxOopIndividual") acc.rxOopAccumulatedCents += cents;
        if (d.accumulatorType === "FederalOopIndividual")
          acc.federalOopAccumulatedCents += cents;
        if (d.accumulatorType === "DeductibleIndividual")
          acc.deductibleAccumulatedCents += cents;
      }
    }

    result.planPaidBeforeCents += row.planPaidCents;
    result.planPaidAfterCents += out.planPaidCents;
    result.memberPaidBeforeCents += row.patientPayCents;
    result.memberPaidAfterCents += out.patientPayCents;
    result.rebateBeforeCents += row.estimatedRebateCents;
    result.rebateAfterCents += out.estimatedRebateCents;

    const totals = memberTotals.get(row.memberId) ?? {
      name: `${row.firstName} ${row.lastName}`,
      before: 0,
      after: 0,
      claims: 0,
      changed: false,
    };
    totals.before += row.patientPayCents;
    totals.after += out.patientPayCents;
    totals.claims++;

    const statusChanged = out.responseStatus !== row.responseStatus;
    const moneyChanged =
      out.planPaidCents !== row.planPaidCents ||
      out.patientPayCents !== row.patientPayCents ||
      out.totalBilledCents !== row.totalBilledCents;

    if (statusChanged || moneyChanged) {
      result.claimsChanged++;
      totals.changed = true;
      if (statusChanged && out.responseStatus === "R") result.newRejects++;
      if (statusChanged && out.responseStatus === "P") result.newlyPaid++;

      if (result.diffs.length < maxDiffs) {
        const beforeReject = (() => {
          try {
            return (JSON.parse(row.rejectCodes) as string[])[0] ?? null;
          } catch {
            return null;
          }
        })();
        result.diffs.push({
          claimId: row.id,
          claimNumber: row.claimNumber,
          memberId: row.memberId,
          memberName: `${row.firstName} ${row.lastName}`,
          drugName: row.drugName,
          dateOfService: new Date(row.dateOfService),
          level: row.formularyLevel,
          channel: row.channel,
          before: {
            status: row.responseStatus,
            rejectCode: beforeReject,
            totalBilledCents: row.totalBilledCents,
            planPaidCents: row.planPaidCents,
            patientPayCents: row.patientPayCents,
          },
          after: {
            status: out.responseStatus,
            rejectCode: out.rejectCodes[0] ?? null,
            totalBilledCents: out.totalBilledCents,
            planPaidCents: out.planPaidCents,
            patientPayCents: out.patientPayCents,
          },
          planDeltaCents: out.planPaidCents - row.planPaidCents,
          memberDeltaCents: out.patientPayCents - row.patientPayCents,
          kind: statusChanged
            ? out.responseStatus === "R"
              ? "newly-rejected"
              : "newly-paid"
            : "cost",
        });
      }
    }

    memberTotals.set(row.memberId, totals);
  }
  }

  // The last member in the stream has nobody after them to trigger the close.
  if (npsOn) {
    closeMember();
    result.nps = { before: npsBefore.result(), after: npsAfter.result() };
  }

  for (const [memberId, t] of memberTotals) {
    if (!t.changed) continue;
    result.membersAffected++;
    if (Math.abs(t.after - t.before) >= 100) {
      result.memberImpacts.push({
        memberId,
        memberName: t.name,
        beforeCents: t.before,
        afterCents: t.after,
        deltaCents: t.after - t.before,
        claims: t.claims,
      });
    }
  }
  result.memberImpacts.sort(
    (a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents),
  );
  result.memberImpacts = result.memberImpacts.slice(0, 25);
  result.diffs.sort(
    (a, b) =>
      Math.abs(b.planDeltaCents) + Math.abs(b.memberDeltaCents) -
      (Math.abs(a.planDeltaCents) + Math.abs(a.memberDeltaCents)),
  );

  result.elapsedMs = Date.now() - started;
  return result;
}
