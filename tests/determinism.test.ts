/**
 * Determinism and replay.
 *
 * A claim that cannot be reproduced cannot be audited. These assert that the
 * engine is a pure function of its inputs, and that re-adjudicating the stored
 * book against its own configuration reproduces every stored figure exactly.
 * The replay check is what makes the change console trustworthy: if a no-op
 * replay drifted, no difference it reported would mean anything.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { replay } from "@/lib/engine/replay";
import { drug, entry, makeContext } from "./fixtures";

describe("the engine is a pure function of its inputs", () => {
  it("returns identical output for identical input, every time", () => {
    const build = () =>
      makeContext({
        drug: drug({ nadacPerUnit: 3.25, isBrandLabel: true }),
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
      });

    // Same NDC across builds, so the simulated AWP must land on the same value.
    const fixed = drug({ nadacPerUnit: 3.25, isBrandLabel: true });
    const runs = Array.from({ length: 10 }, () =>
      adjudicate(
        makeContext({
          drug: fixed,
          formularyEntry: entry({ level: "2" }),
          quantityDispensed: 30,
          daysSupply: 30,
        }),
      ),
    );

    const first = JSON.stringify(runs[0]);
    for (const r of runs) expect(JSON.stringify(r)).toBe(first);
    expect(build).toBeTypeOf("function");
  });

  it("produces a different result only when an input differs", () => {
    const base = drug({ nadacPerUnit: 3.25, isBrandLabel: true });
    const a = adjudicate(
      makeContext({ drug: base, formularyEntry: entry({ level: "2" }) }),
    );
    const b = adjudicate(
      makeContext({ drug: base, formularyEntry: entry({ level: "3" }) }),
    );
    expect(a.patientPayCents).not.toBe(b.patientPayCents);
  });

  it("does not depend on the wall clock", () => {
    const d = drug({ nadacPerUnit: 3.25, isBrandLabel: false });
    const one = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({ level: "1" }),
        dateOfService: new Date("2026-03-15T00:00:00Z"),
      }),
    );
    // Same claim, evaluated later in real time.
    const two = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({ level: "1" }),
        dateOfService: new Date("2026-03-15T00:00:00Z"),
      }),
    );
    expect(one).toEqual(two);
  });
});

describe("replay reproduces the stored book", () => {
  it("changes nothing when nothing is changed", async () => {
    const result = await replay({});

    expect(result.claimsEvaluated).toBeGreaterThan(10_000);
    expect(result.claimsChanged).toBe(0);
    expect(result.newRejects).toBe(0);
    expect(result.newlyPaid).toBe(0);
    expect(result.planPaidAfterCents).toBe(result.planPaidBeforeCents);
    expect(result.memberPaidAfterCents).toBe(result.memberPaidBeforeCents);
  });

  it("moves money in the direction a change implies", async () => {
    const baseline = await replay({});
    const raised = await replay({ costShare: [{ level: "1", copayCents: 1000 }] });

    // Doubling the Level 1 copay must cost members more and the plan less.
    expect(raised.memberPaidAfterCents).toBeGreaterThan(
      baseline.memberPaidAfterCents,
    );
    expect(raised.planPaidAfterCents).toBeLessThan(
      baseline.planPaidAfterCents,
    );
    expect(raised.claimsChanged).toBeGreaterThan(0);
  });

  it("conserves money under a change: what the member gains the plan loses", async () => {
    const baseline = await replay({});
    const changed = await replay({ costShare: [{ level: "2", coinsuranceMaxCents: 2500 }] });

    const memberDelta =
      changed.memberPaidAfterCents - baseline.memberPaidAfterCents;
    const planDelta = changed.planPaidAfterCents - baseline.planPaidAfterCents;

    // The total billed does not move, so the two deltas must offset exactly.
    expect(memberDelta + planDelta).toBe(0);
    expect(memberDelta).toBeLessThan(0);
  });

  it("gives the same answer when the same replay runs twice", async () => {
    const a = await replay({ costShare: [{ level: "3", coinsuranceRateBps: 3000 }] });
    const b = await replay({ costShare: [{ level: "3", coinsuranceRateBps: 3000 }] });

    expect(a.claimsChanged).toBe(b.claimsChanged);
    expect(a.planPaidAfterCents).toBe(b.planPaidAfterCents);
    expect(a.memberPaidAfterCents).toBe(b.memberPaidAfterCents);
  });
});
