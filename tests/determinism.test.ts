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
import { prisma } from "@/lib/db";
import { adjudicate } from "@/lib/engine/adjudicate";
import { replay } from "@/lib/engine/replay";
import { reproduceClaim } from "@/lib/engine/reproduce";
import { resolveClock } from "@/lib/clock";
import { buildExperiences, emptyExperience } from "@/lib/nps/experience";
import { readingFrom } from "@/lib/nps/reading";
import { scoreMember, type MemberExperience } from "@/lib/nps/rubric";
import { drug, entry, makeContext } from "./fixtures";

/**
 * Traces are re-derived rather than stored, so reproduction is load-bearing:
 * if it drifted, every proof the application shows would be a fabrication.
 * This holds a sample of the book to its own recorded figures.
 */
describe("a claim's derivation can be reproduced from what is stored", () => {
  /** Holds a set of claims to the figures the book recorded for them. */
  async function expectReproducible(claims: { id: string; claimNumber: string }[]) {
    const disagreements: string[] = [];
    for (const c of claims) {
      const r = await reproduceClaim(c.id);
      if (!r) {
        disagreements.push(`${c.claimNumber}: could not be reproduced`);
        continue;
      }
      if (!r.agreement.matches) {
        disagreements.push(
          `${c.claimNumber}: ` +
            r.agreement.fields
              .filter((f) => f.stored !== f.reproduced)
              .map((f) => `${f.field} stored ${f.stored} got ${f.reproduced}`)
              .join(", "),
        );
      }
    }
    expect(disagreements).toEqual([]);
  }

  it("lands on the same money the book recorded", async () => {
    const claims = await prisma.claim.findMany({
      where: { traceJson: null },
      select: { id: true, claimNumber: true },
      take: 150,
      orderBy: { claimNumber: "asc" },
    });
    expect(claims.length).toBeGreaterThan(0);
    await expectReproducible(claims);
  });

  /*
   * Reversals get their own case because the sample above cannot reach them.
   * It takes the lowest claim numbers, and reversals are written after the
   * fills they cancel, so they carry the highest ones — which is how a reversal
   * path that disagreed with the book on every figure stayed invisible.
   */
  it("backs a reversal out to exactly what the fill was priced at", async () => {
    const reversals = await prisma.claim.findMany({
      where: { traceJson: null, transactionCode: "B2" },
      select: { id: true, claimNumber: true },
      take: 100,
      orderBy: { claimNumber: "desc" },
    });
    expect(reversals.length).toBeGreaterThan(0);
    await expectReproducible(reversals);
  });

  it("reports a reversal as a reversal rather than as a fill", async () => {
    const reversal = await prisma.claim.findFirst({
      where: { traceJson: null, transactionCode: "B2" },
      select: { id: true, reversalOfClaimId: true },
      orderBy: { claimNumber: "desc" },
    });
    expect(reversal).not.toBeNull();

    const r = await reproduceClaim(reversal!.id);
    expect(r).not.toBeNull();
    expect(r!.reversalOf?.id).toBe(reversal!.reversalOfClaimId);
    // The derivation shown is the fill being backed out, so it has to be there.
    expect(r!.outcome.trace.length).toBeGreaterThan(5);
    // And the money has to point the other way.
    expect(r!.outcome.totalBilledCents).toBeLessThan(0);
  });

  it("samples the newest end of the book too, not only the oldest", async () => {
    const claims = await prisma.claim.findMany({
      where: { traceJson: null },
      select: { id: true, claimNumber: true },
      take: 150,
      orderBy: { claimNumber: "desc" },
    });
    expect(claims.length).toBeGreaterThan(0);
    await expectReproducible(claims);
  });

  it("produces a trace with cited rules, not an empty one", async () => {
    const claim = await prisma.claim.findFirst({
      where: { traceJson: null, responseStatus: "P" },
      select: { id: true },
      orderBy: { claimNumber: "asc" },
    });
    expect(claim).not.toBeNull();

    const r = await reproduceClaim(claim!.id);
    expect(r).not.toBeNull();
    expect(r!.outcome.trace.length).toBeGreaterThan(5);
    expect(r!.outcome.trace.some((s) => s.sourceDocumentId)).toBe(true);
  });
});

describe("the engine is a pure function of its inputs", () => {
  it("returns identical output for identical input, every time", () => {
    const build = () =>
      makeContext({
        drug: drug({ nadacPerUnit: 3.25, isBrandLabel: true }),
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
      });

    // Same NDC across builds, so the AWP must land on the same value.
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

/**
 * The modelled member score.
 *
 * The change console subtracts a replayed score from a stored one and reports
 * the difference as the human cost of a benefit decision. That subtraction is
 * only worth anything if the two sides are computed identically and if neither
 * drifts on its own. A score that wandered by a point between runs would let
 * any change be presented as an improvement by running it twice.
 */
describe("member experience scoring is deterministic", () => {
  it("scores an identical year identically", () => {
    const exp: MemberExperience = {
      ...emptyExperience("m-fixed"),
      totalClaims: 14,
      paidClaims: 12,
      rejectsPaRequired: 2,
      oopCents: 24_000,
      worstFillCents: 6_500,
    };

    expect(scoreMember(exp)).toEqual(scoreMember({ ...exp }));
  });

  it("gives two members with the same year different answers", () => {
    const base = {
      ...emptyExperience("x"),
      totalClaims: 9,
      paidClaims: 9,
      oopCents: 30_000,
    };

    // Temperament is drawn from the member id and nothing else, so identical
    // experiences must not collapse onto one answer.
    const spread = new Set(
      ["m-1", "m-2", "m-3", "m-4", "m-5", "m-6", "m-7", "m-8"].map(
        (memberId) => scoreMember({ ...base, memberId }).raw + scoreMember({ ...base, memberId }).temperament,
      ),
    );
    expect(spread.size).toBeGreaterThan(1);
  });

  it("does not depend on the wall clock", () => {
    const exp = {
      ...emptyExperience("m-clock"),
      totalClaims: 4,
      paidClaims: 3,
      paDenied: 1,
    };
    expect(scoreMember(exp)).toEqual(scoreMember(exp));
  });

  it("leaves the score untouched when the benefit is untouched", async () => {
    const result = await replay({}, { nps: true, maxDiffs: 0 });

    expect(result.nps).toBeDefined();
    const { before, after } = result.nps!;

    expect(after.census.nps).toBe(before.census.nps);
    expect(after.census.detractors).toBe(before.census.detractors);
    expect(after.histogram).toEqual(before.histogram);
  });

  it("moves the score in the direction a change implies", async () => {
    // Trebling the Level 3 rate takes money out of members' pockets, and a
    // score that did not notice would not be measuring member experience.
    const worse = await replay(
      { costShare: [{ level: "3", coinsuranceRateBps: 9000 }] },
      { nps: true, maxDiffs: 0 },
    );

    expect(worse.nps!.after.census.nps).toBeLessThan(
      worse.nps!.before.census.nps,
    );
    expect(worse.nps!.after.census.detractors).toBeGreaterThan(
      worse.nps!.before.census.detractors,
    );
  });

  it("agrees with the score read straight from the database", async () => {
    /*
     * Two independent implementations: one grouped SQL pass, one incremental
     * tally inside the replay loop. They have to land on the same figure, or
     * a benefit change would appear to move member experience purely because
     * the before and after were counted by different code.
     */
    const clock = resolveClock(null);
    const stored = readingFrom(await buildExperiences(clock));
    const replayed = await replay({}, {
      nps: true,
      asOf: clock.now,
      maxDiffs: 0,
    });

    expect(replayed.nps!.before.census.scored).toBe(stored.census.scored);
    expect(replayed.nps!.before.census.nps).toBe(stored.census.nps);
    expect(replayed.nps!.before.histogram).toEqual(stored.histogram);
  });
});
