import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { PLAN_YEAR_START, type SimulationClock } from "@/lib/clock";
import { DEFAULT_BOOK } from "@/lib/book-context";

export interface ClaimFilters {
  q?: string;
  status?: string;
  channel?: string;
  level?: string;
  reject?: string;
  drug?: string;
  member?: string;
  scenario?: string;
  basis?: string;
  sponsorId?: string;
  page?: number;
  perPage?: number;
}

export const CLAIM_LIST_SELECT = {
  id: true,
  claimNumber: true,
  dateOfService: true,
  responseStatus: true,
  rejectCodes: true,
  rejectMessage: true,
  channel: true,
  formularyLevel: true,
  brandGenericClass: true,
  quantityDispensed: true,
  daysSupply: true,
  totalBilledCents: true,
  planPaidCents: true,
  patientPayCents: true,
  nadacTotalCents: true,
  basisOfReimbursement: true,
  estimatedRebateCents: true,
  awpIsSimulated: true,
  scenarioTag: true,
  dawCode: true,
  member: { select: { id: true, firstName: true, lastName: true, cardholderId: true } },
  drug: { select: { id: true, name: true, isSpecialty: true, therapeuticClass: true } },
  pharmacy: { select: { id: true, name: true, pharmacyType: true } },
} satisfies Prisma.ClaimSelect;

export type ClaimListRow = Prisma.ClaimGetPayload<{
  select: typeof CLAIM_LIST_SELECT;
}>;

/** True when nothing narrows the ledger beyond the clock. */
function isUnfiltered(f: ClaimFilters): boolean {
  return (
    !f.q &&
    (!f.status || f.status === "all") &&
    (!f.channel || f.channel === "all") &&
    (!f.level || f.level === "all") &&
    !f.reject &&
    !f.drug &&
    !f.member &&
    !f.scenario &&
    !f.basis
  );
}

function buildWhere(
  f: ClaimFilters,
  clock: SimulationClock,
): Prisma.ClaimWhereInput {
  // A claim dated after the simulation clock has not been submitted yet.
  const where: Prisma.ClaimWhereInput = {
    sponsorId: f.sponsorId ?? DEFAULT_BOOK.sponsorId,
    dateOfService: { lte: clock.today },
  };
  const and: Prisma.ClaimWhereInput[] = [];

  if (f.status && f.status !== "all") where.responseStatus = f.status;
  if (f.channel && f.channel !== "all") where.channel = f.channel;
  if (f.level && f.level !== "all") where.formularyLevel = f.level;
  if (f.drug) where.drugId = f.drug;
  if (f.member) where.memberId = f.member;
  if (f.scenario) where.scenarioTag = f.scenario;
  if (f.basis) where.basisOfReimbursement = f.basis;
  if (f.reject) and.push({ rejectCodes: { contains: `"${f.reject}"` } });

  if (f.q) {
    const q = f.q.trim();
    and.push({
      OR: [
        { claimNumber: { contains: q } },
        { rxNumber: { contains: q } },
        { drug: { name: { contains: q } } },
        { member: { lastName: { contains: q } } },
        { member: { firstName: { contains: q } } },
        { member: { cardholderId: { contains: q } } },
        { pharmacy: { name: { contains: q } } },
      ],
    });
  }

  if (and.length) where.AND = and;
  return where;
}

export async function listClaims(f: ClaimFilters, clock: SimulationClock) {
  const perPage = f.perPage ?? 40;
  const page = Math.max(1, f.page ?? 1);
  const sponsorId = f.sponsorId ?? DEFAULT_BOOK.sponsorId;
  const where = buildWhere({ ...f, sponsorId }, clock);

  const rows = await prisma.claim.findMany({
    where,
    select: CLAIM_LIST_SELECT,
    orderBy: [{ dateOfService: "desc" }, { claimNumber: "desc" }],
    skip: (page - 1) * perPage,
    take: perPage,
  });

  /*
   * The header totals over an unfiltered ledger are the whole book, and
   * counting a million and a half rows to display them would make the default
   * page load the slowest one in the application. That exact sum is already in
   * the daily rollup. Narrowed ledgers fall back to counting, over a set the
   * filter has already made small.
   */
  const totals = isUnfiltered(f)
    ? await totalsFromRollup(clock, sponsorId)
    : await totalsFromClaims(where);

  return {
    rows,
    total: totals.total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(totals.total / perPage)),
    sums: totals.sums,
  };
}

async function totalsFromRollup(clock: SimulationClock, sponsorId: string) {
  const [agg, nadac] = await Promise.all([
    prisma.bookDay.aggregate({
      where: {
        sponsorId,
        date: { gte: PLAN_YEAR_START, lte: clock.today },
      },
      _sum: {
        claimsSubmitted: true,
        totalBilledCents: true,
        planPaidCents: true,
        patientPayCents: true,
        estimatedRebateCents: true,
      },
    }),
    prisma.bookDayDimension.aggregate({
      where: {
        sponsorId,
        dimension: "channel",
        date: { gte: PLAN_YEAR_START, lte: clock.today },
      },
      _sum: { nadacCents: true },
    }),
  ]);
  return {
    total: agg._sum.claimsSubmitted ?? 0,
    sums: {
      totalBilledCents: agg._sum.totalBilledCents ?? 0,
      planPaidCents: agg._sum.planPaidCents ?? 0,
      patientPayCents: agg._sum.patientPayCents ?? 0,
      estimatedRebateCents: agg._sum.estimatedRebateCents ?? 0,
      nadacTotalCents: nadac._sum.nadacCents ?? 0,
    },
  };
}

async function totalsFromClaims(where: Prisma.ClaimWhereInput) {
  const [total, sums] = await Promise.all([
    prisma.claim.count({ where }),
    prisma.claim.aggregate({
      where,
      _sum: {
        totalBilledCents: true,
        planPaidCents: true,
        patientPayCents: true,
        estimatedRebateCents: true,
        nadacTotalCents: true,
      },
    }),
  ]);
  return {
    total,
    sums: {
      totalBilledCents: sums._sum.totalBilledCents ?? 0,
      planPaidCents: sums._sum.planPaidCents ?? 0,
      patientPayCents: sums._sum.patientPayCents ?? 0,
      estimatedRebateCents: sums._sum.estimatedRebateCents ?? 0,
      nadacTotalCents: sums._sum.nadacTotalCents ?? 0,
    },
  };
}

export async function getClaimDetail(idOrNumber: string) {
  return prisma.claim.findFirst({
    where: {
      OR: [{ id: idOrNumber }, { claimNumber: idOrNumber }],
    },
    include: {
      member: true,
      drug: { include: { prices: true } },
      pharmacy: true,
      benefitPlan: { include: { sponsor: true } },
      contract: true,
    },
  });
}

/** Prior and subsequent fills of the same prescription, for context. */
export async function getRelatedFills(memberId: string, drugId: string) {
  return prisma.claim.findMany({
    where: { memberId, drugId },
    select: {
      id: true,
      claimNumber: true,
      dateOfService: true,
      fillNumber: true,
      daysSupply: true,
      quantityDispensed: true,
      responseStatus: true,
      totalBilledCents: true,
      patientPayCents: true,
    },
    orderBy: { dateOfService: "asc" },
    take: 24,
  });
}
