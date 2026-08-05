/**
 * Prior authorizations for the general population.
 *
 * The scripted demo members get hand-written requests so their stories hold
 * together. Everyone else gets a request generated here and put through the
 * same criteria engine the demo uses, which matters for two reasons.
 *
 * The first is that a specialty claim should only pay because a real
 * traversal approved it, not because the seed quietly granted an
 * authorization. The second is branch coverage: a criteria tree that no
 * request has ever walked is transcription with nothing behind it, and the
 * proof page reports that gap honestly. Generating a spread of realistic fact
 * patterns is what turns those forms from claims into evidence.
 *
 * The facts are pseudo-random but deterministic, so the same seed produces the
 * same determinations and every claim remains replayable.
 */

import type { Prisma, PrismaClient } from "../../src/generated/prisma/index.js";
import {
  findTreeForDrug,
  type CriteriaTreeDef,
} from "../../src/lib/pa/criteria.js";
import {
  determinePA,
  paDeadlines,
  type PAFacts,
} from "../../src/lib/pa/engine.js";
import type { Rng } from "./population.js";

/** Whether this drug has a transcribed criteria form behind it. */
export function isCriteriaGoverned(drugName: string): boolean {
  return findTreeForDrug(drugName) !== undefined;
}

export interface PACandidate {
  memberId: string;
  drugId: string;
  drugName: string;
  /** The first date the member needs the drug covered. */
  firstFillDate: Date;
  /** The last day of the plan year, after which renewals are next year's. */
  planYearEnd: Date;
  diagnosisCodes: string[];
  filledDrugNames: string[];
  ageYears: number;
  weightKg: number;
}

export interface GeneratedPA {
  memberId: string;
  drugId: string;
  effectiveDate: Date;
  terminationDate: Date;
}

const PRESCRIBERS = [
  { name: "Dr. A. Reinhart", specialty: "Dermatology" },
  { name: "Dr. M. Okonkwo", specialty: "Rheumatology" },
  { name: "Dr. S. Lindqvist", specialty: "Gastroenterology" },
  { name: "Dr. P. Nakamura", specialty: "Allergy and Immunology" },
  { name: "Dr. J. Whitfield", specialty: "Internal Medicine" },
  { name: "Dr. R. Castellanos", specialty: "Pulmonology" },
];

/*
 * Fact patterns per tree, weighted so that most requests are clean approvals
 * and a realistic minority fail at each of the places a real request fails.
 * The weights are what drive branch coverage: without a deliberate share of
 * incomplete submissions, the "no dosing provided" branch is never walked and
 * the form is only half evidenced.
 */
interface FactPattern {
  weight: number;
  label: string;
  build: (c: PACandidate) => Partial<PAFacts>;
}

/**
 * Field names below are the ones the trees actually read. They are not
 * descriptive labels: `criteria.ts` looks up `answers.diagnosisCriteria`, so a
 * pattern that writes `diagnosisSelection` denies at that step for a reason
 * that has nothing to do with the member.
 */
const PATTERNS: Record<string, FactPattern[]> = {
  "pa-skyrizi-sc": [
    {
      weight: 52,
      label: "complete initial request with a documented trial",
      build: (c) => ({
        condition: psoriasisCondition(c),
        prescriberSpecialty: "Dermatology",
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
          phototherapyTrial: true,
        },
      }),
    },
    {
      weight: 13,
      label: "no documented trial of phototherapy, methotrexate or acitretin",
      build: (c) => ({
        condition: psoriasisCondition(c),
        prescriberSpecialty: "Dermatology",
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
          phototherapyTrial: false,
          allAlternativesContraindicated: false,
        },
      }),
    },
    {
      weight: 9,
      label: "trial not done, all alternatives contraindicated and listed",
      build: (c) => ({
        condition: psoriasisCondition(c),
        prescriberSpecialty: "Dermatology",
        answers: {
          diagnosisCriteria: ["debilitating-palmoplantar-psoriasis"],
          phototherapyTrial: false,
          allAlternativesContraindicated: true,
          contraindicationsListed: true,
        },
      }),
    },
    {
      weight: 6,
      label: "contraindications asserted at step 8 but never listed at step 9",
      build: (c) => ({
        condition: psoriasisCondition(c),
        prescriberSpecialty: "Dermatology",
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
          phototherapyTrial: false,
          allAlternativesContraindicated: true,
          contraindicationsListed: false,
        },
      }),
    },
    {
      weight: 10,
      label: "disease severity below the threshold the criteria require",
      build: (c) => ({
        condition: psoriasisCondition(c),
        prescriberSpecialty: "Dermatology",
        answers: { diagnosisCriteria: [], phototherapyTrial: true },
      }),
    },
    {
      weight: 10,
      label: "prescriber is not a dermatologist",
      build: (c) => ({
        condition: psoriasisCondition(c),
        prescriberSpecialty: "Internal Medicine",
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
          phototherapyTrial: true,
        },
      }),
    },
  ],

  "pa-dupixent": [
    {
      weight: 46,
      label: "complete atopic dermatitis request with topical trial",
      build: (c) => ({
        condition: dupixentCondition(c),
        prescriberSpecialty: "Dermatology",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
          topicalTrialDocumented: true,
        },
      }),
    },
    {
      weight: 13,
      label: "no topical corticosteroid trial documented",
      build: (c) => ({
        condition: dupixentCondition(c),
        prescriberSpecialty: "Dermatology",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: true,
          topicalTrialDocumented: false,
        },
      }),
    },
    {
      weight: 12,
      label: "quantity outside the listed limits, dosing supplied on request",
      build: (c) => ({
        condition: dupixentCondition(c),
        prescriberSpecialty: "Allergy and Immunology",
        answers: {
          quantityLimitBasis: [],
          quantityDosingProvided: true,
          diagnosisProvided: true,
          topicalTrialDocumented: true,
        },
      }),
    },
    {
      weight: 8,
      label: "quantity outside the listed limits and no dosing supplied",
      build: (c) => ({
        condition: dupixentCondition(c),
        prescriberSpecialty: "Allergy and Immunology",
        answers: { quantityLimitBasis: [], quantityDosingProvided: false },
      }),
    },
    {
      weight: 8,
      label: "no ICD-10 diagnosis on the form",
      build: (c) => ({
        condition: dupixentCondition(c),
        prescriberSpecialty: "Dermatology",
        answers: {
          quantityLimitBasis: ["maintenance-ad-asthma"],
          diagnosisProvided: false,
        },
      }),
    },
    {
      weight: 8,
      label: "an indication this criteria set does not cover",
      build: () => ({
        condition: "copd-initial",
        prescriberSpecialty: "Pulmonology",
        answers: {
          quantityLimitBasis: ["crswnp-copd-2-inj-28d"],
          diagnosisProvided: true,
        },
      }),
    },
  ],

  "pa-adalimumab": [
    {
      weight: 48,
      label: "complete request with the required prior therapy",
      build: () => ({
        prescriberSpecialty: "Rheumatology",
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
          conventionalTherapyTrial: true,
        },
      }),
    },
    {
      weight: 12,
      label: "loading dose, complete",
      build: () => ({
        prescriberSpecialty: "Gastroenterology",
        answers: {
          quantityLimitBasis: ["loading-dose"],
          preferredBiosimilarOrFailure: true,
          conventionalTherapyTrial: true,
        },
      }),
    },
    {
      weight: 14,
      label: "reference product requested with no biosimilar failure",
      build: () => ({
        prescriberSpecialty: "Rheumatology",
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: false,
        },
      }),
    },
    {
      weight: 12,
      label: "no conventional therapy tried first",
      build: () => ({
        prescriberSpecialty: "Rheumatology",
        answers: {
          quantityLimitBasis: ["standard-2-inj-28-days"],
          preferredBiosimilarOrFailure: true,
          conventionalTherapyTrial: false,
        },
      }),
    },
    {
      weight: 8,
      label: "quantity off the listed limits, dosing supplied on request",
      build: () => ({
        prescriberSpecialty: "Dermatology",
        answers: {
          quantityLimitBasis: [],
          quantityDosingProvided: true,
          preferredBiosimilarOrFailure: true,
          conventionalTherapyTrial: true,
        },
      }),
    },
    {
      weight: 6,
      label: "incomplete submission",
      build: () => ({
        prescriberSpecialty: "Internal Medicine",
        answers: { quantityLimitBasis: [], quantityDosingProvided: false },
      }),
    },
  ],
};

/*
 * The Skyrizi form covers seven indications, but only the initial plaque
 * psoriasis branch is transcribed in full. Requests for the other indications
 * are still made, and the honest result is a denial at step 4 recording that
 * this criteria set does not cover them.
 */
function psoriasisCondition(c: PACandidate): string {
  if (c.diagnosisCodes.some((d) => d.startsWith("L40")))
    return "plaque-psoriasis-initial";
  if (c.diagnosisCodes.some((d) => d.startsWith("K50")))
    return "crohns-initial";
  if (c.diagnosisCodes.some((d) => d.startsWith("K51")))
    return "ulcerative-colitis-initial";
  return "psoriatic-arthritis";
}

function dupixentCondition(c: PACandidate): string {
  if (c.diagnosisCodes.some((d) => d.startsWith("L20")))
    return "atopic-dermatitis-initial";
  if (c.diagnosisCodes.some((d) => d.startsWith("J45"))) return "asthma-initial";
  return "atopic-dermatitis-initial";
}

/** A decided request, ready to be written once claim generation finishes. */
export interface DecidedPA {
  memberId: string;
  drugId: string;
  /**
   * Null when no criteria form for this product has been transcribed. Such a
   * request is still real work and still gets decided; it is decided by a
   * pharmacist rather than by walking a tree, and it carries no traversal.
   * Keeping the two kinds in one queue is what makes the automation rate on
   * the queue an honest number instead of a flattering one.
   */
  treeId: string | null;
  urgency: "Standard" | "Expedited";
  prescriberName: string;
  prescriberSpecialty: string;
  answers: Record<string, unknown>;
  outcome: "Approved" | "Denied" | "Escalated";
  decidingStep?: number;
  reason?: string;
  approvedDays?: number;
  receivedAt: Date;
  decisionDueAt: Date;
  decidedAt: Date | null;
  effectiveDate: Date | null;
  terminationDate: Date | null;
  path: { step: number; answer: boolean; evidence: string }[];
  /** Set when this is a second attempt, naming what the prescriber supplied. */
  resubmissionOf?: string;
  /** Set when this request continues therapy an earlier approval started. */
  renewal?: boolean;
  /**
   * Set when the reviewer had to stop and ask the prescriber for something.
   * While the clock sits inside that window the request shows as pended rather
   * than in review, which is the distinction a plan sponsor asks about when
   * turnaround times slip.
   */
  pendedForInformation?: boolean;
}

/**
 * Answers a prescriber can supply on a second attempt.
 *
 * A denial for a missing attachment is not a clinical decision, and in
 * practice the prescriber sends the attachment and the request is decided
 * again. Only the fields that represent documentation are listed: a member who
 * has not tried methotrexate does not acquire a trial by resubmitting.
 */
const CURABLE_BY_RESUBMISSION: Record<string, string> = {
  quantityDosingProvided: "requested quantity and dosing",
  diagnosisProvided: "the primary diagnosis with ICD-10 code",
  contraindicationsListed: "the list of contraindications",
};

/**
 * Draw fact patterns so the realised mix matches the intended weights.
 *
 * Only about thirty members a year start a biologic governed by one of the
 * transcribed forms, and independent draws at that sample size routinely miss
 * a fourteen percent branch entirely. That would show up on the proof page as
 * an untested branch, which would be a fact about the random seed rather than
 * about the criteria. Choosing the pattern that is furthest behind its share
 * keeps the distribution honest and stays deterministic.
 */
function createPatternCursor() {
  const drawn = new Map<string, number[]>();
  return function draw(treeId: string, patterns: FactPattern[]): FactPattern {
    const counts = drawn.get(treeId) ?? patterns.map(() => 0);
    // The pattern with the lowest draws-per-unit-of-weight is the one owed a
    // turn.
    let best = 0;
    for (let i = 1; i < patterns.length; i++) {
      if (counts[i] / patterns[i].weight < counts[best] / patterns[best].weight)
        best = i;
    }
    counts[best] += 1;
    drawn.set(treeId, counts);
    return patterns[best];
  };
}

export type PriorAuthDecider = (c: PACandidate) => DecidedPA[];

/**
 * Build the decider for one seeding run. Each request is put through the same
 * criteria engine the demo uses, and the resubmission a paperwork denial
 * prompts is decided too.
 */
export function createPriorAuthDecider(rng: Rng): PriorAuthDecider {
  const draw = createPatternCursor();
  return (c) => decidePriorAuth(c, rng, draw);
}

function decidePriorAuth(
  c: PACandidate,
  rng: Rng,
  draw: (treeId: string, patterns: FactPattern[]) => FactPattern,
): DecidedPA[] {
  const tree = findTreeForDrug(c.drugName);
  if (!tree) return [];
  const patterns = PATTERNS[tree.id];
  if (!patterns) return [];

  const partial = draw(tree.id, patterns).build(c);
  const prescriber =
    PRESCRIBERS.find((p) => p.specialty === partial.prescriberSpecialty) ??
    rng.pick(PRESCRIBERS);

  const facts: PAFacts = {
    condition: partial.condition,
    answers: partial.answers ?? {},
    prescriberSpecialty: partial.prescriberSpecialty,
    memberDiagnosisCodes: c.diagnosisCodes,
    memberAgeYears: c.ageYears,
    memberWeightKg: c.weightKg,
    filledDrugNames: c.filledDrugNames,
  };

  // A request is submitted before the drug is needed, not on the day of.
  const receivedAt = new Date(
    c.firstFillDate.getTime() - rng.int(6, 24) * 86_400_000,
  );
  const urgency: "Standard" | "Expedited" = rng.bool(0.12)
    ? "Expedited"
    : "Standard";

  const first = decideOnce(c, tree, facts, prescriber, urgency, receivedAt, rng);
  const results = [first];

  // Which documentation field, if any, is the one that sank this request.
  const missing =
    first.outcome === "Denied"
      ? Object.keys(CURABLE_BY_RESUBMISSION).find(
          (f) => facts.answers[f] === false,
        )
      : undefined;

  if (missing && rng.bool(0.7)) {
    const cured: PAFacts = {
      ...facts,
      answers: { ...facts.answers, [missing]: true },
    };
    const resubmittedAt = new Date(
      first.decidedAt!.getTime() + rng.int(1, 6) * 86_400_000,
    );
    const second = decideOnce(
      c,
      tree,
      cured,
      prescriber,
      urgency,
      resubmittedAt,
      rng,
    );
    second.resubmissionOf = CURABLE_BY_RESUBMISSION[missing];
    results.push(second);
  }

  /*
   * An approval runs for a fixed term, and Skyrizi's is four months, so a
   * member who stays on therapy files again before it lapses. Each renewal is
   * a fresh request against the same criteria, and the prescriber's answers
   * are drawn again, because the second submission is not guaranteed to be as
   * complete as the first.
   */
  let latest = results[results.length - 1];
  while (
    latest.outcome === "Approved" &&
    latest.terminationDate! < c.planYearEnd
  ) {
    const renewalReceived = new Date(
      latest.terminationDate!.getTime() - rng.int(7, 21) * 86_400_000,
    );
    if (renewalReceived >= c.planYearEnd) break;

    const renewalPartial = draw(tree.id, patterns).build(c);
    const renewalFacts: PAFacts = {
      ...facts,
      condition: renewalPartial.condition,
      answers: renewalPartial.answers ?? {},
      prescriberSpecialty: renewalPartial.prescriberSpecialty,
    };
    const renewal = decideOnce(
      c,
      tree,
      renewalFacts,
      PRESCRIBERS.find(
        (p) => p.specialty === renewalPartial.prescriberSpecialty,
      ) ?? prescriber,
      "Standard",
      renewalReceived,
      rng,
    );
    renewal.renewal = true;
    results.push(renewal);
    latest = renewal;
  }

  return results;
}

/**
 * Reasons a pharmacist turns down a request that has no transcribed form.
 *
 * These are review outcomes, not traversals, and the queue shows them as such.
 */
const MANUAL_DENIAL_REASONS = [
  "Submitted documentation does not establish the diagnosis the product is indicated for.",
  "No record of a trial of a formulary alternative, and no contraindication was documented.",
  "Requested quantity exceeds the labelled maximum dose and no supporting rationale was supplied.",
  "Request is for a cosmetic indication, which the plan excludes.",
  "Prescriber did not respond to the request for additional clinical information.",
];

/**
 * Decide a request for a product whose criteria form has not been transcribed.
 *
 * Most of the formulary's prior authorization requirements point at forms this
 * project has not encoded. Pretending those requests do not exist would make
 * the queue a small fraction of its real size and would make the engine look
 * more complete than it is. They are generated, routed to a pharmacist, and
 * marked as carrying no traversal, so the share of decisions the engine can
 * actually justify from a published document stays visible and honest.
 */
export function decideWithoutCriteria(
  c: PACandidate,
  rng: Rng,
  receivedAt: Date,
): DecidedPA[] {
  const results = [decideManuallyOnce(c, rng, receivedAt)];

  /*
   * An approval runs for a fixed term, and a member who stays on therapy has
   * to be reauthorized before it lapses. This is the same chaining the
   * criteria path does, and it is a large part of why a real prior
   * authorization queue is never empty: the requests filed in January come
   * back around when their terms run out.
   */
  let latest = results[results.length - 1];
  while (latest.outcome === "Approved" && latest.terminationDate! < c.planYearEnd) {
    const renewalReceived = new Date(
      latest.terminationDate!.getTime() - rng.int(7, 21) * 86_400_000,
    );
    if (renewalReceived >= c.planYearEnd) break;

    const renewal = decideManuallyOnce(c, rng, renewalReceived);
    renewal.renewal = true;
    results.push(renewal);
    latest = renewal;
  }

  return results;
}

function decideManuallyOnce(
  c: PACandidate,
  rng: Rng,
  receivedAt: Date,
): DecidedPA {
  const urgency: "Standard" | "Expedited" = rng.bool(0.1)
    ? "Expedited"
    : "Standard";
  // The contract's 72 hours, not ERISA's fifteen days: the queue is held to the
  // deadline the plan actually bought, which is the earlier of the two.
  const sla = paDeadlines(receivedAt, urgency, "Commercial").binding;
  const prescriber = rng.pick(PRESCRIBERS);

  /*
   * A human reads the chart, which takes longer than reading a decision tree,
   * and some requests wait on the prescriber before anyone can read anything.
   * Both still land inside the turnaround standard the harness holds this
   * queue to: 72 hours standard, 24 expedited. Going to the prescriber for
   * more information does not stop that clock, so a request that has to wait
   * is slower but not late.
   */
  const waitsOnPrescriber = rng.bool(0.22);
  const hours = waitsOnPrescriber
    ? rng.int(urgency === "Expedited" ? 13 : 34, urgency === "Expedited" ? 22 : 68)
    : rng.int(3, urgency === "Expedited" ? 12 : 40);
  const decidedAt = new Date(receivedAt.getTime() + hours * 3_600_000);

  const approved = rng.bool(0.76);
  // Quarterly, semi-annual and annual terms, which is the spread the plan's
  // own criteria documents use for products of this kind.
  const approvedDays = rng.pick([90, 180, 365]);

  return {
    memberId: c.memberId,
    drugId: c.drugId,
    treeId: null,
    urgency,
    prescriberName: prescriber.name,
    prescriberSpecialty: prescriber.specialty,
    answers: {},
    outcome: approved ? "Approved" : "Denied",
    reason: approved ? undefined : rng.pick(MANUAL_DENIAL_REASONS),
    approvedDays: approved ? approvedDays : undefined,
    receivedAt,
    decisionDueAt: sla.dueAt,
    decidedAt,
    effectiveDate: approved ? decidedAt : null,
    terminationDate: approved
      ? new Date(decidedAt.getTime() + approvedDays * 86_400_000)
      : null,
    path: [],
    pendedForInformation: waitsOnPrescriber,
  };
}

function decideOnce(
  c: PACandidate,
  tree: CriteriaTreeDef,
  facts: PAFacts,
  prescriber: { name: string; specialty: string },
  urgency: "Standard" | "Expedited",
  receivedAt: Date,
  rng: Rng,
): DecidedPA {
  const determination = determinePA(tree, facts);
  const sla = paDeadlines(receivedAt, urgency, "Commercial").binding;
  // Decisions land well inside the regulatory window, which is the point of
  // automating the traversal in the first place.
  const decidedAt = new Date(
    receivedAt.getTime() +
      rng.int(2, urgency === "Expedited" ? 20 : 60) * 3_600_000,
  );

  const approved = determination.outcome === "Approved";
  const escalated = determination.outcome === "Escalated";
  const approvedDays = determination.approvedDays ?? tree.defaultApprovalDays;

  return {
    memberId: c.memberId,
    drugId: c.drugId,
    treeId: tree.id,
    urgency,
    prescriberName: prescriber.name,
    prescriberSpecialty: prescriber.specialty,
    answers: facts.answers,
    outcome: determination.outcome,
    decidingStep: determination.decidingStep,
    reason: determination.reason,
    approvedDays: approved ? approvedDays : undefined,
    receivedAt,
    decisionDueAt: sla.dueAt,
    decidedAt: escalated ? null : decidedAt,
    effectiveDate: approved ? decidedAt : null,
    terminationDate: approved
      ? new Date(decidedAt.getTime() + approvedDays * 86_400_000)
      : null,
    path: determination.path.map((p) => ({
      step: p.step,
      answer: p.answer,
      evidence: p.evidence,
    })),
  };
}

/** Write the decided requests and their traversals. */
export async function persistPriorAuths(
  prisma: PrismaClient,
  decided: DecidedPA[],
  startingNumber: number,
): Promise<void> {
  const stepRows = await prisma.criteriaStep.findMany({
    select: { id: true, treeId: true, stepNumber: true },
  });
  const stepIds = new Map(
    stepRows.map((r) => [`${r.treeId}|${r.stepNumber}`, r.id]),
  );

  // Written in bulk rather than row by row. At this volume the awaited
  // per-row create is the slowest thing in the seed by an order of magnitude.
  let seq = startingNumber;
  const paRows: Prisma.PriorAuthorizationCreateManyInput[] = [];
  const stepRowsToWrite: Prisma.PADecisionStepCreateManyInput[] = [];

  for (const d of decided) {
    const approved = d.outcome === "Approved";
    const denied = d.outcome === "Denied";
    const viaCriteria = d.treeId !== null;
    const id = `pa-${seq}`;

    paRows.push({
      id,
      paNumber: `PA${String(seq).padStart(10, "0")}`,
      memberId: d.memberId,
      drugId: d.drugId,
      treeId: d.treeId,
      requestType: d.renewal ? "Reauthorization" : "PA",
      urgency: d.urgency,
      prescriberName: d.prescriberName,
      prescriberNpi: String(1_500_000_000 + (seq % 400_000_000)),
      requestedQuantity: 2,
      requestedDaysSupply: 28,
      questionResponses: JSON.stringify(d.answers),
      status: d.outcome === "Escalated" ? "InReview" : d.outcome,
      determination: d.outcome === "Escalated" ? null : d.outcome,
      decidingStepNumber: d.decidingStep ?? null,
      denyReason: d.reason ?? null,
      approvedDays: d.approvedDays ?? null,
      approvedEffectiveDate: d.effectiveDate,
      approvedTerminationDate: d.terminationDate,
      receivedAt: d.receivedAt,
      prescriberStatementAt: d.pendedForInformation
        ? new Date(d.receivedAt.getTime() + 24 * 3_600_000)
        : null,
      decisionDueAt: d.decisionDueAt,
      decidedAt: d.decidedAt,
      /*
       * Automation may confirm that published criteria are met, because that
       * is a reading of a document. It may not issue an adverse
       * determination: a denial carries appeal rights, so a pharmacist signs
       * it after reviewing the same traversal. A request with no transcribed
       * form is a pharmacist's from the start.
       */
      decidedBy: !viaCriteria
        ? "Pharmacist"
        : approved
          ? "AI"
          : denied
            ? "Pharmacist"
            : null,
      escalated: !viaCriteria || !approved,
      reviewerNote: !viaCriteria
        ? approved
          ? "No criteria form for this product has been transcribed into the engine, so the request was reviewed by a pharmacist against the plan document rather than by walking a published decision tree. This decision carries no step citation."
          : "Reviewed by a pharmacist. No criteria form for this product has been transcribed into the engine, so there is no step citation behind this determination."
        : denied
          ? `Criteria not met at step ${d.decidingStep}. A pharmacist reviewed the traversal and the submitted documentation before the determination was released.`
          : d.outcome === "Escalated"
            ? "Routed to a pharmacist for manual review."
            : d.resubmissionOf
              ? `Resubmitted after the prescriber supplied ${d.resubmissionOf}, which the earlier request was missing.`
              : d.renewal
                ? "Reauthorization filed before the prior approval lapsed. Criteria were walked again rather than the earlier decision being carried forward."
                : null,
    });

    for (const [i, step] of d.path.entries()) {
      const criteriaStepId = stepIds.get(`${d.treeId}|${step.step}`);
      if (!criteriaStepId) continue;
      stepRowsToWrite.push({
        paId: id,
        criteriaStepId,
        seq: i,
        answer: step.answer,
        evidence: step.evidence,
      });
    }
    seq++;
  }

  for (let i = 0; i < paRows.length; i += 500) {
    await prisma.priorAuthorization.createMany({
      data: paRows.slice(i, i + 500),
    });
  }
  for (let i = 0; i < stepRowsToWrite.length; i += 500) {
    await prisma.pADecisionStep.createMany({
      data: stepRowsToWrite.slice(i, i + 500),
    });
  }
}