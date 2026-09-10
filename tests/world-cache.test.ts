/**
 * The in-process loadWorld cache must not outlive a PA determination write.
 *
 * POS prices against approvedPAs from that cache. A refusal clears
 * approvedEffectiveDate in Postgres; if the cache stays hot for the 60s TTL,
 * simulateFill keeps granting coverage the reviewer just refused.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  invalidateWorldCache,
  seedWorldCacheForTests,
  worldCacheIsHot,
  type ReplayWorld,
} from "@/lib/engine/replay";

function emptyWorld(): ReplayWorld {
  return {
    plans: new Map(),
    contract: {
      id: "test",
      model: "PassThrough",
      retailMaxDaysSupply: 30,
      discountExclusions: [],
      rebateExclusions: [],
      rebateMemberShareThresholdBps: 0,
      rates: [],
      rebatePassThroughBps: 10_000,
    },
    drugs: new Map(),
    formulary: new Map(),
    pharmacies: new Map(),
    members: new Map(),
    eligibility: new Map(),
    approvedPAs: new Map([
      [
        "member-1",
        [
          {
            drugId: "drug-specialty",
            effectiveDate: new Date("2026-01-01T00:00:00.000Z"),
            terminationDate: null,
          },
        ],
      ],
    ]),
  };
}

describe("loadWorld cache invalidation", () => {
  it("drops a hot cache so the next load cannot serve a refused approval", () => {
    seedWorldCacheForTests(emptyWorld());
    expect(worldCacheIsHot()).toBe(true);

    invalidateWorldCache();
    expect(worldCacheIsHot()).toBe(false);
  });

  it("is wired into the PA decide write path after a determination lands", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/app/api/pa/decide/route.ts"),
      "utf8",
    );
    expect(source).toContain(
      'import { invalidateWorldCache } from "@/lib/engine/replay"',
    );
    const updateIdx = source.indexOf("await prisma.priorAuthorization.update");
    // Skip the Escalated update; the determination write is the second update.
    const determinationIdx = source.indexOf(
      "await prisma.priorAuthorization.update",
      updateIdx + 1,
    );
    const invalidateIdx = source.indexOf(
      "invalidateWorldCache()",
      determinationIdx,
    );
    expect(determinationIdx).toBeGreaterThan(0);
    expect(invalidateIdx).toBeGreaterThan(determinationIdx);
  });
});
