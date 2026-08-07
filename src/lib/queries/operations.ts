/**
 * The book as of now.
 *
 * Every figure here is cut against the simulation clock, because the seeded
 * plan year runs to December and most of it has not happened yet. Reading the
 * whole table would report a finished year and make the plan look like a
 * completed report rather than a live one.
 *
 * Claim totals come from the daily rollup rather than from the claims
 * themselves. At this volume summing sixteen hundred thousand rows per page
 * load is not viable, and the rollup is a pure sum of claim columns that the
 * invariant suite checks against the underlying claims.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { PLAN_YEAR_START } from "@/lib/clock";
import { IN_FLIGHT_STATUSES, paLiveState, type PaLiveStatus } from "@/lib/pa/status";
import { DEFAULT_BOOK } from "@/lib/book-context";

export interface DayActivity {
  date: Date;
  claimsSubmitted: number;
  claimsPaid: number;
  claimsRejected: number;
  totalBilledCents: number;
  planPaidCents: number;
  patientPayCents: number;
  membersFilling: number;
  specialtyClaims: number;
  specialtyBilledCents: number;
  genericClaims: number;
  brandClaims: number;
}

export interface OperationsSnapshot {
  today: DayActivity | null;
  yesterday: DayActivity | null;
  /** Trailing days, oldest first, for the activity chart. */
  recent: DayActivity[];
  yearToDate: {
    claimsSubmitted: number;
    claimsPaid: number;
    claimsRejected: number;
    totalBilledCents: number;
    planPaidCents: number;
    patientPayCents: number;
    estimatedRebateCents: number;
    genericClaims: number;
    brandClaims: number;
    specialtyClaims: number;
    specialtyBilledCents: number;
    daysElapsed: number;
  };
  membership: {
    lives: number;
    contracts: number;
  };
}

function toActivity(r: {
  date: Date;
  claimsSubmitted: number;
  claimsPaid: number;
  claimsRejected: number;
  totalBilledCents: number;
  planPaidCents: number;
  patientPayCents: number;
  membersFilling: number;
  specialtyClaims: number;
  specialtyBilledCents: number;
  genericClaims: number;
  brandClaims: number;
}): DayActivity {
  return { ...r };
}

export async function getOperationsSnapshot(
  clock: SimulationClock,
  sponsorId: string = DEFAULT_BOOK.sponsorId,
): Promise<OperationsSnapshot> {
  const RECENT_DAYS = 30;
  const recentFrom = new Date(
    clock.today.getTime() - (RECENT_DAYS - 1) * 86_400_000,
  );

  const [days, ytd, lives, contracts] = await Promise.all([
    prisma.bookDay.findMany({
      where: {
        sponsorId,
        date: { gte: recentFrom, lte: clock.today },
      },
      orderBy: { date: "asc" },
    }),
    prisma.bookDay.aggregate({
      where: {
        sponsorId,
        date: { gte: PLAN_YEAR_START, lte: clock.today },
      },
      _sum: {
        claimsSubmitted: true,
        claimsPaid: true,
        claimsRejected: true,
        totalBilledCents: true,
        planPaidCents: true,
        patientPayCents: true,
        estimatedRebateCents: true,
        genericClaims: true,
        brandClaims: true,
        specialtyClaims: true,
        specialtyBilledCents: true,
      },
      _count: true,
    }),
    prisma.member.count({ where: { sponsorId } }),
    prisma.member.count({ where: { sponsorId, personCode: "01" } }),
  ]);

  const recent = days.map(toActivity);
  const todayKey = clock.today.getTime();
  const yesterdayKey = todayKey - 86_400_000;

  return {
    today: recent.find((d) => d.date.getTime() === todayKey) ?? null,
    yesterday: recent.find((d) => d.date.getTime() === yesterdayKey) ?? null,
    recent,
    yearToDate: {
      claimsSubmitted: ytd._sum.claimsSubmitted ?? 0,
      claimsPaid: ytd._sum.claimsPaid ?? 0,
      claimsRejected: ytd._sum.claimsRejected ?? 0,
      totalBilledCents: ytd._sum.totalBilledCents ?? 0,
      planPaidCents: ytd._sum.planPaidCents ?? 0,
      patientPayCents: ytd._sum.patientPayCents ?? 0,
      estimatedRebateCents: ytd._sum.estimatedRebateCents ?? 0,
      genericClaims: ytd._sum.genericClaims ?? 0,
      brandClaims: ytd._sum.brandClaims ?? 0,
      specialtyClaims: ytd._sum.specialtyClaims ?? 0,
      specialtyBilledCents: ytd._sum.specialtyBilledCents ?? 0,
      daysElapsed: ytd._count,
    },
    membership: { lives, contracts },
  };
}

// ---------------------------------------------------------------------------
// Prior authorization queue
// ---------------------------------------------------------------------------

export interface QueueItem {
  id: string;
  paNumber: string;
  memberId: string;
  memberName: string;
  drugName: string;
  isSpecialty: boolean;
  treeName: string | null;
  urgency: string;
  status: PaLiveStatus;
  inFlight: boolean;
  msToDue: number | null;
  ageMs: number;
  breached: boolean;
  receivedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decidingStepNumber: number | null;
  denyReason: string | null;
  stepCount: number;
}

const QUEUE_SELECT = {
  id: true,
  paNumber: true,
  memberId: true,
  urgency: true,
  receivedAt: true,
  decisionDueAt: true,
  decidedAt: true,
  prescriberStatementAt: true,
  determination: true,
  decidedBy: true,
  decidingStepNumber: true,
  denyReason: true,
  member: { select: { firstName: true, lastName: true } },
  drug: { select: { name: true, isSpecialty: true } },
  tree: { select: { name: true } },
  _count: { select: { decisionSteps: true } },
} as const;

type QueueRow = {
  id: string;
  paNumber: string;
  memberId: string;
  urgency: string;
  receivedAt: Date;
  decisionDueAt: Date | null;
  decidedAt: Date | null;
  prescriberStatementAt: Date | null;
  determination: string | null;
  decidedBy: string | null;
  decidingStepNumber: number | null;
  denyReason: string | null;
  member: { firstName: string; lastName: string };
  drug: { name: string; isSpecialty: boolean };
  tree: { name: string } | null;
  _count: { decisionSteps: number };
};

function toQueueItem(r: QueueRow, now: Date): QueueItem {
  const live = paLiveState(r, now);
  return {
    id: r.id,
    paNumber: r.paNumber,
    memberId: r.memberId,
    memberName: `${r.member.firstName} ${r.member.lastName}`,
    drugName: r.drug.name,
    isSpecialty: r.drug.isSpecialty,
    treeName: r.tree?.name ?? null,
    urgency: r.urgency,
    status: live.status,
    inFlight: live.inFlight,
    msToDue: live.msToDue,
    ageMs: live.ageMs,
    breached: live.breached,
    receivedAt: r.receivedAt,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
    decidingStepNumber: r.decidingStepNumber,
    denyReason: r.denyReason,
    stepCount: r._count.decisionSteps,
  };
}

/**
 * Requests that are open at this instant.
 *
 * "Open" is received on or before now and decided after it, which is a range
 * query rather than a status lookup. The window is bounded because a request
 * that arrived weeks ago and is still undecided does not exist in this book.
 */
export async function getInFlightPriorAuths(
  clock: SimulationClock,
  limit = 60,
): Promise<QueueItem[]> {
  const rows = await prisma.priorAuthorization.findMany({
    where: {
      receivedAt: { lte: clock.now },
      OR: [{ decidedAt: null }, { decidedAt: { gt: clock.now } }],
    },
    select: QUEUE_SELECT,
    orderBy: { decisionDueAt: "asc" },
    take: limit,
  });

  return rows
    .map((r) => toQueueItem(r, clock.now))
    .filter((i) => IN_FLIGHT_STATUSES.includes(i.status));
}

/** Requests decided in the trailing window, most recent first. */
export async function getRecentlyDecidedPriorAuths(
  clock: SimulationClock,
  hours = 72,
  limit = 60,
): Promise<QueueItem[]> {
  const from = new Date(clock.now.getTime() - hours * 3_600_000);
  const rows = await prisma.priorAuthorization.findMany({
    where: { decidedAt: { gte: from, lte: clock.now } },
    select: QUEUE_SELECT,
    orderBy: { decidedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => toQueueItem(r, clock.now));
}

export interface PaQueueStats {
  inFlight: number;
  pendedForInformation: number;
  breached: number;
  expeditedInFlight: number;
  decidedToday: number;
  approvedToday: number;
  deniedToday: number;
  receivedToday: number;
  /** Decided year to date, and how many of those the engine could cite. */
  decidedYtd: number;
  citedYtd: number;
  medianDecisionMs: number | null;
}

export async function getPaQueueStats(
  clock: SimulationClock,
): Promise<PaQueueStats> {
  const [openRows, todayRows, ytd, cited, sample] = await Promise.all([
    prisma.priorAuthorization.findMany({
      where: {
        receivedAt: { lte: clock.now },
        OR: [{ decidedAt: null }, { decidedAt: { gt: clock.now } }],
      },
      select: {
        receivedAt: true,
        decisionDueAt: true,
        decidedAt: true,
        prescriberStatementAt: true,
        determination: true,
        urgency: true,
      },
    }),
    prisma.priorAuthorization.findMany({
      where: {
        OR: [
          { decidedAt: { gte: clock.today, lte: clock.now } },
          { receivedAt: { gte: clock.today, lte: clock.now } },
        ],
      },
      select: { receivedAt: true, decidedAt: true, determination: true },
    }),
    prisma.priorAuthorization.count({
      where: { decidedAt: { lte: clock.now } },
    }),
    prisma.priorAuthorization.count({
      where: { decidedAt: { lte: clock.now }, treeId: { not: null } },
    }),
    prisma.priorAuthorization.findMany({
      where: { decidedAt: { lte: clock.now } },
      select: { receivedAt: true, decidedAt: true },
      orderBy: { decidedAt: "desc" },
      take: 500,
    }),
  ]);

  let inFlight = 0;
  let pended = 0;
  let breached = 0;
  let expedited = 0;
  for (const r of openRows) {
    const live = paLiveState(r, clock.now);
    if (!live.inFlight) continue;
    inFlight++;
    if (live.status === "PendingInfo") pended++;
    if (live.breached) breached++;
    if (r.urgency === "Expedited") expedited++;
  }

  let decidedToday = 0;
  let approvedToday = 0;
  let deniedToday = 0;
  let receivedToday = 0;
  for (const r of todayRows) {
    if (r.receivedAt >= clock.today && r.receivedAt <= clock.now) receivedToday++;
    if (r.decidedAt && r.decidedAt >= clock.today && r.decidedAt <= clock.now) {
      decidedToday++;
      if (r.determination === "Denied") deniedToday++;
      else approvedToday++;
    }
  }

  const durations = sample
    .filter((r) => r.decidedAt)
    .map((r) => r.decidedAt!.getTime() - r.receivedAt.getTime())
    .sort((a, b) => a - b);

  return {
    inFlight,
    pendedForInformation: pended,
    breached,
    expeditedInFlight: expedited,
    decidedToday,
    approvedToday,
    deniedToday,
    receivedToday,
    decidedYtd: ytd,
    citedYtd: cited,
    medianDecisionMs:
      durations.length > 0 ? durations[Math.floor(durations.length / 2)] : null,
  };
}

/**
 * The most recent claims to hit the processor, newest first.
 *
 * This is the closest thing the application has to a tape: the last few
 * hundred fills that actually adjudicated, in the order they arrived.
 */
export async function getRecentClaims(
  clock: SimulationClock,
  limit = 40,
  sponsorId: string = DEFAULT_BOOK.sponsorId,
) {
  return prisma.claim.findMany({
    where: {
      sponsorId,
      dateOfService: { lte: clock.today },
    },
    select: {
      id: true,
      claimNumber: true,
      dateOfService: true,
      responseStatus: true,
      rejectCodes: true,
      rejectMessage: true,
      totalBilledCents: true,
      planPaidCents: true,
      patientPayCents: true,
      isSpecialtyClaim: true,
      channel: true,
      formularyLevel: true,
      member: { select: { id: true, firstName: true, lastName: true } },
      drug: { select: { name: true } },
      pharmacy: { select: { name: true } },
    },
    orderBy: [{ dateOfService: "desc" }, { claimNumber: "desc" }],
    take: limit,
  });
}
