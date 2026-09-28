/**
 * Apply cost-share overrides while preserving Certificate of Coverage channel
 * multipliers.
 *
 * The change console edits Retail-shaped dollar amounts. Writing those absolute
 * figures onto every channel flattened Mail (2×) and Retail90 (3×) schedules.
 * Patches without an explicit channel are treated as Retail-shaped and scaled;
 * flag and rate fields still apply across channels.
 */

import type { Channel } from "./types";

export interface CostShareOverride {
  level: string;
  /**
   * When set, the patch applies only to that channel with absolute amounts.
   * When omitted, money fields are treated as Retail-shaped Certificate of
   * Coverage figures and scaled onto Mail (×2) and Retail90 (×3) for levels
   * that use those multipliers; flag and rate fields apply to every channel.
   */
  channel?: Channel;
  costShareType?: "Copay" | "Coinsurance" | "NotCovered" | "Zero";
  copayCents?: number;
  coinsuranceRateBps?: number;
  coinsuranceMaxCents?: number;
  accumulatesToRxOop?: boolean;
}

export interface CostShareRuleLike {
  level: string;
  channel: Channel;
  costShareType: "Copay" | "Coinsurance" | "NotCovered" | "Zero";
  copayCents: number | null;
  coinsuranceRateBps: number | null;
  coinsuranceMaxCents: number | null;
  accumulatesToRxOop: boolean;
}

/**
 * Certificate of Coverage channel multipliers for absolute dollar cost share.
 *
 * Retail90 is three retail copays/maxima; mail is two. Level 4 is a flat $50
 * across channels in the published schedule, so it does not scale. Matching
 * that schedule here is what stops a Retail-only UI override from silently
 * flattening Mail and Retail90 down to the Retail dollar amount.
 */
export function costShareChannelMultiplier(
  channel: Channel,
  level: string,
): number {
  if (level !== "1" && level !== "2" && level !== "3") return 1;
  if (channel === "Retail90") return 3;
  if (channel === "Mail") return 2;
  return 1;
}

export function patchCostShareRules<T extends CostShareRuleLike>(
  rules: T[],
  patches: CostShareOverride[] | undefined,
): T[] {
  if (!patches?.length) return rules;
  return rules.map((r) => {
    const patch = patches.find(
      (c) =>
        c.level === r.level && (c.channel == null || c.channel === r.channel),
    );
    if (!patch) return r;
    const scale =
      patch.channel == null ? costShareChannelMultiplier(r.channel, r.level) : 1;
    return {
      ...r,
      costShareType: patch.costShareType ?? r.costShareType,
      copayCents:
        patch.copayCents !== undefined
          ? patch.copayCents * scale
          : r.copayCents,
      coinsuranceRateBps:
        patch.coinsuranceRateBps !== undefined
          ? patch.coinsuranceRateBps
          : r.coinsuranceRateBps,
      coinsuranceMaxCents:
        patch.coinsuranceMaxCents !== undefined
          ? patch.coinsuranceMaxCents * scale
          : r.coinsuranceMaxCents,
      accumulatesToRxOop:
        patch.accumulatesToRxOop !== undefined
          ? patch.accumulatesToRxOop
          : r.accumulatesToRxOop,
    };
  });
}

/** Retail-shaped cost-share fields the change console edits. */
export interface RetailCostShareDraft {
  level1CopayCents: number;
  level2RateBps: number;
  level2MaxCents: number;
  level3RateBps: number;
  level3MaxCents: number;
  level3CountsToRxOop: boolean;
  level4CopayCents: number;
  level4CountsToRxOop: boolean;
}

/**
 * Emit only the cost-share fields that differ from baseline.
 *
 * Sending the full Retail absolute schedule on every projection used to
 * overwrite Mail and Retail90 with Retail dollars even when the lever only
 * flipped an OOP flag.
 */
export function diffRetailCostShare(
  base: RetailCostShareDraft,
  draft: RetailCostShareDraft,
): CostShareOverride[] | undefined {
  const costShare: CostShareOverride[] = [];

  if (draft.level1CopayCents !== base.level1CopayCents) {
    costShare.push({ level: "1", copayCents: draft.level1CopayCents });
  }

  {
    const patch: CostShareOverride = { level: "2" };
    let dirty = false;
    if (draft.level2RateBps !== base.level2RateBps) {
      patch.coinsuranceRateBps = draft.level2RateBps;
      dirty = true;
    }
    if (draft.level2MaxCents !== base.level2MaxCents) {
      patch.coinsuranceMaxCents = draft.level2MaxCents;
      dirty = true;
    }
    if (dirty) costShare.push(patch);
  }

  {
    const patch: CostShareOverride = { level: "3" };
    let dirty = false;
    if (draft.level3RateBps !== base.level3RateBps) {
      patch.coinsuranceRateBps = draft.level3RateBps;
      dirty = true;
    }
    if (draft.level3MaxCents !== base.level3MaxCents) {
      patch.coinsuranceMaxCents = draft.level3MaxCents;
      dirty = true;
    }
    if (draft.level3CountsToRxOop !== base.level3CountsToRxOop) {
      patch.accumulatesToRxOop = draft.level3CountsToRxOop;
      dirty = true;
    }
    if (dirty) costShare.push(patch);
  }

  {
    const patch: CostShareOverride = { level: "4" };
    let dirty = false;
    if (draft.level4CopayCents !== base.level4CopayCents) {
      patch.copayCents = draft.level4CopayCents;
      dirty = true;
    }
    if (draft.level4CountsToRxOop !== base.level4CountsToRxOop) {
      patch.accumulatesToRxOop = draft.level4CountsToRxOop;
      dirty = true;
    }
    if (dirty) costShare.push(patch);
  }

  return costShare.length > 0 ? costShare : undefined;
}
