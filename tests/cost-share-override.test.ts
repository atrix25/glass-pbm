/**
 * Change-console cost-share overrides must preserve Certificate of Coverage
 * channel multipliers. A Retail-shaped patch that wrote the same absolute
 * dollars onto Mail and Retail90 flattened 2×/3× schedules and invented
 * phantom savings on levers that never touched copays.
 */

import { describe, expect, it } from "vitest";
import {
  costShareChannelMultiplier,
  diffRetailCostShare,
  patchCostShareRules,
  type RetailCostShareDraft,
} from "@/lib/engine/cost-share-override";
import { PLAN } from "./fixtures";

const baseline: RetailCostShareDraft = {
  level1CopayCents: 500,
  level2RateBps: 2000,
  level2MaxCents: 5000,
  level3RateBps: 4000,
  level3MaxCents: 15000,
  level3CountsToRxOop: false,
  level4CopayCents: 5000,
  level4CountsToRxOop: false,
};

function rule(
  rules: ReturnType<typeof patchCostShareRules>,
  level: string,
  channel: string,
) {
  return rules.find((r) => r.level === level && r.channel === channel)!;
}

describe("costShareChannelMultiplier", () => {
  it("matches the Certificate of Coverage schedule", () => {
    expect(costShareChannelMultiplier("Retail", "1")).toBe(1);
    expect(costShareChannelMultiplier("Mail", "1")).toBe(2);
    expect(costShareChannelMultiplier("Retail90", "1")).toBe(3);
    expect(costShareChannelMultiplier("Specialty", "2")).toBe(1);
    // Level 4 is flat across channels in the published schedule.
    expect(costShareChannelMultiplier("Mail", "4")).toBe(1);
    expect(costShareChannelMultiplier("Retail90", "4")).toBe(1);
  });
});

describe("patchCostShareRules", () => {
  it("scales Retail-shaped Level 1 copays onto Mail and Retail90", () => {
    const rules = patchCostShareRules(PLAN.costShareRules, [
      { level: "1", copayCents: 700 },
    ]);
    expect(rule(rules, "1", "Retail").copayCents).toBe(700);
    expect(rule(rules, "1", "Mail").copayCents).toBe(1400);
    expect(rule(rules, "1", "Retail90").copayCents).toBe(2100);
    expect(rule(rules, "1", "Specialty").copayCents).toBe(700);
  });

  it("does not flatten Mail or Retail90 when only an OOP flag is patched", () => {
    const rules = patchCostShareRules(PLAN.costShareRules, [
      { level: "3", accumulatesToRxOop: true },
    ]);
    expect(rule(rules, "3", "Retail").accumulatesToRxOop).toBe(true);
    expect(rule(rules, "3", "Mail").accumulatesToRxOop).toBe(true);
    expect(rule(rules, "1", "Mail").copayCents).toBe(1000);
    expect(rule(rules, "1", "Retail90").copayCents).toBe(1500);
    expect(rule(rules, "3", "Mail").coinsuranceMaxCents).toBe(30000);
    expect(rule(rules, "3", "Retail90").coinsuranceMaxCents).toBe(45000);
  });

  it("honours an explicit channel without scaling", () => {
    const rules = patchCostShareRules(PLAN.costShareRules, [
      { level: "1", channel: "Mail", copayCents: 1200 },
    ]);
    expect(rule(rules, "1", "Mail").copayCents).toBe(1200);
    expect(rule(rules, "1", "Retail").copayCents).toBe(500);
    expect(rule(rules, "1", "Retail90").copayCents).toBe(1500);
  });

  it("leaves Level 4 flat when a Retail-shaped copay is patched", () => {
    const rules = patchCostShareRules(PLAN.costShareRules, [
      { level: "4", copayCents: 6000 },
    ]);
    expect(rule(rules, "4", "Retail").copayCents).toBe(6000);
    expect(rule(rules, "4", "Mail").copayCents).toBe(6000);
    expect(rule(rules, "4", "Retail90").copayCents).toBe(6000);
  });
});

describe("diffRetailCostShare", () => {
  it("emits only the Level 3 OOP flag for that preset", () => {
    expect(
      diffRetailCostShare(baseline, {
        ...baseline,
        level3CountsToRxOop: true,
      }),
    ).toEqual([{ level: "3", accumulatesToRxOop: true }]);
  });

  it("omits costShare entirely when the draft matches the baseline", () => {
    expect(diffRetailCostShare(baseline, baseline)).toBeUndefined();
  });

  it("emits a Retail-shaped Level 1 copay when the draft changes it", () => {
    expect(
      diffRetailCostShare(baseline, {
        ...baseline,
        level1CopayCents: 700,
      }),
    ).toEqual([{ level: "1", copayCents: 700 }]);
  });
});
