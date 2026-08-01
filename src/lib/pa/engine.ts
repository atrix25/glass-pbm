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
      const matched = patterns.filter((p) =>
        facts.filledDrugNames.some((n) =>
          n.toUpperCase().includes(p.toUpperCase()),
        ),
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
}

export function computeSla(
  receivedAt: Date,
  urgency: "Standard" | "Expedited",
  lineOfBusiness: "Commercial" | "EGWP",
): SlaClock {
  if (lineOfBusiness === "EGWP") {
    const hours = urgency === "Expedited" ? 24 : 72;
    return {
      dueAt: new Date(receivedAt.getTime() + hours * 3_600_000),
      hours,
      authority:
        urgency === "Expedited" ? "42 CFR 423.572" : "42 CFR 423.568",
      citation:
        urgency === "Expedited"
          ? "42 CFR 423.572: expedited coverage determination within 24 hours."
          : "42 CFR 423.568: standard coverage determination within 72 hours.",
      onExpiry:
        "A missed deadline is an adverse determination. The request must be auto-forwarded to the independent review entity within 24 hours.",
    };
  }

  const hours = urgency === "Expedited" ? 72 : 15 * 24;
  return {
    dueAt: new Date(receivedAt.getTime() + hours * 3_600_000),
    hours,
    authority: "29 CFR 2560.503-1",
    citation:
      urgency === "Expedited"
        ? "29 CFR 2560.503-1(f)(2)(i): urgent care claims decided within 72 hours."
        : "29 CFR 2560.503-1(f)(2)(iii): pre-service claims decided within 15 days, with one 15-day extension available.",
    onExpiry:
      "The claimant is deemed to have exhausted internal appeals and may proceed to external review.",
  };
}
