/**
 * Who is allowed to record what on a prior authorization.
 *
 * The rule this system commits to is asymmetric on purpose: automation may
 * approve, and only a person may refuse. The asymmetry is the whole point. An
 * approval reached by walking published criteria is checkable — it names the step
 * that produced it, and if the traversal is wrong the member got a medicine they
 * were entitled to anyway. A refusal is a clinical judgment with a consequence
 * for someone's treatment, and it needs a named licensed reviewer who can be
 * asked why.
 *
 * Stating that in a paragraph on a page is worth very little, because a paragraph
 * cannot stop a write. So the rule lives here as a pure function, every path that
 * records a determination has to pass through it, and `tests/pa-review.test.ts`
 * checks the function rather than the prose.
 */

export type Reviewer =
  | { kind: "automation"; label: string }
  | { kind: "pharmacist"; label: string; licence: string };

export type ReviewAction =
  | { record: "Approved"; approvedDays: number; decidingStep?: number | null }
  | { record: "Denied"; reason: string; decidingStep?: number | null }
  | { record: "Escalated"; reason: string };

export interface ReviewDecision {
  allowed: boolean;
  /** Why not, in words a reviewer would accept. */
  refusal?: string;
  /** What to store in `decidedBy`. */
  decidedBy?: string;
  requiresSignature: boolean;
}

export function reviewerLabel(reviewer: Reviewer): string {
  return reviewer.kind === "pharmacist"
    ? `${reviewer.label} (${reviewer.licence})`
    : reviewer.label;
}

/**
 * Whether this reviewer may record this action.
 *
 * Escalation is always allowed from either side: handing a request to a human is
 * never the unsafe direction, and blocking it would leave automation with
 * nowhere to put a case it cannot resolve except a determination.
 */
export function mayRecord(
  reviewer: Reviewer,
  action: ReviewAction,
): ReviewDecision {
  if (action.record === "Escalated") {
    return { allowed: true, requiresSignature: false };
  }

  if (action.record === "Denied" && reviewer.kind === "automation") {
    return {
      allowed: false,
      requiresSignature: true,
      refusal:
        "Automation may not refuse a prior authorization. The traversal reached a deny edge, which is recorded as a recommendation for a pharmacist to sign or overturn; it is not a determination until a licensed reviewer has signed it.",
    };
  }

  if (action.record === "Approved") {
    // Both may approve. An automated approval still has to be traceable to the
    // step that produced it, because an approval nobody can locate in the
    // criteria is indistinguishable from an approval nobody applied criteria to.
    if (reviewer.kind === "automation" && action.decidingStep == null) {
      return {
        allowed: false,
        requiresSignature: false,
        refusal:
          "An automated approval must name the criteria step that produced it. Without a deciding step there is nothing to audit it against.",
      };
    }
    return {
      allowed: true,
      decidedBy: reviewerLabel(reviewer),
      requiresSignature: false,
    };
  }

  return {
    allowed: true,
    decidedBy: reviewerLabel(reviewer),
    requiresSignature: false,
  };
}

/**
 * What automation should do with a traversal it has just completed.
 *
 * Separated from `mayRecord` because they answer different questions: this one
 * is about what the engine proposes, and that one is about whether the proposal
 * may be written. Keeping them apart is what stops "the engine decided to deny"
 * from quietly becoming "the plan denied".
 */
export function dispositionFor(outcome: string): {
  action: "record" | "propose" | "escalate";
  note: string;
} {
  switch (outcome) {
    case "Approved":
      return {
        action: "record",
        note: "The traversal reached an approve edge. Recorded, citing the step.",
      };
    case "Denied":
      return {
        action: "propose",
        note: "The traversal reached a deny edge. Held as a recommendation for a pharmacist, who may sign it or overturn it.",
      };
    default:
      return {
        action: "escalate",
        note: "The criteria do not resolve on the facts available. Routed to a pharmacist rather than guessed.",
      };
  }
}

// ---------------------------------------------------------------------------
// Exceptions and appeals
// ---------------------------------------------------------------------------

export type ExceptionKind =
  | "FormularyException"
  | "StepException"
  | "QuantityException"
  | "TieringException"
  | "Appeal"
  | "Grievance";

export interface ExceptionKindInfo {
  kind: ExceptionKind;
  label: string;
  /** What the member or prescriber is actually asking for. */
  asks: string;
  /** Whether a prescriber's supporting statement is required to start the clock. */
  needsSupportingStatement: boolean;
  citation: string;
}

export const EXCEPTION_KINDS: ExceptionKindInfo[] = [
  {
    kind: "FormularyException",
    label: "Exception to coverage",
    asks:
      "Cover a drug the formulary excludes, or waive an authorization requirement, because the covered alternatives are unsuitable for this member.",
    needsSupportingStatement: true,
    citation:
      "42 CFR 423.578(b): an exception request requires the prescriber's supporting statement that the preferred drug would not be as effective or would have adverse effects.",
  },
  {
    kind: "StepException",
    label: "Step therapy exception",
    asks:
      "Skip a required trial of a preferred drug, because it has already been tried, is contraindicated, or is expected to fail.",
    needsSupportingStatement: true,
    citation:
      "42 CFR 423.578(b): supporting statement required. Wisconsin's benefit allows the step to be waived on documented contraindication.",
  },
  {
    kind: "QuantityException",
    label: "Quantity limit exception",
    asks:
      "Dispense above the published quantity limit, because the member's dose exceeds it for a documented clinical reason.",
    needsSupportingStatement: true,
    citation:
      "Formulary quantity limits are published with the drug; exceeding one requires clinical justification from the prescriber.",
  },
  {
    kind: "TieringException",
    label: "Tiering exception",
    asks: "Charge a lower level's cost share for a drug placed at a higher level.",
    needsSupportingStatement: true,
    citation:
      "42 CFR 423.578(a): tiering exceptions, where the plan offers them, require a supporting statement.",
  },
  {
    kind: "Appeal",
    label: "Appeal of an adverse determination",
    asks:
      "Overturn a refusal already made. A different reviewer than the one who refused it must decide.",
    needsSupportingStatement: false,
    citation:
      "29 CFR 2560.503-1(h): full and fair review by someone other than the original decision maker, who is not their subordinate.",
  },
  {
    kind: "Grievance",
    label: "Grievance",
    asks:
      "Complain about how the plan behaved rather than about what it decided. Does not change a determination.",
    needsSupportingStatement: false,
    citation:
      "Grievances are handled separately from coverage determinations and do not alter the underlying decision.",
  },
];

export function exceptionKind(kind: string): ExceptionKindInfo | undefined {
  return EXCEPTION_KINDS.find((k) => k.kind === kind);
}

/**
 * Whether an Approved row of this request type may satisfy formulary `requiresPA`.
 *
 * Point-of-sale loads every Approved authorization into a single drug-dated map
 * and asks only whether one covers the fill. That is correct for a prior
 * authorization, a reauthorization, and an appeal that overturns a refusal.
 *
 * It is not correct for step, quantity, or tiering exceptions (those ask for a
 * different edit), for a grievance (not a coverage determination), or for a
 * formulary exception until the engine models that waiver as its own edit —
 * folding any of those into `approvedPAs` is how Approving a StepException or
 * Grievance for Skyrizi paid a specialty fill with no real PA.
 */
const PRIOR_AUTH_COVERAGE_TYPES = new Set([
  "PA",
  "Reauthorization",
  "Appeal",
]);

export function grantsPriorAuthCoverage(
  requestType: string | null | undefined,
): boolean {
  return PRIOR_AUTH_COVERAGE_TYPES.has(requestType ?? "PA");
}

/**
 * Whether an appeal may be filed, and who may decide it.
 *
 * The constraint that matters is the reviewer, not the timing: an appeal decided
 * by the person who made the original refusal is not a review of it.
 */
export function mayAppeal(pa: {
  determination: string | null;
  decidedBy: string | null;
}): { allowed: boolean; reason: string; mustDifferFrom: string | null } {
  if (pa.determination !== "Denied") {
    return {
      allowed: false,
      reason:
        "There is nothing to appeal. An appeal contests a refusal, and this request was not refused.",
      mustDifferFrom: null,
    };
  }
  return {
    allowed: true,
    reason:
      "A refusal may be appealed. The reviewer who decides the appeal must not be the one who made the original determination.",
    mustDifferFrom: pa.decidedBy,
  };
}
