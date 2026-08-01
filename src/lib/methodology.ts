/**
 * Plain-language description of the adjudication pipeline, for the
 * methodology page.
 *
 * Kept beside the engine rather than inline in the page so the order here can
 * be checked against `STAGE_ORDER` in the trace viewer and against the order
 * the stages actually run in `adjudicate.ts`.
 */
export interface PipelineStageDoc {
  id: string;
  label: string;
  decides: string;
  /** The document this stage's rules were read out of. */
  source: string;
}

export const PIPELINE_STAGES: PipelineStageDoc[] = [
  {
    id: "eligibility",
    label: "Eligibility",
    decides:
      "Whether the person was covered under this plan on the fill date, and whether the pharmacy is in the network the plan bought.",
    source: "Enrollment spans, network roster",
  },
  {
    id: "coverage",
    label: "Coverage",
    decides:
      "Whether the drug is on the formulary at all, whether the plan excludes it, and which benefit level it sits at. Also fixes the pricing channel from the days supply and pharmacy type, and whether the fill prices as brand or generic.",
    source: "Navitus formulary 2026, Exhibit C",
  },
  {
    id: "um",
    label: "Utilization management",
    decides:
      "Quantity limits, diagnosis restrictions, refill-too-soon, the specialty pharmacy requirement, step therapy, and whether an approved prior authorization covers the date of service. This is the stage that produces most rejections.",
    source: "Formulary flags, criteria forms",
  },
  {
    id: "pricing",
    label: "Pricing",
    decides:
      "Every applicable arm of the lesser-of calculation, which one won, and what the pharmacy is owed including the dispensing fee. For the comparison against a traditional contract, it also prices what a spread PBM would have billed the plan for the same fill.",
    source: "Exhibit C, NADAC, simulated AWP",
  },
  {
    id: "costshare",
    label: "Member cost share",
    decides:
      "The copay or coinsurance, any deductible applied first, the brand selection penalty where the member chose a brand over an available generic, and which accumulators the payment counts toward.",
    source: "Uniform Pharmacy Benefits certificate",
  },
  {
    id: "rebate",
    label: "Rebate",
    decides:
      "Whether the claim earns a manufacturer rebate under the contract's guarantee, whether any exclusion applies, and how much passes through to the plan after the administration fee.",
    source: "Exhibit C, Amendments 5A and 7",
  },
];
