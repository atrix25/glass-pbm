/**
 * B2 accounting under an override that rejects the original fill.
 *
 * Skipping the stored reversal when the re-priced original is absent drops
 * the clawback from the baseline and invents phantom plan savings equal to
 * the fill — the change-console failure mode this pins.
 */

import { describe, expect, it } from "vitest";
import { reversalReplayDelta } from "@/lib/engine/replay";

describe("reversalReplayDelta", () => {
  const stored = {
    planPaidCents: -12_000,
    patientPayCents: -3_000,
    rebateCents: -100,
    totalBilledCents: -15_000,
  };

  it("negates the re-priced original when that fill still paid", () => {
    const delta = reversalReplayDelta({
      stored,
      replayedOriginal: {
        plan: 12_000,
        member: 3_000,
        rebate: 100,
        billed: 15_000,
      },
    });
    expect(delta.planPaidBeforeCents).toBe(-12_000);
    expect(delta.planPaidAfterCents).toBe(-12_000);
    expect(delta.memberPaidBeforeCents).toBe(-3_000);
    expect(delta.memberPaidAfterCents).toBe(-3_000);
    expect(delta.changed).toBe(false);
  });

  it("keeps the stored B2 on the before side when the original no longer pays", () => {
    const delta = reversalReplayDelta({
      stored,
      replayedOriginal: null,
    });
    // Baseline still nets the clawback; after has nothing to reverse.
    expect(delta.planPaidBeforeCents).toBe(-12_000);
    expect(delta.planPaidAfterCents).toBe(0);
    expect(delta.memberPaidBeforeCents).toBe(-3_000);
    expect(delta.memberPaidAfterCents).toBe(0);
    expect(delta.rebateBeforeCents).toBe(-100);
    expect(delta.rebateAfterCents).toBe(0);
  });

  it("nets to zero with the original when an exclusion rejects an already-reversed fill", () => {
    // B1 before + B2 before = 0. B1 after (reject) + B2 after (0) = 0.
    // Omitting the B2 from before would leave +12_000 of phantom savings.
    const originalBefore = 12_000;
    const b2 = reversalReplayDelta({ stored, replayedOriginal: null });
    const pairBefore = originalBefore + b2.planPaidBeforeCents;
    const pairAfter = 0 + b2.planPaidAfterCents;
    expect(pairBefore).toBe(0);
    expect(pairAfter).toBe(0);
    expect(originalBefore + 0 /* omitted B2 */).toBe(12_000);
  });
});
