/**
 * The feedback layer: the comments, the themes behind them, the recommendations
 * they lead to, and the sampling that prices those recommendations quickly.
 *
 * These four things are the parts of the member-experience work most likely to
 * be believed without being checked, because a sentence in quotation marks and
 * a figure labelled "projected" both read as evidence whether or not they are.
 * So the properties asserted here are the ones a sceptical reader would
 * demand: that no comment says anything the claims do not, that no
 * recommendation names a drug that is not in the file, and that the fast
 * answer agrees with the slow one.
 */

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resolveClock } from "@/lib/clock";
import { hashString } from "@/lib/hash";
import { replay } from "@/lib/engine/replay";
import { buildExperiences } from "@/lib/nps/experience";
import { readingFrom } from "@/lib/nps/reading";
import { getRecommendations } from "@/lib/nps/recommendations";
import { scoreMember, type ScoredMember } from "@/lib/nps/rubric";
import { reasonLine, verbatimFor, worstTerm } from "@/lib/nps/verbatims";

const clock = resolveClock(null);

/** Scoring the book costs a few seconds, so it is done once. */
let cachedScored: ScoredMember[] | null = null;
async function scoredBook(): Promise<ScoredMember[]> {
  if (!cachedScored) {
    cachedScored = (await buildExperiences(clock)).map(scoreMember);
  }
  return cachedScored;
}

describe("survey comments say only what the record says", () => {
  it("is the same sentence every time it is generated", async () => {
    const book = await scoredBook();

    for (const s of book.slice(0, 1000)) {
      // A separately constructed object with the same values, rather than the
      // same object twice, so this proves the wording is a function of the
      // member's record and not of anything cached alongside it.
      const rebuilt: ScoredMember = {
        ...s,
        applied: s.applied.map((t) => ({ ...t })),
      };
      expect(verbatimFor(rebuilt).text).toBe(verbatimFor(s).text);
    }
  });

  it("only ever quotes clauses that trace to an applied term", async () => {
    const book = await scoredBook();

    for (const s of book.slice(0, 2000)) {
      const applied = new Set(s.applied.map((t) => t.id));
      for (const id of verbatimFor(s).fromTerms) {
        expect(applied.has(id)).toBe(true);
      }
    }
  });

  it("never lets a promoter voice a complaint", async () => {
    const book = await scoredBook();
    const promoters = book.filter((s) => s.segment === "promoter");
    expect(promoters.length).toBeGreaterThan(0);

    // A member who would recommend the plan describing their costs as
    // genuinely difficult reads as machinery, and discredits the honest
    // quotations around it.
    for (const s of promoters.slice(0, 3000)) {
      const negatives = new Set(
        s.applied.filter((t) => t.points < 0).map((t) => t.id),
      );
      for (const id of verbatimFor(s).fromTerms) {
        expect(negatives.has(id)).toBe(false);
      }
    }
  });

  it("gives differently worded complaints to members with identical experiences", async () => {
    const book = await scoredBook();

    // Members whose only deduction is a single prior-auth reject: the same
    // record, and so the same complaint, which should not be the same sentence
    // across thousands of people.
    const identical = book
      .filter(
        (s) =>
          s.applied.length === 1 &&
          s.applied[0].id === "reject-pa-required" &&
          s.applied[0].occurrences === 1,
      )
      .slice(0, 400);

    expect(identical.length).toBeGreaterThan(20);
    const wordings = new Set(identical.map((s) => verbatimFor(s).text));
    expect(wordings.size).toBeGreaterThan(1);
  });

  it("explains itself with the arithmetic underneath", async () => {
    const book = await scoredBook();
    const withTerms = book.filter((s) => s.applied.length > 0).slice(0, 200);

    for (const s of withTerms) {
      expect(reasonLine(s).length).toBeGreaterThan(0);
    }
  });
});

describe("complaint themes count each member once", () => {
  it("attributes every scored member to at most their worst term", async () => {
    const experiences = await buildExperiences(clock);
    const reading = readingFrom(experiences);

    const withADeduction = experiences
      .map(scoreMember)
      .filter((s) => worstTerm(s.applied) !== null).length;

    const counted = reading.themes.reduce((sum, t) => sum + t.members, 0);
    expect(counted).toBe(withADeduction);

    // A theme cannot have more detractors than it has members, which is the
    // shape of error a double-count would produce.
    for (const t of reading.themes) {
      expect(t.detractors).toBeLessThanOrEqual(t.members);
    }
  });
});

describe("recommendations point at things that exist", () => {
  it("names drugs that are in the file and members who were really turned away", async () => {
    const recommendations = await getRecommendations(clock);
    expect(recommendations.length).toBeGreaterThan(3);

    for (const r of recommendations) {
      expect(r.membersAffected).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.caution.length).toBeGreaterThan(0);

      // No stray punctuation carried over from an untidy drug name.
      expect(r.title).not.toMatch(/[(,;:-]\s*$/);

      const match = r.override.formulary?.[0]?.nameContains;
      if (!match) continue;

      const hits = await prisma.drug.count({
        where: { name: { contains: match } },
      });
      expect(hits).toBeGreaterThan(0);
    }
  });

  it("is ranked by members affected rather than by expected score movement", async () => {
    const recommendations = await getRecommendations(clock);
    for (let i = 1; i < recommendations.length; i++) {
      expect(recommendations[i - 1].membersAffected).toBeGreaterThanOrEqual(
        recommendations[i].membersAffected,
      );
    }
  });

  it("declines to quote a points figure where cost share is the mechanism", async () => {
    const recommendations = await getRecommendations(clock);
    const costShare = recommendations.filter((r) => r.kind === "cost-share");
    expect(costShare.length).toBeGreaterThan(0);

    // Moving people across out-of-pocket bands cannot be counted without
    // re-pricing the year, and a confident zero would read as "this would not
    // help" rather than "the engine has to answer this one".
    for (const r of costShare) expect(r.pointsAtStake).toBeNull();
  });
});

describe("a projection is the same measurement on fewer members", () => {
  it("draws the same sample every time", async () => {
    const rate = 0.15;
    const ids = await prisma.member.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: 5000,
    });

    const draw = () =>
      ids
        .filter((m) => hashString(`${m.id}:sample`) / 4294967296 < rate)
        .map((m) => m.id);

    expect(draw()).toEqual(draw());

    // And is roughly the size it claims to be, since a sample that quietly
    // took a tenth of what was asked for would still look deterministic.
    const share = draw().length / ids.length;
    expect(share).toBeGreaterThan(rate - 0.03);
    expect(share).toBeLessThan(rate + 0.03);
  });

  it("does not correlate with who is generous or who replies", async () => {
    const ids = await prisma.member.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: 20_000,
    });

    // The sample must not be drawn from the same hash namespace as
    // temperament, or a projection would be biased in a flattering direction
    // that nothing on the page would reveal.
    const inSample = ids.filter(
      (m) => hashString(`${m.id}:sample`) / 4294967296 < 0.15,
    );
    const meanTemperament = (rows: { id: string }[]) =>
      rows.reduce(
        (sum, m) => sum + hashString(`${m.id}:temperament`) / 4294967296,
        0,
      ) / rows.length;

    expect(
      Math.abs(meanTemperament(inSample) - meanTemperament(ids)),
    ).toBeLessThan(0.02);
  });

  it("reports no movement for no change, on a sample as on the book", async () => {
    const r = await replay({}, { nps: true, maxDiffs: 0, sampleRate: 0.15 });

    expect(r.sampleRate).toBe(0.15);
    expect(r.claimsChanged).toBe(0);
    expect(r.nps!.after.census.nps).toBe(r.nps!.before.census.nps);

    // Fewer members than the book, but a real number of them.
    expect(r.nps!.before.census.scored).toBeGreaterThan(5_000);
    expect(r.nps!.before.census.scored).toBeLessThan(30_000);
  }, 120_000);

  it("agrees with the full run on how far a change moves the score", async () => {
    const change = {
      formulary: [{ nameContains: "CLARINEX-D", requiresPA: false }],
    };

    const [sampled, full] = [
      await replay(change, { nps: true, maxDiffs: 0, sampleRate: 0.15 }),
      await replay(change, { nps: true, maxDiffs: 0 }),
    ];

    const delta = (r: typeof full) =>
      r.nps!.after.census.nps - r.nps!.before.census.nps;

    // The change has to actually do something, or the agreement below is
    // vacuous: two ways of computing zero will always match.
    expect(delta(full)).toBeGreaterThan(1);

    /*
     * The tolerance is on the movement, not on the level.
     *
     * A sixth of the members is a slightly different population and sits at a
     * slightly different score, which is why the panel shows a delta and never
     * a projected level. Whatever makes the sample unrepresentative is present
     * on both sides of the subtraction and cancels.
     */
    expect(Math.abs(delta(sampled) - delta(full))).toBeLessThan(0.5);
  }, 300_000);
});