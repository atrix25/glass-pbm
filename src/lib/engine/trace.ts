import type { PipelineStage, TraceStepInput } from "./types";

/**
 * Collects the derivation as the pipeline runs.
 *
 * Every rule that reads a published rate, benefit term, formulary placement,
 * or clinical criterion must pass a sourceDocumentId. The harness asserts that
 * no rule-bearing step is left uncited, which is what stops the audit view
 * from quietly degrading into a summary.
 */
export class TraceBuilder {
  private steps: TraceStepInput[] = [];

  add(step: TraceStepInput): void {
    this.steps.push(step);
  }

  /** Convenience for a rule that read a published source. */
  cited(
    args: Omit<TraceStepInput, "sourceDocumentId" | "citation"> & {
      sourceDocumentId: string;
      citation: string;
    },
  ): void {
    this.steps.push(args);
  }

  /** Convenience for a purely internal computation with no external authority. */
  internal(args: Omit<TraceStepInput, "sourceDocumentId" | "citation">): void {
    this.steps.push(args);
  }

  stage(stage: PipelineStage): TraceStepInput[] {
    return this.steps.filter((s) => s.stage === stage);
  }

  all(): TraceStepInput[] {
    return this.steps;
  }

  get length(): number {
    return this.steps.length;
  }
}

/** Stage display metadata used by the audit view. */
export const STAGE_META: Record<
  PipelineStage,
  { label: string; description: string }
> = {
  eligibility: {
    label: "Eligibility",
    description: "Is this person covered under this plan on the fill date?",
  },
  coverage: {
    label: "Coverage",
    description: "Is this drug on the formulary, and at what level?",
  },
  um: {
    label: "Utilization management",
    description:
      "Quantity limits, diagnosis restrictions, refill timing, prior authorization.",
  },
  pricing: {
    label: "Pricing",
    description:
      "Which pricing arm won the lesser-of, and what did the pharmacy get paid?",
  },
  costshare: {
    label: "Member cost share",
    description:
      "Deductible, copay or coinsurance, and which out-of-pocket limits it counts toward.",
  },
  rebate: {
    label: "Rebate",
    description:
      "Does this claim qualify for a manufacturer rebate, and where does that money go?",
  },
  pa: {
    label: "Prior authorization",
    description: "Traversal of the published clinical criteria.",
  },
};
