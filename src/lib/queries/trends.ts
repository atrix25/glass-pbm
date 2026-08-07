/**
 * Pharmacy trend, and what is driving it.
 *
 * Trend is a rate of change, so it needs two periods. This book is a single
 * plan year, so the comparison is the most recent complete stretch of the year
 * against the equally long stretch before it, rather than the year-over-year
 * comparison a real renewal would use. That is the only honest comparison the
 * data supports, and it is stated on the page rather than hidden here.
 *
 * Two decisions about the windows matter for the answer:
 *
 *   - They end at the last *complete* day. The rollup row for the current day
 *     fills in as the simulation clock advances, so including it would compare
 *     a part-day against a whole one and read as a decline every morning.
 *
 *   - They are the same length. Comparing ninety days against a calendar
 *     quarter would fold the difference in length into the trend.
 *
 * Everything is expressed per member per month. Raw totals move with the size
 * of the window; PMPM is the figure a plan sponsor actually renews on.
 */

import { prisma } from "@/lib/db";
import { DAY_MS, PLAN_YEAR_START, type SimulationClock } from "@/lib/clock";
import { DEFAULT_BOOK } from "@/lib/book-context";

/** Longest comparison window worth using, in days. */
const MAX_WINDOW_DAYS = 90;
/** Below this, each side is too short for the comparison to mean anything. */
const MIN_WINDOW_DAYS = 14;
const DAYS_PER_MONTH = 365 / 12;

export interface TrendWindow {
  start: Date;
  end: Date;
  days: number;
}

export interface TrendPeriods {
  current: TrendWindow;
  prior: TrendWindow;
}

/**
 * The two windows to compare, or null when too little of the year has run.
 *
 * The window grows with the year until it reaches the cap, so the page works
 * at any clock position rather than only late in the year.
 */
export function trendPeriods(clock: SimulationClock): TrendPeriods | null {
  const lastComplete = new Date(clock.today.getTime() - DAY_MS);
  const elapsed =
    Math.floor((lastComplete.getTime() - PLAN_YEAR_START.getTime()) / DAY_MS) + 1;
  if (elapsed < MIN_WINDOW_DAYS * 2) return null;

  const days = Math.min(MAX_WINDOW_DAYS, Math.floor(elapsed / 2));
  const currentStart = new Date(lastComplete.getTime() - (days - 1) * DAY_MS);
  const priorEnd = new Date(currentStart.getTime() - DAY_MS);
  const priorStart = new Date(priorEnd.getTime() - (days - 1) * DAY_MS);

  return {
    current: { start: currentStart, end: lastComplete, days },
    prior: { start: priorStart, end: priorEnd, days },
  };
}

/** Everything the decomposition needs about one period. */
export interface PeriodMetrics {
  window: TrendWindow;
  memberMonths: number;
  scripts: number;
  billedCents: number;
  planPaidCents: number;
  memberPaidCents: number;
  rebateCents: number;
  /** Plan cost after rebates, per member per month. The headline figure. */
  netPmpmCents: number;
  grossPmpmCents: number;
  memberPmpmCents: number;
  rebatePmpmCents: number;
  /** Scripts per member per month. */
  utilization: number;
  /** Annualised scripts per member, which is how utilisation is usually quoted. */
  scriptsPerMemberYear: number;
  costPerScriptCents: number;
  genericRate: number;
  specialtyShareOfSpend: number;
  specialtyScripts: number;
}

export interface TrendDriver {
  key: string;
  label: string;
  note: string;
  /** Signed contribution to the change in net PMPM, in cents. */
  cents: number;
}

export interface TrendOverview {
  periods: TrendPeriods;
  members: number;
  sponsorId: string;
  current: PeriodMetrics;
  prior: PeriodMetrics;
  drivers: TrendDriver[];
  /** Change in net PMPM, in cents. The drivers sum to exactly this. */
  netChangeCents: number;
  netChangePct: number;
}

async function periodMetrics(
  window: TrendWindow,
  members: number,
  sponsorId: string,
): Promise<PeriodMetrics> {
  const agg = await prisma.bookDay.aggregate({
    where: {
      sponsorId,
      date: { gte: window.start, lte: window.end },
    },
    _sum: {
      claimsPaid: true,
      totalBilledCents: true,
      planPaidCents: true,
      patientPayCents: true,
      estimatedRebateCents: true,
      genericClaims: true,
      brandClaims: true,
      specialtyClaims: true,
      specialtyBilledCents: true,
    },
  });
  const s = agg._sum;
  const scripts = s.claimsPaid ?? 0;
  const billedCents = s.totalBilledCents ?? 0;
  const planPaidCents = s.planPaidCents ?? 0;
  const memberPaidCents = s.patientPayCents ?? 0;
  const rebateCents = s.estimatedRebateCents ?? 0;
  const generic = s.genericClaims ?? 0;
  const brand = s.brandClaims ?? 0;

  const memberMonths = (members * window.days) / DAYS_PER_MONTH;

  return {
    window,
    memberMonths,
    scripts,
    billedCents,
    planPaidCents,
    memberPaidCents,
    rebateCents,
    netPmpmCents: (planPaidCents - rebateCents) / memberMonths,
    grossPmpmCents: billedCents / memberMonths,
    memberPmpmCents: memberPaidCents / memberMonths,
    rebatePmpmCents: rebateCents / memberMonths,
    utilization: scripts / memberMonths,
    scriptsPerMemberYear: (scripts / memberMonths) * 12,
    costPerScriptCents: scripts === 0 ? 0 : billedCents / scripts,
    genericRate: generic + brand === 0 ? 0 : generic / (generic + brand),
    specialtyShareOfSpend:
      billedCents === 0 ? 0 : (s.specialtyBilledCents ?? 0) / billedCents,
    specialtyScripts: s.specialtyClaims ?? 0,
  };
}

/**
 * The headline trend and the bridge that explains it.
 *
 * Net plan cost per member per month is an identity:
 *
 *     net = utilisation x price per script - member share - rebates
 *
 * so the change in it decomposes exactly, with no residual, into the change in
 * each term holding the others at their prior value, plus the one cross term
 * between utilisation and price. The cross term is reported rather than
 * silently folded into one of its parents: when both utilisation and price
 * move it is real money, and attributing it to either alone overstates that
 * one's contribution.
 */
export async function getTrendOverview(
  clock: SimulationClock,
  sponsorId: string = DEFAULT_BOOK.sponsorId,
): Promise<TrendOverview | null> {
  const periods = trendPeriods(clock);
  if (!periods) return null;

  const members = await prisma.member.count({ where: { sponsorId } });
  const [current, prior] = await Promise.all([
    periodMetrics(periods.current, members, sponsorId),
    periodMetrics(periods.prior, members, sponsorId),
  ]);

  const dU = current.utilization - prior.utilization;
  const dP = current.costPerScriptCents - prior.costPerScriptCents;

  const drivers: TrendDriver[] = [
    {
      key: "utilization",
      label: "Utilisation",
      note: "More scripts per member, priced at the prior period's cost per script",
      cents: dU * prior.costPerScriptCents,
    },
    {
      key: "price",
      label: "Price per script",
      note: "A different cost per script, across the prior period's script count",
      cents: prior.utilization * dP,
    },
    {
      key: "mix",
      label: "Utilisation and price together",
      note: "The cross term: the extra scripts are not priced like the old ones",
      cents: dU * dP,
    },
    {
      key: "memberShare",
      label: "Member cost share",
      note: "What members paid at the counter, which the plan therefore did not",
      cents: -(current.memberPmpmCents - prior.memberPmpmCents),
    },
    {
      key: "rebates",
      label: "Rebates",
      note: "Manufacturer rebates earned, passed to the plan in full",
      cents: -(current.rebatePmpmCents - prior.rebatePmpmCents),
    },
  ];

  const netChangeCents = current.netPmpmCents - prior.netPmpmCents;

  return {
    periods,
    members,
    sponsorId,
    current,
    prior,
    drivers,
    netChangeCents,
    netChangePct:
      prior.netPmpmCents === 0 ? 0 : netChangeCents / prior.netPmpmCents,
  };
}

export interface DriverRow {
  key: string;
  label: string;
  sublabel?: string;
  priorPmpmCents: number;
  currentPmpmCents: number;
  changeCents: number;
  priorScripts: number;
  currentScripts: number;
  currentCostPerScriptCents: number;
}

/**
 * Net plan cost by rollup key, both periods, ranked by how much each moved.
 *
 * The denominator is the whole population in both periods, not the members who
 * happened to use that category, so the rows are additive: they sum to the
 * total change in net PMPM. A per-utiliser rate would read differently and
 * would not add up.
 */
async function dimensionDrivers(
  dimension: string,
  periods: TrendPeriods,
  memberMonths: number,
  sponsorId: string,
): Promise<DriverRow[]> {
  const cells = async (w: TrendWindow) =>
    prisma.bookDayDimension.groupBy({
      by: ["key"],
      where: {
        sponsorId,
        dimension,
        date: { gte: w.start, lte: w.end },
      },
      _sum: { claims: true, planPaidCents: true, rebateCents: true, billedCents: true },
    });

  const [prior, current] = await Promise.all([
    cells(periods.prior),
    cells(periods.current),
  ]);

  type Side = { net: number; scripts: number; billed: number };
  const blank = (): Side => ({ net: 0, scripts: 0, billed: 0 });
  const rows = new Map<string, { prior: Side; current: Side }>();

  const fold = (
    list: Awaited<ReturnType<typeof cells>>,
    side: "prior" | "current",
  ) => {
    for (const c of list) {
      const entry = rows.get(c.key) ?? { prior: blank(), current: blank() };
      entry[side] = {
        net: (c._sum.planPaidCents ?? 0) - (c._sum.rebateCents ?? 0),
        scripts: c._sum.claims ?? 0,
        billed: c._sum.billedCents ?? 0,
      };
      rows.set(c.key, entry);
    }
  };
  fold(prior, "prior");
  fold(current, "current");

  return [...rows.entries()]
    .map(([key, v]) => ({
      key,
      label: key,
      priorPmpmCents: v.prior.net / memberMonths,
      currentPmpmCents: v.current.net / memberMonths,
      changeCents: (v.current.net - v.prior.net) / memberMonths,
      priorScripts: v.prior.scripts,
      currentScripts: v.current.scripts,
      currentCostPerScriptCents:
        v.current.scripts === 0 ? 0 : v.current.billed / v.current.scripts,
    }))
    .sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents));
}

/** Therapeutic classes, ranked by contribution to the change in net PMPM. */
export async function getClassDrivers(
  overview: TrendOverview,
): Promise<DriverRow[]> {
  return dimensionDrivers(
    "class",
    overview.periods,
    overview.current.memberMonths,
    overview.sponsorId,
  );
}

/** Individual drugs, ranked the same way, with names resolved. */
export async function getDrugDrivers(
  overview: TrendOverview,
): Promise<DriverRow[]> {
  const rows = await dimensionDrivers(
    "drug",
    overview.periods,
    overview.current.memberMonths,
    overview.sponsorId,
  );
  const drugs = await prisma.drug.findMany({
    where: { id: { in: rows.slice(0, 40).map((r) => r.key) } },
    select: { id: true, name: true, therapeuticClass: true, isSpecialty: true },
  });
  const byId = new Map(drugs.map((d) => [d.id, d]));
  return rows.map((r) => {
    const d = byId.get(r.key);
    return {
      ...r,
      label: d?.name ?? r.key,
      sublabel: d?.isSpecialty
        ? `${d.therapeuticClass ?? "Unclassified"} · specialty`
        : (d?.therapeuticClass ?? undefined),
    };
  });
}

export interface RelationshipTrend {
  code: string;
  label: string;
  lives: number;
  priorPlanCents: number;
  currentPlanCents: number;
  priorScripts: number;
  currentScripts: number;
  /** Plan cost per covered life per month within this group. */
  priorPmpmCents: number;
  currentPmpmCents: number;
  changePct: number;
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  "1": "Employees",
  "2": "Spouses",
  "3": "Children",
};

/**
 * The same trend split into employees and their dependants.
 *
 * This is the one cut that has to go to the claim table: who a member is to the
 * employer is a property of the member, and the daily rollup is keyed by drug
 * and channel rather than by person. It is a covered join over one contiguous
 * date range, which the (memberId, dateOfService) index serves.
 *
 * PMPM here is per covered life *in that group*, not across the whole
 * population, because the question is which group costs more to cover. These
 * rates therefore do not add up to the plan's PMPM, and the page says so.
 */
export async function getRelationshipTrend(
  overview: TrendOverview,
): Promise<RelationshipTrend[]> {
  const { prior, current } = overview.periods;
  const sponsorId = overview.sponsorId;

  const [rows, lives] = await Promise.all([
    prisma.$queryRaw<
      Array<{ rel: string; period: string; scripts: bigint; plan: bigint }>
    >`
      SELECT m.relationshipCode AS rel,
             CASE WHEN c.dateOfService >= ${current.start} THEN 'current' ELSE 'prior' END AS period,
             COUNT(*) AS scripts,
             SUM(c.planPaidCents - c.estimatedRebateCents) AS plan
      FROM Claim c
      JOIN Member m ON m.id = c.memberId
      WHERE c.responseStatus = 'P'
        AND c.sponsorId = ${sponsorId}
        AND c.scenarioTag IS NULL
        AND c.dateOfService >= ${prior.start}
        AND c.dateOfService <= ${current.end}
      GROUP BY rel, period
    `,
    prisma.member.groupBy({
      by: ["relationshipCode"],
      where: { sponsorId },
      _count: true,
    }),
  ]);

  const livesBy = new Map(lives.map((l) => [l.relationshipCode, l._count]));
  const months = current.days / DAYS_PER_MONTH;

  return ["1", "2", "3"].map((code) => {
    const pick = (period: string) =>
      rows.find((r) => r.rel === code && r.period === period);
    const p = pick("prior");
    const c = pick("current");
    const covered = livesBy.get(code) ?? 0;
    const denom = covered * months;
    const priorPlanCents = Number(p?.plan ?? 0);
    const currentPlanCents = Number(c?.plan ?? 0);
    const priorPmpmCents = denom === 0 ? 0 : priorPlanCents / denom;
    const currentPmpmCents = denom === 0 ? 0 : currentPlanCents / denom;
    return {
      code,
      label: RELATIONSHIP_LABEL[code] ?? code,
      lives: covered,
      priorPlanCents,
      currentPlanCents,
      priorScripts: Number(p?.scripts ?? 0),
      currentScripts: Number(c?.scripts ?? 0),
      priorPmpmCents,
      currentPmpmCents,
      changePct:
        priorPmpmCents === 0
          ? 0
          : (currentPmpmCents - priorPmpmCents) / priorPmpmCents,
    };
  });
}

export interface ConcentrationBand {
  label: string;
  floorCents: number;
  priorMembers: number;
  currentMembers: number;
  priorPlanCents: number;
  currentPlanCents: number;
  currentShareOfSpend: number;
}

const BANDS: Array<{ label: string; floor: number }> = [
  { label: "$50,000 and over", floor: 5_000_000 },
  { label: "$10,000 to $50,000", floor: 1_000_000 },
  { label: "$2,500 to $10,000", floor: 250_000 },
  { label: "Under $2,500", floor: 0 },
];

/** Sentinel floor for the band of members who filled nothing at all. */
const NO_CLAIMS_FLOOR = -1;

/**
 * How concentrated the spend is in a small number of people.
 *
 * A plan sponsor cannot manage a trend that is really a handful of members on
 * specialty therapy the same way it manages one spread across the population,
 * so which of the two it is has to be visible before any of the driver tables
 * mean anything.
 */
export async function getCostConcentration(
  overview: TrendOverview,
): Promise<ConcentrationBand[]> {
  const { prior, current } = overview.periods;
  const enrolled = overview.members;
  const sponsorId = overview.sponsorId;

  const bucket = (w: TrendWindow) => prisma.$queryRaw<
    Array<{ floor: number; members: bigint; plan: bigint }>
  >`
    WITH per_member AS (
      SELECT memberId, SUM(planPaidCents - estimatedRebateCents) AS spend
      FROM Claim
      WHERE responseStatus = 'P'
        AND sponsorId = ${sponsorId}
        AND scenarioTag IS NULL
        AND dateOfService >= ${w.start} AND dateOfService <= ${w.end}
      GROUP BY memberId
    )
    SELECT CASE WHEN spend >= 5000000 THEN 5000000
                WHEN spend >= 1000000 THEN 1000000
                WHEN spend >=  250000 THEN  250000
                ELSE 0 END AS floor,
           COUNT(*)   AS members,
           SUM(spend) AS plan
    FROM per_member
    GROUP BY floor
  `;

  const [priorRows, currentRows] = await Promise.all([
    bucket(prior),
    bucket(current),
  ]);

  const totalCurrent = currentRows.reduce((a, r) => a + Number(r.plan), 0);
  const sum = (
    rows: Array<{ members: bigint }>,
  ) => rows.reduce((a, r) => a + Number(r.members), 0);

  // SQLite hands the CASE result back as a BigInt through the raw client, so
  // the band floors have to be compared as numbers rather than by identity.
  const banded = BANDS.map((b) => {
    const p = priorRows.find((r) => Number(r.floor) === b.floor);
    const c = currentRows.find((r) => Number(r.floor) === b.floor);
    const currentPlanCents = Number(c?.plan ?? 0);
    return {
      label: b.label,
      floorCents: b.floor,
      priorMembers: Number(p?.members ?? 0),
      currentMembers: Number(c?.members ?? 0),
      priorPlanCents: Number(p?.plan ?? 0),
      currentPlanCents,
      currentShareOfSpend:
        totalCurrent === 0 ? 0 : currentPlanCents / totalCurrent,
    };
  });

  /*
   * Members who filled nothing are a band too. Only utilisers appear in the
   * query above, so without this row the shares are taken against the people
   * who happened to use the benefit rather than against the people covered by
   * it, and a fifth of the population silently disappears from a table whose
   * whole subject is how few people the cost sits with.
   */
  return [
    ...banded,
    {
      label: "No paid claims",
      floorCents: NO_CLAIMS_FLOOR,
      priorMembers: Math.max(0, enrolled - sum(priorRows)),
      currentMembers: Math.max(0, enrolled - sum(currentRows)),
      priorPlanCents: 0,
      currentPlanCents: 0,
      currentShareOfSpend: 0,
    },
  ];
}

export interface MonthPoint {
  month: string;
  netPmpmCents: number;
  utilization: number;
  complete: boolean;
}

/**
 * Net PMPM by month, so the two comparison windows can be seen in context.
 *
 * Partial months are marked rather than dropped: the current month is always
 * partial, and January of a plan year is genuinely elevated because prevalent
 * therapy all refills at once when the year opens.
 */
export async function getMonthlyTrendLine(
  clock: SimulationClock,
  sponsorId: string = DEFAULT_BOOK.sponsorId,
): Promise<MonthPoint[]> {
  const days = await prisma.bookDay.findMany({
    where: {
      sponsorId,
      date: { gte: PLAN_YEAR_START, lte: clock.today },
    },
    orderBy: { date: "asc" },
    select: {
      date: true,
      claimsPaid: true,
      planPaidCents: true,
      estimatedRebateCents: true,
    },
  });
  const members = await prisma.member.count({ where: { sponsorId } });

  const byMonth = new Map<
    string,
    { days: number; net: number; scripts: number }
  >();
  for (const d of days) {
    const key = d.date.toISOString().slice(0, 7);
    const e = byMonth.get(key) ?? { days: 0, net: 0, scripts: 0 };
    e.days++;
    e.net += d.planPaidCents - d.estimatedRebateCents;
    e.scripts += d.claimsPaid;
    byMonth.set(key, e);
  }

  return [...byMonth.entries()].map(([month, e]) => {
    const memberMonths = (members * e.days) / DAYS_PER_MONTH;
    const daysInMonth = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    ).getUTCDate();
    return {
      month,
      netPmpmCents: e.net / memberMonths,
      utilization: e.scripts / memberMonths,
      complete: e.days >= daysInMonth,
    };
  });
}
