import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

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

function buildWhere(f: ClaimFilters): Prisma.ClaimWhereInput {
  const where: Prisma.ClaimWhereInput = {};
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

export async function listClaims(f: ClaimFilters) {
  const perPage = f.perPage ?? 40;
  const page = Math.max(1, f.page ?? 1);
  const where = buildWhere(f);

  const [rows, total, sums] = await Promise.all([
    prisma.claim.findMany({
      where,
      select: CLAIM_LIST_SELECT,
      orderBy: [{ dateOfService: "desc" }, { claimNumber: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
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
    rows,
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
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
