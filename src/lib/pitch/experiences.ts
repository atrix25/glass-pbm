/**
 * Recorded experiences for the interactive pitch deck.
 *
 * Each experience is a real path through the seeded book — demo members,
 * exemplar claims, PA determinations — resolved from the database so a
 * reseed cannot leave the deck pointing at a missing record.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";
import { DEMO_MEMBER_STORIES } from "@/lib/demo-members";
import { getWalkthroughFacts } from "@/lib/queries/walkthrough";
import { getBookTotals } from "@/lib/queries/sponsor";
import { getSpreadComparison, getRebateWaterfall } from "@/lib/queries/reports";

/**
 * Seeded PAs carry their eventual determination with a future `decidedAt`.
 * The pitch already cuts on `receivedAt`, but must also hide the outcome
 * until that instant — otherwise a pin during the review window narrates
 * "approved" / "denied" while the live queue still shows in review.
 */
export function pitchPaOutcomeAsOf(
  pa: { determination: string | null; decidedAt: Date | null },
  now: Date,
): { determination: string | null; decidedAt: Date | null } {
  if (pa.decidedAt != null && pa.decidedAt.getTime() <= now.getTime()) {
    return { determination: pa.determination, decidedAt: pa.decidedAt };
  }
  return { determination: null, decidedAt: null };
}

export interface ExperienceBeat {
  when: string;
  what: string;
  href?: string;
}

export interface PitchExperience {
  id: string;
  pillar: "reporting" | "transparency" | "service" | "proof";
  title: string;
  memberName?: string;
  tag: string;
  story: string;
  figure?: { value: string; label: string };
  beats: ExperienceBeat[];
  liveHref: string;
  liveLabel: string;
  askPrompt?: string;
}

export interface PitchBookStats {
  lives: string;
  claims: string;
  planPaid: string;
  spreadDelta: string;
  rebateNet: string;
  npsCensus: string;
  npsSurveyed: string;
  exampleClaimHref: string | null;
  exampleClaimLabel: string | null;
  examplePaHref: string | null;
  examplePaLabel: string | null;
}

export async function getPitchBookStats(
  clock: SimulationClock,
): Promise<PitchBookStats> {
  const [facts, totals, spread, rebates] = await Promise.all([
    getWalkthroughFacts(clock),
    getBookTotals(clock),
    getSpreadComparison(clock),
    getRebateWaterfall(clock),
  ]);
  return {
    lives: formatNumber(facts.lives),
    claims: formatNumber(facts.claims),
    planPaid: formatCentsCompact(totals.planPaidCents),
    spreadDelta: formatCentsCompact(spread.deltaCents),
    rebateNet: formatCentsCompact(rebates.netToPlanCents),
    npsCensus: facts.npsCensus.toFixed(0),
    npsSurveyed: facts.npsSurveyed.toFixed(0),
    exampleClaimHref: facts.exampleClaim?.href ?? null,
    exampleClaimLabel: facts.exampleClaim
      ? `${facts.exampleClaim.label} · ${facts.exampleClaim.detail}`
      : null,
    examplePaHref: facts.examplePa?.href ?? null,
    examplePaLabel: facts.examplePa
      ? `${facts.examplePa.label} · ${facts.examplePa.detail}`
      : null,
  };
}

async function memberExperience(
  memberId: string,
  clock: SimulationClock,
): Promise<{
  claims: Array<{
    id: string;
    claimNumber: string;
    dateOfService: Date;
    responseStatus: string;
    rejectMessage: string | null;
    totalBilledCents: number;
    patientPayCents: number;
    scenarioTag: string | null;
    drugName: string;
  }>;
  pas: Array<{
    id: string;
    paNumber: string;
    determination: string | null;
    decidedAt: Date | null;
    drugName: string;
  }>;
} | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true },
  });
  if (!member) return null;

  const [claims, pas] = await Promise.all([
    prisma.claim.findMany({
      where: {
        memberId,
        dateOfService: { lte: clock.today },
        scenarioTag: { startsWith: "demo-" },
      },
      orderBy: { dateOfService: "asc" },
      take: 8,
      select: {
        id: true,
        claimNumber: true,
        dateOfService: true,
        responseStatus: true,
        rejectMessage: true,
        totalBilledCents: true,
        patientPayCents: true,
        scenarioTag: true,
        drug: { select: { name: true } },
      },
    }),
    prisma.priorAuthorization.findMany({
      where: { memberId, receivedAt: { lte: clock.now } },
      orderBy: { receivedAt: "asc" },
      take: 4,
      select: {
        id: true,
        paNumber: true,
        determination: true,
        decidedAt: true,
        drug: { select: { name: true } },
      },
    }),
  ]);

  return {
    claims: claims.map((c) => ({
      id: c.id,
      claimNumber: c.claimNumber,
      dateOfService: c.dateOfService,
      responseStatus: c.responseStatus,
      rejectMessage: c.rejectMessage,
      totalBilledCents: c.totalBilledCents,
      patientPayCents: c.patientPayCents,
      scenarioTag: c.scenarioTag,
      drugName: c.drug.name,
    })),
    pas: pas.map((p) => {
      const outcome = pitchPaOutcomeAsOf(p, clock.now);
      return {
        id: p.id,
        paNumber: p.paNumber,
        determination: outcome.determination,
        decidedAt: outcome.decidedAt,
        drugName: p.drug.name,
      };
    }),
  };
}

function beatFromClaim(c: {
  id: string;
  claimNumber: string;
  dateOfService: Date;
  responseStatus: string;
  rejectMessage: string | null;
  totalBilledCents: number;
  patientPayCents: number;
  drugName: string;
}): ExperienceBeat {
  const paid = c.responseStatus === "P";
  return {
    when: formatDate(c.dateOfService),
    what: paid
      ? `${c.drugName} paid — billed ${formatCents(c.totalBilledCents)}, member ${formatCents(c.patientPayCents)}`
      : `${c.drugName} rejected${c.rejectMessage ? ` — ${c.rejectMessage}` : ""}`,
    href: `/claims/${c.id}`,
  };
}

export async function getPitchExperiences(
  clock: SimulationClock,
): Promise<PitchExperience[]> {
  const stats = await getPitchBookStats(clock);
  const stories = DEMO_MEMBER_STORIES;

  const loaded = await Promise.all(
    stories.map(async (s) => ({ story: s, data: await memberExperience(s.id, clock) })),
  );

  const experiences: PitchExperience[] = [];

  // Book-level recorded experiences
  experiences.push({
    id: "book-spend",
    pillar: "reporting",
    title: "The year on the claim ledger",
    tag: "live book",
    story:
      "Every total on the sponsor dashboard is a sum over individual claims. Open the ledger and the two agree — not two systems reconciled to each other.",
    figure: { value: stats.planPaid, label: "plan paid year to date" },
    beats: [
      {
        when: "Book",
        what: `${stats.lives} members · ${stats.claims} claims adjudicated`,
        href: "/sponsor",
      },
      {
        when: "Reports",
        what: `Same utilisation under a published spread schedule would cost ${stats.spreadDelta} more`,
        href: "/reports",
      },
      {
        when: "Rebates",
        what: `${stats.rebateNet} net to plan after disclosed rebate admin`,
        href: "/reports",
      },
    ],
    liveHref: "/sponsor",
    liveLabel: "Open sponsor dashboard",
  });

  if (stats.exampleClaimHref) {
    experiences.push({
      id: "claim-derivation",
      pillar: "transparency",
      title: "One claim, fully derived",
      tag: "recompute",
      story:
        "Open an expensive paid fill with no stored trace. The engine re-derives the claim on the spot — lesser-of arms, winner, source citations — and prints a recomputation banner.",
      figure: stats.exampleClaimLabel
        ? { value: "Live", label: stats.exampleClaimLabel }
        : undefined,
      beats: [
        {
          when: "Open",
          what: stats.exampleClaimLabel ?? "Exemplar paid claim",
          href: stats.exampleClaimHref,
        },
        {
          when: "Check",
          what: "Lesser-of arms, NADAC markup, and the source PDF behind the rule",
          href: stats.exampleClaimHref,
        },
      ],
      liveHref: stats.exampleClaimHref,
      liveLabel: "Open claim derivation",
    });
  }

  for (const { story, data } of loaded) {
    if (!data) continue;
    const claimBeats = data.claims.slice(0, 5).map(beatFromClaim);
    const paBeats: ExperienceBeat[] = data.pas.map((p) => ({
      when: p.decidedAt ? formatDate(p.decidedAt) : "Pending",
      what: `${p.drugName} prior auth ${p.determination ? String(p.determination).toLowerCase() : "in review"} (${p.paNumber})`,
      href: `/pa/${p.id}`,
    }));

    const paidOop = data.claims
      .filter((c) => c.responseStatus === "P")
      .reduce((s, c) => s + c.patientPayCents, 0);

    let pillar: PitchExperience["pillar"] = "service";
    let liveHref = `/assistant?member=${story.id}`;
    let liveLabel = `Ask as ${story.name.split(" ")[0]}`;
    if (story.id.includes("0001")) {
      pillar = "transparency";
      liveHref = data.claims.at(-1)
        ? `/claims/${data.claims.at(-1)!.id}`
        : `/members/${story.id}`;
      liveLabel = "Open Margaret’s claim path";
    } else if (story.id.includes("0002") || story.id.includes("0003")) {
      pillar = "service";
      if (data.pas[0]) {
        liveHref = `/pa/${data.pas[0].id}`;
        liveLabel = "Open prior authorization";
      }
    } else if (story.id.includes("0004")) {
      pillar = "transparency";
      const reject = data.claims.find((c) => c.responseStatus !== "P");
      liveHref = reject ? `/claims/${reject.id}` : `/members/${story.id}`;
      liveLabel = "Open reject path";
    }

    experiences.push({
      id: story.id,
      pillar,
      title: story.name,
      memberName: story.name,
      tag: story.tag,
      story: story.story,
      figure:
        paidOop > 0
          ? { value: formatCentsCompact(paidOop), label: "member paid on demo fills" }
          : undefined,
      beats: [...paBeats, ...claimBeats].slice(0, 6),
      liveHref,
      liveLabel,
      askPrompt: story.prompt,
    });
  }

  experiences.push({
    id: "member-experience",
    pillar: "service",
    title: "What members would say — from events",
    tag: "experience",
    story:
      "NPS is derived from claim and PA events, not surveys of the happy. The gap between the census score and the surveyed score is the incumbent trick the page is built to expose.",
    figure: {
      value: `${stats.npsCensus} vs ${stats.npsSurveyed}`,
      label: "census NPS vs surveyed NPS",
    },
    beats: [
      {
        when: "Experience",
        what: "Open the drivers, read the verbatims, then model a fix in the change console",
        href: "/experience",
      },
    ],
    liveHref: "/experience",
    liveLabel: "Open member experience",
  });

  experiences.push({
    id: "change-console",
    pillar: "reporting",
    title: "Change the benefit before you commit",
    tag: "whole-book replay",
    story:
      "Move a lever and re-adjudicate every affected claim. See the cost delta and the named members who would be disrupted — the capability most consultants cannot buy.",
    beats: [
      {
        when: "Experience",
        what: "From a recommendation on the experience page, or open the console directly",
        href: "/changes",
      },
    ],
    liveHref: "/changes",
    liveLabel: "Open change console",
  });

  if (stats.examplePaHref) {
    experiences.push({
      id: "pa-criteria",
      pillar: "proof",
      title: "Prior auth on published criteria",
      tag: "criteria tree",
      story:
        "A request decided by walking a transcribed Navitus criteria form — the deciding step can be checked against the PDF.",
      figure: stats.examplePaLabel
        ? { value: "Live", label: stats.examplePaLabel }
        : undefined,
      beats: [
        {
          when: "Open",
          what: stats.examplePaLabel ?? "Decided PA",
          href: stats.examplePaHref,
        },
      ],
      liveHref: stats.examplePaHref,
      liveLabel: "Open prior authorization",
    });
  }

  experiences.push({
    id: "data-agent",
    pillar: "reporting",
    title: "Ask the book a question",
    tag: "data agent",
    story:
      "Sponsors ask in plain language. The data agent calls the same report and rollup queries the dashboards use, then composes a briefing — every figure tool-backed.",
    beats: [
      {
        when: "Try",
        what: "“Which pricing guarantees missed?” or “Write the year-end rebate briefing”",
        href: "/data-agent",
      },
    ],
    liveHref: "/data-agent",
    liveLabel: "Open data agent",
  });

  return experiences;
}
