/**
 * The plan sponsor's view of the book, as of the simulation clock.
 *
 * These read the daily rollup rather than the claim table. At a hundred
 * thousand lives the book is over a million and a half claims, and the eight
 * group-bys this dashboard needs would each be a full scan. Every figure here
 * is still a sum of claim columns — the rollup adds no facts, and the
 * invariant suite checks it against the claims it summarises — but the sum was
 * done once at seed time instead of once per page load.
 *
 * Cutting at the clock is not an optimisation, it is the point: the plan year
 * is seeded through December and most of it has not happened yet.
 */

import { prisma } from "@/lib/db";
import { PLAN_YEAR_START, type SimulationClock } from "@/lib/clock";

export const PLAN_YEAR = 2026;

export interface BookTotals {
  members: number;
  claimsSubmitted: number;
  claimsPaid: number;
  claimsRejected: number;
  totalBilledCents: number;
  planPaidCents: number;
  memberPaidCents: number;
  pharmacyPaidCents: number;
  rebateCents: number;
  nadacTotalCents: number;
  dispensingFeeCents: number;
  spreadCents: number;
  genericClaims: number;
  brandClaims: number;
  specialtyClaims: number;
  specialtyBilledCents: number;
}

function window(clock: SimulationClock) {
  return { gte: PLAN_YEAR_START, lte: clock.today };
}

export async function getBookTotals(
  clock: SimulationClock,
): Promise<BookTotals> {
  const [agg, dims, members] = await Promise.all([
    prisma.bookDay.aggregate({
      where: { date: window(clock) },
      _sum: {
        claimsSubmitted: true,
        claimsPaid: true,
        claimsRejected: true,
        totalBilledCents: true,
        planPaidCents: true,
        patientPayCents: true,
        pharmacyPaidCents: true,
        estimatedRebateCents: true,
        genericClaims: true,
        brandClaims: true,
        specialtyClaims: true,
        specialtyBilledCents: true,
      },
    }),
    /*
     * NADAC, dispensing fees and the billed-to-allowed spread are not on the
     * daily row because they are only meaningful cut by something. Summing one
     * dimension recovers the book total, and channel is the cheapest: four
     * keys a day rather than several hundred.
     */
    prisma.bookDayDimension.aggregate({
      where: { dimension: "channel", date: window(clock) },
      _sum: {
        nadacCents: true,
        dispensingFeeCents: true,
        billedCents: true,
        allowedCents: true,
      },
    }),
    prisma.member.count(),
  ]);

  const s = agg._sum;
  const d = dims._sum;
  return {
    members,
    claimsSubmitted: s.claimsSubmitted ?? 0,
    claimsPaid: s.claimsPaid ?? 0,
    claimsRejected: s.claimsRejected ?? 0,
    totalBilledCents: s.totalBilledCents ?? 0,
    planPaidCents: s.planPaidCents ?? 0,
    memberPaidCents: s.patientPayCents ?? 0,
    pharmacyPaidCents: s.pharmacyPaidCents ?? 0,
    rebateCents: s.estimatedRebateCents ?? 0,
    nadacTotalCents: d.nadacCents ?? 0,
    dispensingFeeCents: d.dispensingFeeCents ?? 0,
    spreadCents: (d.billedCents ?? 0) - (d.allowedCents ?? 0),
    genericClaims: s.genericClaims ?? 0,
    brandClaims: s.brandClaims ?? 0,
    specialtyClaims: s.specialtyClaims ?? 0,
    specialtyBilledCents: s.specialtyBilledCents ?? 0,
  };
}

/** Roll one dimension of the daily cube up to the clock. */
async function rollup(
  clock: SimulationClock,
  dimension: string,
): Promise<
  Array<{
    key: string;
    claims: number;
    billedCents: number;
    planPaidCents: number;
    memberPaidCents: number;
    rebateCents: number;
    nadacCents: number;
    dispensingFeeCents: number;
  }>
> {
  const rows = await prisma.bookDayDimension.groupBy({
    by: ["key"],
    where: { dimension, date: window(clock) },
    _sum: {
      claims: true,
      billedCents: true,
      planPaidCents: true,
      memberPaidCents: true,
      rebateCents: true,
      nadacCents: true,
      dispensingFeeCents: true,
    },
  });
  return rows.map((r) => ({
    key: r.key,
    claims: r._sum.claims ?? 0,
    billedCents: r._sum.billedCents ?? 0,
    planPaidCents: r._sum.planPaidCents ?? 0,
    memberPaidCents: r._sum.memberPaidCents ?? 0,
    rebateCents: r._sum.rebateCents ?? 0,
    nadacCents: r._sum.nadacCents ?? 0,
    dispensingFeeCents: r._sum.dispensingFeeCents ?? 0,
  }));
}

export interface ChannelRow {
  channel: string;
  claims: number;
  billedCents: number;
  planPaidCents: number;
  memberPaidCents: number;
  dispensingFeeCents: number;
  nadacCents: number;
}

export async function getChannelMix(
  clock: SimulationClock,
): Promise<ChannelRow[]> {
  const rows = await rollup(clock, "channel");
  return rows
    .map((r) => ({ channel: r.key, ...r }))
    .sort((a, b) => b.billedCents - a.billedCents);
}

export interface LevelRow {
  level: string;
  claims: number;
  billedCents: number;
  memberPaidCents: number;
}

export async function getLevelMix(
  clock: SimulationClock,
): Promise<LevelRow[]> {
  const rows = await rollup(clock, "level");
  return rows
    .map((r) => ({
      level: r.key,
      claims: r.claims,
      billedCents: r.billedCents,
      memberPaidCents: r.memberPaidCents,
    }))
    .sort((a, b) => a.level.localeCompare(b.level));
}

export interface MonthPoint {
  month: string;
  claims: number;
  planPaidCents: number;
  memberPaidCents: number;
  rebateCents: number;
}

export async function getMonthlyTrend(
  clock: SimulationClock,
): Promise<MonthPoint[]> {
  const days = await prisma.bookDay.findMany({
    where: { date: window(clock) },
    select: {
      date: true,
      claimsPaid: true,
      planPaidCents: true,
      patientPayCents: true,
      estimatedRebateCents: true,
    },
    orderBy: { date: "asc" },
  });

  const byMonth = new Map<string, MonthPoint>();
  for (const d of days) {
    const month = d.date.toISOString().slice(0, 7);
    const p = byMonth.get(month) ?? {
      month,
      claims: 0,
      planPaidCents: 0,
      memberPaidCents: 0,
      rebateCents: 0,
    };
    p.claims += d.claimsPaid;
    p.planPaidCents += d.planPaidCents;
    p.memberPaidCents += d.patientPayCents;
    p.rebateCents += d.estimatedRebateCents;
    byMonth.set(month, p);
  }
  return [...byMonth.values()];
}

export interface RejectRow {
  code: string;
  message: string;
  claims: number;
  members: number;
}

/**
 * Reject mix, with the distinct members behind each code.
 *
 * The member count cannot come from the rollup: distinct members per day do
 * not add up across days. It is counted from the claims, which is affordable
 * because rejects are a small share of the book and the index on
 * responseStatus keeps the scan to them.
 */
export async function getRejectMix(
  clock: SimulationClock,
): Promise<RejectRow[]> {
  const [rolled, detail] = await Promise.all([
    rollup(clock, "reject"),
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT rejectCodes              AS code,
             MAX(rejectMessage)       AS message,
             COUNT(DISTINCT memberId) AS members
      FROM Claim
      WHERE responseStatus = 'R' AND dateOfService <= ${clock.today}
      GROUP BY rejectCodes
    `,
  ]);

  const meta = new Map<string, { message: string; members: number }>();
  for (const r of detail) {
    let code = String(r.code ?? "[]");
    try {
      code = (JSON.parse(code) as string[])[0] ?? code;
    } catch {
      /* leave raw */
    }
    const existing = meta.get(code);
    meta.set(code, {
      message: existing?.message ?? String(r.message ?? ""),
      members: (existing?.members ?? 0) + Number(r.members ?? 0),
    });
  }

  return rolled
    .map((r) => ({
      code: r.key,
      message: (meta.get(r.key)?.message ?? "").replace(/\.\s*Eligible.*$/, ""),
      claims: r.claims,
      members: meta.get(r.key)?.members ?? 0,
    }))
    .sort((a, b) => b.claims - a.claims);
}

export interface TopDrugRow {
  drugId: string;
  name: string;
  therapeuticClass: string | null;
  isSpecialty: boolean;
  claims: number;
  billedCents: number;
  memberPaidCents: number;
  rebateCents: number;
}

export async function getTopDrugs(
  clock: SimulationClock,
  limit = 12,
): Promise<TopDrugRow[]> {
  const rows = (await rollup(clock, "drug"))
    .sort((a, b) => b.billedCents - a.billedCents)
    .slice(0, limit);

  const drugs = await prisma.drug.findMany({
    where: { id: { in: rows.map((r) => r.key) } },
    select: {
      id: true,
      name: true,
      therapeuticClass: true,
      isSpecialty: true,
    },
  });
  const byId = new Map(drugs.map((d) => [d.id, d]));

  return rows.map((r) => {
    const d = byId.get(r.key);
    return {
      drugId: r.key,
      name: d?.name ?? r.key,
      therapeuticClass: d?.therapeuticClass ?? null,
      isSpecialty: d?.isSpecialty ?? false,
      claims: r.claims,
      billedCents: r.billedCents,
      memberPaidCents: r.memberPaidCents,
      rebateCents: r.rebateCents,
    };
  });
}

export interface ClassRow {
  therapeuticClass: string;
  claims: number;
  billedCents: number;
}

export async function getTopClasses(
  clock: SimulationClock,
  limit = 8,
): Promise<ClassRow[]> {
  return (await rollup(clock, "class"))
    .map((r) => ({
      therapeuticClass: r.key,
      claims: r.claims,
      billedCents: r.billedCents,
    }))
    .sort((a, b) => b.billedCents - a.billedCents)
    .slice(0, limit);
}

/** Which arm of the lesser-of actually won, across the book. */
export interface BasisRow {
  basis: string;
  claims: number;
  billedCents: number;
}

export async function getBasisMix(
  clock: SimulationClock,
): Promise<BasisRow[]> {
  return (await rollup(clock, "basis"))
    .map((r) => ({
      basis: r.key,
      claims: r.claims,
      billedCents: r.billedCents,
    }))
    .sort((a, b) => b.claims - a.claims);
}
