/**
 * Turning a hundred thousand answers into the two numbers.
 *
 * The census figure scores everybody who used the benefit. It is the one worth
 * tracking, because it has no sampling in it: if it moves two points, something
 * about the book changed, and nothing else can have caused it.
 *
 * The surveyed figure is what a real questionnaire would have come back with,
 * given a plausible response rate and the fact that the people who answer are
 * not a random slice of the people who were asked. It exists to be shown beside
 * the census figure. The gap between them is the most useful thing on the page:
 * it is roughly the amount by which any published net promoter score in this
 * industry, including a competitor's, is an artefact of who could be bothered
 * to reply.
 */

import {
  scoreMember,
  wouldRespond,
  type MemberExperience,
  type ScoredMember,
} from "./rubric";
import { worstTerm } from "./verbatims";

export interface Segments {
  scored: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** Promoter share minus detractor share, in points. */
  nps: number;
}

export interface NpsReading {
  census: Segments;
  surveyed: Segments;
  /** Count of answers at each whole number, index 0 through 10. */
  histogram: number[];
  /**
   * Total points each rubric term took off, or put on, across everybody, and
   * how many members it touched. This is the actionable half of the page: it
   * says where the benefit hurts rather than only how much.
   */
  drivers: DriverTotal[];
  /** What members would complain about, ranked by how many would lead with it. */
  themes: ThemeCount[];
  /**
   * Members who never presented a prescription, excluded from every figure
   * above. Set by whoever knows the size of the whole book, since somebody
   * with no claims at all leaves no trace to count.
   */
  excluded: number;
}

export interface DriverTotal {
  id: string;
  membersAffected: number;
  totalPoints: number;
}

/**
 * How often a term was the worst thing that happened to somebody.
 *
 * Different from the driver totals, and more useful for deciding what to fix.
 * A term can accumulate a large point total by mildly irritating a great many
 * people, which is worth knowing but is not what anybody writes in to complain
 * about. This counts the members for whom a given term was *the* problem, which
 * is what the top of a support queue actually looks like.
 */
export interface ThemeCount {
  id: string;
  /** Members for whom this was their single heaviest deduction. */
  members: number;
  /** Of those, how many landed as detractors. */
  detractors: number;
}

function emptySegments(): Segments {
  return { scored: 0, promoters: 0, passives: 0, detractors: 0, nps: 0 };
}

function count(seg: Segments, s: ScoredMember) {
  seg.scored++;
  if (s.segment === "promoter") seg.promoters++;
  else if (s.segment === "passive") seg.passives++;
  else seg.detractors++;
}

function finish(seg: Segments) {
  if (seg.scored === 0) return;
  seg.nps =
    ((seg.promoters - seg.detractors) / seg.scored) * 100;
  // One decimal. A modelled figure quoted to four places is claiming a
  // precision the model does not have.
  seg.nps = Math.round(seg.nps * 10) / 10;
}

/**
 * An accumulator, so the whole population never has to be in memory at once.
 *
 * Replay streams claims member by member and can feed answers in one at a time;
 * materialising a hundred thousand scored objects to then reduce them would
 * double the peak for no reason.
 */
export class ReadingAccumulator {
  private census = emptySegments();
  private surveyed = emptySegments();
  private histogram = new Array<number>(11).fill(0);
  private driverMembers = new Map<string, number>();
  private driverPoints = new Map<string, number>();
  private themeMembers = new Map<string, number>();
  private themeDetractors = new Map<string, number>();
  private excluded = 0;

  add(exp: MemberExperience): ScoredMember | null {
    if (exp.totalClaims === 0) {
      this.excluded++;
      return null;
    }

    const scored = scoreMember(exp);
    count(this.census, scored);
    this.histogram[scored.score]++;

    if (wouldRespond(scored.memberId, scored.score)) {
      count(this.surveyed, scored);
    }

    for (const term of scored.applied) {
      this.driverMembers.set(term.id, (this.driverMembers.get(term.id) ?? 0) + 1);
      this.driverPoints.set(
        term.id,
        (this.driverPoints.get(term.id) ?? 0) + term.points,
      );
    }

    const worst = worstTerm(scored.applied);
    if (worst) {
      this.themeMembers.set(worst.id, (this.themeMembers.get(worst.id) ?? 0) + 1);
      if (scored.segment === "detractor") {
        this.themeDetractors.set(
          worst.id,
          (this.themeDetractors.get(worst.id) ?? 0) + 1,
        );
      }
    }

    return scored;
  }

  result(): NpsReading {
    finish(this.census);
    finish(this.surveyed);

    const drivers: DriverTotal[] = [...this.driverPoints.entries()]
      .map(([id, totalPoints]) => ({
        id,
        membersAffected: this.driverMembers.get(id) ?? 0,
        totalPoints: Math.round(totalPoints * 10) / 10,
      }))
      // Heaviest damage first, which is the order somebody trying to fix the
      // benefit wants to read them in.
      .sort((a, b) => a.totalPoints - b.totalPoints);

    const themes: ThemeCount[] = [...this.themeMembers.entries()]
      .map(([id, members]) => ({
        id,
        members,
        detractors: this.themeDetractors.get(id) ?? 0,
      }))
      .sort((a, b) => b.members - a.members);

    return {
      census: this.census,
      surveyed: this.surveyed,
      histogram: this.histogram,
      drivers,
      themes,
      excluded: this.excluded,
    };
  }
}

export function readingFrom(experiences: MemberExperience[]): NpsReading {
  const acc = new ReadingAccumulator();
  for (const exp of experiences) acc.add(exp);
  return acc.result();
}
