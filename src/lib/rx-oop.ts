/**
 * Which formulary levels count toward the prescription out-of-pocket limit.
 *
 * On the IYC plan that is Levels 1 and 2 only — Level 3 and 4 reach the federal
 * maximum alone. On the High Deductible Health Plan every level counts, and
 * the seeded cost-share rules set accumulatesToRxOop accordingly. Hardcoding
 * ["1","2"] therefore understates Rx OOP for every HDHP member and teaches
 * the agent the wrong rule.
 *
 * BenefitPlan.rxOopEligibleLevels stores the authoritative list as JSON.
 */

/** Default matches the IYC Certificate of Coverage asymmetry. */
export const DEFAULT_RX_OOP_LEVELS = ["1", "2"] as const;

export function parseRxOopEligibleLevels(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [...DEFAULT_RX_OOP_LEVELS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...DEFAULT_RX_OOP_LEVELS];
    }
    return parsed.map((v) => String(v));
  } catch {
    return [...DEFAULT_RX_OOP_LEVELS];
  }
}

export function countsTowardRxOop(
  level: string | null | undefined,
  eligibleLevels: readonly string[],
): boolean {
  if (!level) return false;
  return eligibleLevels.includes(level);
}

/** Human-readable list for gauges and agent copy. */
export function formatRxOopEligibleLevels(
  eligibleLevels: readonly string[],
): string {
  if (eligibleLevels.length === 0) return "no levels";
  if (eligibleLevels.length === 1) return `Level ${eligibleLevels[0]}`;
  if (eligibleLevels.length === 2) {
    return `Level ${eligibleLevels[0]} and Level ${eligibleLevels[1]}`;
  }
  const head = eligibleLevels.slice(0, -1).map((l) => `Level ${l}`);
  const last = eligibleLevels[eligibleLevels.length - 1];
  return `${head.join(", ")}, and Level ${last}`;
}
