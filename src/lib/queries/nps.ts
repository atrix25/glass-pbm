/**
 * Reading the member experience score, and the history of readings.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { buildExperiences } from "@/lib/nps/experience";
import { readingFrom, type NpsReading, type DriverTotal } from "@/lib/nps/reading";
import {
  RUBRIC_BY_ID,
  RUBRIC_VERSION,
  scoreMember,
  wouldRespond,
  type MemberExperience,
} from "@/lib/nps/rubric";
import { reasonLine, verbatimFor, worstTerm } from "@/lib/nps/verbatims";

export interface SnapshotRow {
  id: string;
  label: string;
  note: string | null;
  takenAt: Date;
  clockAt: Date;
  rubricVersion: string;
  configVersionLabel: string | null;
  scored: number;
  promoters: number;
  passives: number;
  detractors: number;
  npsCensus: number;
  responded: number;
  npsSurveyed: number;
  histogram: number[];
  drivers: DriverTotal[];
  /**
   * Change against the reading before it, or null when there is nothing to
   * compare against or when the schedule changed in between.
   */
  delta: number | null;
}

export async function getCurrentReading(
  clock: SimulationClock,
): Promise<NpsReading> {
  const experiences = await buildExperiences(clock);
  const enrolled = await prisma.member.count();
  const reading = readingFrom(experiences);
  reading.excluded = enrolled - reading.census.scored;
  return reading;
}

/**
 * The reading and its worked examples, from one pass over the book.
 *
 * Building the experiences costs a few seconds against 1.7 million claims, so
 * the page asks for both at once rather than paying twice for the same scan.
 */
export async function getReadingWithExamples(clock: SimulationClock): Promise<{
  reading: NpsReading;
  examples: { detractors: ExampleMember[]; promoters: ExampleMember[] };
  quotes: FeedbackQuote[];
}> {
  const experiences = await buildExperiences(clock);
  const enrolled = await prisma.member.count();
  const reading = readingFrom(experiences);
  // Members who never presented a prescription leave no row to count, so the
  // exclusion is the difference between the book and the scored population.
  reading.excluded = enrolled - reading.census.scored;
  const examples = await pickExamples(experiences);
  const quotes = await pickQuotes(experiences, reading);
  return { reading, examples, quotes };
}

export interface FeedbackQuote {
  memberId: string;
  name: string;
  score: number;
  segment: "detractor" | "passive" | "promoter";
  text: string;
  /** The rubric term this member's year turned on, if anything went wrong. */
  theme: string | null;
  /** The arithmetic behind the sentence, so it can be checked rather than believed. */
  reason: string;
}

/**
 * A handful of comments that between them describe the book.
 *
 * Two decisions matter here. The first is that only members who would have
 * answered the survey are quoted, matching the surveyed figure rather than the
 * census: a comment box is only ever filled in by respondents, and quoting
 * somebody who would have binned the email would be inventing a person rather
 * than rendering one.
 *
 * The second is that detractor quotes are picked one per theme rather than
 * worst-first. Sorting by score would return five variations on the same
 * complaint, because the members having the worst year are all having it for
 * the same reason, and a page of five identical grievances tells a reader
 * less than three different ones do.
 */
async function pickQuotes(
  experiences: MemberExperience[],
  reading: NpsReading,
): Promise<FeedbackQuote[]> {
  const respondents = experiences
    .map(scoreMember)
    .filter((s) => wouldRespond(s.memberId, s.score));

  const bySegment = (seg: string) =>
    respondents
      .filter((s) => s.segment === seg)
      // A stable order, so the same members are quoted until the book changes.
      .sort((a, b) => (a.memberId < b.memberId ? -1 : 1));

  const picked: typeof respondents = [];

  // One detractor for each of the leading complaints, in the order the themes
  // table ranks them, so the quotations illustrate the table above them.
  const detractors = bySegment("detractor");
  for (const theme of reading.themes.slice(0, 4)) {
    const match = detractors.find(
      (s) => worstTerm(s.applied)?.id === theme.id && !picked.includes(s),
    );
    if (match) picked.push(match);
  }

  // Then one of each of the other two, because a feedback page showing only
  // complaints is a different kind of dishonest from one showing none.
  const passive = bySegment("passive")[0];
  if (passive) picked.push(passive);
  const promoter = bySegment("promoter")[0];
  if (promoter) picked.push(promoter);

  const members = await prisma.member.findMany({
    where: { id: { in: picked.map((s) => s.memberId) } },
    select: { id: true, firstName: true, lastName: true },
  });
  const names = new Map(
    members.map((m) => [m.id, `${m.firstName} ${m.lastName}`]),
  );

  return picked
    .sort((a, b) => a.score - b.score)
    .map((s) => ({
      memberId: s.memberId,
      name: names.get(s.memberId) ?? "Member",
      score: s.score,
      segment: s.segment,
      text: verbatimFor(s).text,
      theme: worstTerm(s.applied)?.id ?? null,
      reason: reasonLine(s),
    }));
}

export async function getSnapshots(limit = 25): Promise<SnapshotRow[]> {
  const rows = await prisma.npsSnapshot.findMany({
    orderBy: { takenAt: "desc" },
    take: limit,
    include: { configVersion: { select: { label: true } } },
  });

  // Oldest first while the deltas are computed, then handed back newest first
  // because that is the end people read from.
  const ordered = [...rows].reverse();

  const out: SnapshotRow[] = ordered.map((r, i) => {
    const previous = i > 0 ? ordered[i - 1] : null;
    // Subtracting across a schedule change would produce a number that looks
    // like the benefit moved when in fact the question did.
    const comparable =
      previous !== null && previous.rubricVersion === r.rubricVersion;

    return {
      id: r.id,
      label: r.label,
      note: r.note,
      takenAt: r.takenAt,
      clockAt: r.clockAt,
      rubricVersion: r.rubricVersion,
      configVersionLabel: r.configVersion?.label ?? null,
      scored: r.scored,
      promoters: r.promoters,
      passives: r.passives,
      detractors: r.detractors,
      npsCensus: r.npsCensus,
      responded: r.responded,
      npsSurveyed: r.npsSurveyed,
      histogram: safeJson<number[]>(r.distribution, []),
      drivers: safeJson<DriverTotal[]>(r.drivers, []),
      delta: comparable
        ? Math.round((r.npsCensus - previous!.npsCensus) * 10) / 10
        : null,
    };
  });

  return out.reverse();
}

/** Record a reading, so it can be compared against later ones. */
export async function saveSnapshot(args: {
  label: string;
  note?: string | null;
  clock: SimulationClock;
  reading: NpsReading;
  configVersionId?: string | null;
}): Promise<string> {
  const { reading } = args;
  const row = await prisma.npsSnapshot.create({
    data: {
      label: args.label,
      note: args.note ?? null,
      clockAt: args.clock.now,
      rubricVersion: RUBRIC_VERSION,
      configVersionId: args.configVersionId ?? null,
      scored: reading.census.scored,
      promoters: reading.census.promoters,
      passives: reading.census.passives,
      detractors: reading.census.detractors,
      npsCensus: reading.census.nps,
      responded: reading.surveyed.scored,
      npsSurveyed: reading.surveyed.nps,
      distribution: JSON.stringify(reading.histogram),
      drivers: JSON.stringify(reading.drivers),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * A handful of members at each end, so the score can be checked against real
 * people rather than taken on trust.
 */
export interface ExampleMember {
  id: string;
  name: string;
  score: number;
  reasons: string[];
}

async function pickExamples(
  experiences: MemberExperience[],
): Promise<{ detractors: ExampleMember[]; promoters: ExampleMember[] }> {
  const scored = experiences.map(scoreMember);
  scored.sort((a, b) => a.score - b.score || (a.memberId < b.memberId ? -1 : 1));

  const worst = scored.slice(0, 3);
  const best = scored
    .filter((s) => s.score === 10)
    .slice(0, 3);

  const ids = [...worst, ...best].map((s) => s.memberId);
  const members = await prisma.member.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true },
  });
  const names = new Map(
    members.map((m) => [m.id, `${m.firstName} ${m.lastName}`]),
  );

  const shape = (s: (typeof scored)[number]): ExampleMember => ({
    id: s.memberId,
    name: names.get(s.memberId) ?? "Member",
    score: s.score,
    reasons: s.applied
      .slice()
      .sort((a, b) => a.points - b.points)
      .slice(0, 3)
      .map((t) => RUBRIC_BY_ID[t.id]?.says ?? t.id),
  });

  return { detractors: worst.map(shape), promoters: best.map(shape) };
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
