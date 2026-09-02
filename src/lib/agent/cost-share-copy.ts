/**
 * Plan-aware cost-share wording for the member agent.
 *
 * The Certificate of Coverage schedules ($5 / 20% / 40% / $50) apply after any
 * deductible. Hardcoding the post-deductible schedule as "what you pay" is
 * correct for IYC (no Rx deductible) and wrong for HDHP (~18% of the book),
 * where an unmet $1,700 integrated deductible can swallow an entire fill.
 */

import { formatCents } from "@/lib/money";

/** Post-deductible retail schedule shared by Wisconsin IYC and HDHP. */
export const LEVEL_COST_SHARE_SCHEDULE: Record<string, string> = {
  "1": "$5 copay",
  "2": "20% coinsurance, $50 maximum per fill",
  "3": "40% coinsurance, $150 maximum per fill",
  "4": "$50 copay, and it must be filled at Lumicera or UW Health Specialty Pharmacy",
  $0: "no cost share, covered in full",
};

export interface PlanCostShareContext {
  /** Individual pharmacy deductible in cents; 0 for IYC. */
  deductibleIndividualCents: number;
  /** Rx OOP limit in cents ($600 IYC / $2,500 HDHP). */
  rxOopLimitIndividualCents: number;
}

/**
 * One-line cost-share description for a formulary level under a member's plan.
 *
 * Preventive ($0) drugs stay free even under an unmet HDHP deductible, matching
 * the engine's Zero cost-share path.
 */
export function describeLevelCostShare(
  level: string,
  plan: PlanCostShareContext | null | undefined,
): string {
  const schedule =
    LEVEL_COST_SHARE_SCHEDULE[level] ?? "see the Certificate of Coverage";
  if (
    !plan ||
    plan.deductibleIndividualCents <= 0 ||
    level === "$0"
  ) {
    return schedule;
  }
  return `after meeting your ${formatCents(plan.deductibleIndividualCents)} deductible, ${schedule}`;
}

/** Formatted Rx OOP limit for compose templates; defaults to IYC $600. */
export function prescriptionLimitLabel(
  plan: PlanCostShareContext | null | undefined,
): string {
  return formatCents(plan?.rxOopLimitIndividualCents ?? 60_000);
}
