/**
 * The prior authorization criteria engine.
 *
 * Walks a published decision tree and records the path taken. The output is
 * not "approved" or "denied" but a numbered traversal that can be laid
 * alongside the PDF: step 4 chose this option, step 7 evaluated false because
 * the claims history contains no methotrexate, step 8 was answered no,
 * therefore deny at step 8.
 *
 * Determinations are only as good as the criteria, and the criteria only cover
 * what has been transcribed. When no tree exists for a drug, the engine
 * escalates to a human rather than guessing. That behaviour is tested.
 */

import type { CriteriaStepDef, CriteriaTreeDef, PredicateId } from "./criteria";

export interface PAFacts {
  /** Which branch the prescriber selected at a "what condition" step. */
  condition?: string;
  /** Free-form answers from the questionnaire, keyed by field name. */
  answers: Record<string, unknown>;
  prescriberSpecialty?: string;
  memberDiagnosisCodes: string[];
  memberAgeYears?: number;
  memberWeightKg?: number;
  /** Drug names the member has actually filled, from claims history. */
  filledDrugNames: string[];
}

export interface PATraversalStep {
  step: number;
  question: string;
  answer: boolean;
  evidence: string;
  citation: string;
  next: "step" | "approve" | "deny";
  nextStep?: number;
}

export interface PADetermination {
  outcome: "Approved" | "Denied" | "Escalated";
  decidingStep?: number;
  approvedDays?: number;
  reason?: string;
  path: PATraversalStep[];
  treeId?: string;
}

function evaluatePredicate(
  predicate: PredicateId,
  args: Record<string, unknown>,
  facts: PAFacts,
): { result: boolean; evidence: string } {
  switch (predicate) {
    case "always":
      return { result: true, evidence: "Unconditional step." };

    case "request.conditionIs": {
      const expected = args.condition as string;
      const result = facts.condition === expected;
      return {
        result,
        evidence: result
          ? `Prescriber selected "${expected}".`
          : `Prescriber selected "${facts.condition ?? "nothing"}", not "${expected}".`,
      };
    }

    case "request.answerYes": {
      const field = args.field as string;
      const value = facts.answers[field];
      const result = value === true || value === "yes" || value === "Yes";
      return {
        result,
        evidence: result
          ? `Question "${field}" was answered yes.`
          : `Question "${field}" was not answered yes (received ${JSON.stringify(value ?? null)}).`,
      };
    }

    case "request.selectedAny": {
      const field = args.field as string;
      const options = (args.options as string[]) ?? [];
      const value = facts.answers[field];
      const selected = Array.isArray(value) ? value : value ? [value] : [];
      const hits = selected.filter((s) => options.includes(String(s)));
      return {
        result: hits.length > 0,
        evidence:
          hits.length > 0
            ? `Selected: ${hits.join(", ")}.`
            : "None of the listed options were selected.",
      };
    }

    case "prescriber.specialtyIs": {
      const specialties = (args.specialties as string[]) ?? [];
      const result = specialties.includes(facts.prescriberSpecialty ?? "");
      return {
        result,
        evidence: result
          ? `Prescriber specialty is ${facts.prescriberSpecialty}.`
          : `Prescriber specialty is ${facts.prescriberSpecialty ?? "not recorded"}, and this step requires ${specialties.join(" or ")}.`,
      };
    }

    case "member.hasDiagnosis": {
      const codes = (args.codes as string[]) ?? [];
      const matched = codes.filter((c) =>
        facts.memberDiagnosisCodes.some((held) => held.startsWith(c)),
      );
      return {
        result: matched.length > 0,
        evidence:
          matched.length > 0
            ? `Member has qualifying diagnosis ${matched.join(", ")}.`
            : `Member diagnoses on file are ${facts.memberDiagnosisCodes.join(", ") || "none"}, none of which match ${codes.join(", ")}.`,
      };
    }

    case "member.hasTrialOf": {
      const patterns = (args.drugPatterns as string[]) ?? [];
      const alsoAccept = args.alsoAcceptAnswer as string | undefined;
      /*
       * Ingredient substrings alone are not enough. Dupixent step 6 asks for a
       * *topical* corticosteroid / calcineurin inhibitor; a nasal mometasone or
       * oral tacrolimus share the ingredient token and used to satisfy the
       * step, minting a 365-day specialty Approve the published form does not
       * allow. Optional form tokens narrow (or exclude) the product shape.
       */
      const requireFormTokens = ((args.requireFormTokens as string[]) ?? []).map(
        (t) => t.toUpperCase(),
      );
      const excludeFormTokens = ((args.excludeFormTokens as string[]) ?? []).map(
        (t) => t.toUpperCase(),
      );
      const nameMatchesTrial = (name: string, pattern: string): boolean => {
        const upper = name.toUpperCase();
        if (!upper.includes(pattern.toUpperCase())) return false;
        if (
          requireFormTokens.length > 0 &&
          !requireFormTokens.some((t) => upper.includes(t))
        ) {
          return false;
        }
        if (excludeFormTokens.some((t) => upper.includes(t))) return false;
        return true;
      };
      const matched = patterns.filter((p) =>
        facts.filledDrugNames.some((n) => nameMatchesTrial(n, p)),
      );
      if (matched.length > 0) {
        return {
          result: true,
          evidence: `Claims history shows a fill of ${matched.join(", ")}.`,
        };
      }
      if (alsoAccept && facts.answers[alsoAccept] === true) {
        return {
          result: true,
          evidence: `Prescriber attested to the trial requirement via "${alsoAccept}", with documentation submitted.`,
        };
      }
      return {
        result: false,
        evidence: `No claim found for any of ${patterns.join(", ")}, and no prescriber attestation was provided.`,
      };
    }

    case "member.ageBetween": {
      const min = args.min as number;
      const max = args.max as number;
      const age = facts.memberAgeYears ?? -1;
      const result = age >= min && age <= max;
      return {
        result,
        evidence: `Member age is ${age >= 0 ? age : "unknown"}; step requires ${min} to ${max}.`,
      };
    }

    case "member.weightBelowKg": {
      const kg = args.kg as number;
      const weight = facts.memberWeightKg;
      const result = weight != null && weight < kg;
      return {
        result,
        evidence: `Member weight is ${weight ?? "unknown"} kg; step requires less than ${kg} kg.`,
      };
    }

    default:
      return { result: false, evidence: `Unknown predicate ${predicate}.` };
  }
}

const MAX_STEPS = 60;

export function determinePA(
  tree: CriteriaTreeDef,
  facts: PAFacts,
): PADetermination {
  const byStep = new Map<number, CriteriaStepDef>(
    tree.steps.map((s) => [s.step, s]),
  );
  const path: PATraversalStep[] = [];

  let current = tree.startStep;
  for (let guard = 0; guard < MAX_STEPS; guard++) {
    const step = byStep.get(current);
    if (!step) {
      // The tree references a step we have not transcribed. Escalate rather
      // than guess: an untranscribed branch is unknown, not false.
      return {
        outcome: "Escalated",
        decidingStep: current,
        reason: `Criteria step ${current} is referenced by the published form but is not encoded in this system. Routed to a pharmacist for manual review.`,
        path,
        treeId: tree.id,
      };
    }

    const { result, evidence } = evaluatePredicate(
      step.predicate,
      step.args ?? {},
      facts,
    );
    const branch = result ? step.yes : step.no;

    path.push({
      step: step.step,
      question: step.question,
      answer: result,
      evidence,
      citation: step.citation,
      next: branch.outcome,
      nextStep: branch.step,
    });

    if (branch.outcome === "approve") {
      return {
        outcome: "Approved",
        decidingStep: step.step,
        approvedDays: branch.days ?? tree.defaultApprovalDays,
        path,
        treeId: tree.id,
      };
    }
    if (branch.outcome === "deny") {
      return {
        outcome: "Denied",
        decidingStep: step.step,
        reason: branch.reason ?? "Criteria not met.",
        path,
        treeId: tree.id,
      };
    }
    if (branch.step == null) {
      return {
        outcome: "Escalated",
        decidingStep: step.step,
        reason: "Criteria tree has no next step defined.",
        path,
        treeId: tree.id,
      };
    }
    current = branch.step;
  }

  return {
    outcome: "Escalated",
    reason: "Criteria traversal exceeded the maximum step count.",
    path,
    treeId: tree.id,
  };
}

/**
 * Regulatory decision deadlines.
 *
 * The rule worth encoding, because it is the one plans get wrong: under
 * Medicare Part D a missed deadline is not a delay, it is an adverse
 * determination that must be auto-forwarded to the independent review entity.
 */
export interface SlaClock {
  dueAt: Date;
  hours: number;
  authority: string;
  citation: string;
  /** What happens if the clock runs out. */
  onExpiry: string;
  /** The moment the clock started, which is not always when the request arrived. */
  startedAt: Date;
  /** Set when the clock is waiting on the prescriber before it can start. */
  awaitingSupportingStatement?: boolean;
}

/**
 * The request types that need a prescriber's supporting statement.
 *
 * An exception asks the plan to depart from its own formulary, so it turns on a
 * clinical assertion only the prescriber can make. The regulation reflects that:
 * the clock does not begin when the member asks, it begins when the supporting
 * statement arrives.
 */
const EXCEPTION_TYPES = new Set([
  "FormularyException",
  "StepException",
  "QuantityException",
  "TieringException",
]);

export function isExceptionRequest(requestType: string | null | undefined): boolean {
  return EXCEPTION_TYPES.has(requestType ?? "");
}

export function computeSla(
  receivedAt: Date,
  urgency: "Standard" | "Expedited",
  lineOfBusiness: "Commercial" | "EGWP",
  opts: {
    requestType?: string | null;
    /** When the prescriber's supporting statement was received, if it has been. */
    supportingStatementAt?: Date | null;
  } = {},
): SlaClock {
  /*
   * Where the clock starts.
   *
   * For an ordinary authorization it starts on receipt. For an exception it
   * starts when the prescriber's supporting statement arrives, because the plan
   * cannot decide whether to depart from its formulary until the prescriber has
   * said why it should. Getting this wrong in either direction is a real
   * failure: measure from receipt and the plan reports itself late on requests
   * it could not lawfully have decided yet; measure from the statement on a
   * request that needs none and every deadline silently disappears.
   */
  const needsStatement = isExceptionRequest(opts.requestType);
  const awaiting = needsStatement && !opts.supportingStatementAt;
  const startedAt = needsStatement
    ? (opts.supportingStatementAt ?? receivedAt)
    : receivedAt;

  if (lineOfBusiness === "EGWP") {
    const hours = urgency === "Expedited" ? 24 : 72;
    return {
      dueAt: new Date(startedAt.getTime() + hours * 3_600_000),
      hours,
      startedAt,
      awaitingSupportingStatement: awaiting || undefined,
      authority:
        urgency === "Expedited" ? "42 CFR 423.572" : "42 CFR 423.568",
      citation: needsStatement
        ? urgency === "Expedited"
          ? "42 CFR 423.572(a): expedited exception decided within 24 hours of receiving the prescriber's supporting statement."
          : "42 CFR 423.568(b): exception decided within 72 hours of receiving the prescriber's supporting statement."
        : urgency === "Expedited"
          ? "42 CFR 423.572: expedited coverage determination within 24 hours."
          : "42 CFR 423.568: standard coverage determination within 72 hours.",
      onExpiry:
        "A missed deadline is an adverse determination. The request must be auto-forwarded to the independent review entity within 24 hours.",
    };
  }

  const hours = urgency === "Expedited" ? 72 : 15 * 24;
  return {
    dueAt: new Date(startedAt.getTime() + hours * 3_600_000),
    hours,
    startedAt,
    awaitingSupportingStatement: awaiting || undefined,
    authority: "29 CFR 2560.503-1",
    citation:
      urgency === "Expedited"
        ? "29 CFR 2560.503-1(f)(2)(i): urgent care claims decided within 72 hours."
        : "29 CFR 2560.503-1(f)(2)(iii): pre-service claims decided within 15 days, with one 15-day extension available.",
    onExpiry:
      "The claimant is deemed to have exhausted internal appeals and may proceed to external review.",
  };
}

/**
 * The deadline the plan bought, which is shorter than the one the law sets.
 *
 * The performance guarantee schedule promises 24 hours on an expedited request
 * and 72 on a standard one. ERISA allows 72 hours and fifteen days for the same
 * two cases, so on a commercial request the contract is the binding number by a
 * wide margin — twelve days wide on a standard request.
 *
 * Both are computed and both are shown, because they fail differently. Missing
 * the contract deadline costs money out of the amount at risk. Missing the
 * regulatory one gives the member the right to walk out of the process
 * entirely. A queue that only tracks the second one looks healthy while owing
 * credits, and one that only tracks the first has no idea when a member's
 * appeal rights vest.
 */
export function contractualSla(
  receivedAt: Date,
  urgency: "Standard" | "Expedited",
  opts: {
    requestType?: string | null;
    supportingStatementAt?: Date | null;
  } = {},
): SlaClock {
  const needsStatement = isExceptionRequest(opts.requestType);
  const awaiting = needsStatement && !opts.supportingStatementAt;
  const startedAt = needsStatement
    ? (opts.supportingStatementAt ?? receivedAt)
    : receivedAt;

  const hours = urgency === "Expedited" ? 24 : 72;
  return {
    dueAt: new Date(startedAt.getTime() + hours * 3_600_000),
    hours,
    startedAt,
    awaitingSupportingStatement: awaiting || undefined,
    authority: "Performance guarantee schedule",
    citation:
      urgency === "Expedited"
        ? "Ninety-nine percent of expedited prior authorisation requests decided within 24 hours of receipt."
        : "Ninety-eight percent of standard prior authorisation requests decided within 72 hours of receipt of a clean request.",
    onExpiry:
      "A miss counts against the guarantee and draws on the amount at risk. It does not by itself decide the request.",
  };
}

export interface PaDeadlines {
  /** What the regulation allows. */
  regulatory: SlaClock;
  /** What the contract promised. */
  contractual: SlaClock;
  /** Whichever falls first, which is the one the queue is measured against. */
  binding: SlaClock;
  /** Which of the two binds, for labelling. */
  bindingSource: "regulatory" | "contractual";
}

export function paDeadlines(
  receivedAt: Date,
  urgency: "Standard" | "Expedited",
  lineOfBusiness: "Commercial" | "EGWP",
  opts: {
    requestType?: string | null;
    supportingStatementAt?: Date | null;
  } = {},
): PaDeadlines {
  const regulatory = computeSla(receivedAt, urgency, lineOfBusiness, opts);
  const contractual = contractualSla(receivedAt, urgency, opts);
  const contractBinds = contractual.dueAt <= regulatory.dueAt;
  return {
    regulatory,
    contractual,
    binding: contractBinds ? contractual : regulatory,
    bindingSource: contractBinds ? "contractual" : "regulatory",
  };
}
