import { prisma } from "@/lib/db";

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

export async function getBookTotals(): Promise<BookTotals> {
  const [row] = await prisma.$queryRaw<
    Array<Record<string, number | bigint | null>>
  >`
    SELECT
      COUNT(*)                                                   AS claimsSubmitted,
      SUM(CASE WHEN responseStatus = 'P' THEN 1 ELSE 0 END)      AS claimsPaid,
      SUM(CASE WHEN responseStatus = 'R' THEN 1 ELSE 0 END)      AS claimsRejected,
      SUM(totalBilledCents)                                      AS totalBilledCents,
      SUM(planPaidCents)                                         AS planPaidCents,
      SUM(patientPayCents)                                       AS memberPaidCents,
      SUM(pharmacyPaidCents)                                     AS pharmacyPaidCents,
      SUM(estimatedRebateCents)                                  AS rebateCents,
      SUM(COALESCE(nadacTotalCents, 0))                          AS nadacTotalCents,
      SUM(billedDispensingFeeCents)                              AS dispensingFeeCents,
      SUM(totalBilledCents - totalAllowedCents)                  AS spreadCents,
      SUM(CASE WHEN responseStatus = 'P' AND brandGenericClass = 'Generic' THEN 1 ELSE 0 END) AS genericClaims,
      SUM(CASE WHEN responseStatus = 'P' AND brandGenericClass = 'Brand'   THEN 1 ELSE 0 END) AS brandClaims,
      SUM(CASE WHEN responseStatus = 'P' AND isSpecialtyClaim = 1 THEN 1 ELSE 0 END)          AS specialtyClaims,
      SUM(CASE WHEN isSpecialtyClaim = 1 THEN totalBilledCents ELSE 0 END)                    AS specialtyBilledCents
    FROM Claim
  `;
  const members = await prisma.member.count();
  const n = (v: unknown) => Number(v ?? 0);
  return {
    members,
    claimsSubmitted: n(row.claimsSubmitted),
    claimsPaid: n(row.claimsPaid),
    claimsRejected: n(row.claimsRejected),
    totalBilledCents: n(row.totalBilledCents),
    planPaidCents: n(row.planPaidCents),
    memberPaidCents: n(row.memberPaidCents),
    pharmacyPaidCents: n(row.pharmacyPaidCents),
    rebateCents: n(row.rebateCents),
    nadacTotalCents: n(row.nadacTotalCents),
    dispensingFeeCents: n(row.dispensingFeeCents),
    spreadCents: n(row.spreadCents),
    genericClaims: n(row.genericClaims),
    brandClaims: n(row.brandClaims),
    specialtyClaims: n(row.specialtyClaims),
    specialtyBilledCents: n(row.specialtyBilledCents),
  };
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

export async function getChannelMix(): Promise<ChannelRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT channel,
           COUNT(*)                        AS claims,
           SUM(totalBilledCents)           AS billedCents,
           SUM(planPaidCents)              AS planPaidCents,
           SUM(patientPayCents)            AS memberPaidCents,
           SUM(billedDispensingFeeCents)   AS dispensingFeeCents,
           SUM(COALESCE(nadacTotalCents,0))AS nadacCents
    FROM Claim
    WHERE responseStatus = 'P'
    GROUP BY channel
    ORDER BY SUM(totalBilledCents) DESC
  `;
  return rows.map((r) => ({
    channel: String(r.channel),
    claims: Number(r.claims ?? 0),
    billedCents: Number(r.billedCents ?? 0),
    planPaidCents: Number(r.planPaidCents ?? 0),
    memberPaidCents: Number(r.memberPaidCents ?? 0),
    dispensingFeeCents: Number(r.dispensingFeeCents ?? 0),
    nadacCents: Number(r.nadacCents ?? 0),
  }));
}

export interface LevelRow {
  level: string;
  claims: number;
  billedCents: number;
  memberPaidCents: number;
}

export async function getLevelMix(): Promise<LevelRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COALESCE(formularyLevel, 'n/a') AS level,
           COUNT(*)                        AS claims,
           SUM(totalBilledCents)           AS billedCents,
           SUM(patientPayCents)            AS memberPaidCents
    FROM Claim
    WHERE responseStatus = 'P'
    GROUP BY COALESCE(formularyLevel, 'n/a')
    ORDER BY level
  `;
  return rows.map((r) => ({
    level: String(r.level),
    claims: Number(r.claims ?? 0),
    billedCents: Number(r.billedCents ?? 0),
    memberPaidCents: Number(r.memberPaidCents ?? 0),
  }));
}

export interface MonthPoint {
  month: string;
  claims: number;
  planPaidCents: number;
  memberPaidCents: number;
  rebateCents: number;
}

export async function getMonthlyTrend(): Promise<MonthPoint[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT strftime('%Y-%m', dateOfService / 1000, 'unixepoch') AS month,
           COUNT(*)                     AS claims,
           SUM(planPaidCents)           AS planPaidCents,
           SUM(patientPayCents)         AS memberPaidCents,
           SUM(estimatedRebateCents)    AS rebateCents
    FROM Claim
    WHERE responseStatus = 'P'
    GROUP BY month
    ORDER BY month
  `;
  return rows.map((r) => ({
    month: String(r.month),
    claims: Number(r.claims ?? 0),
    planPaidCents: Number(r.planPaidCents ?? 0),
    memberPaidCents: Number(r.memberPaidCents ?? 0),
    rebateCents: Number(r.rebateCents ?? 0),
  }));
}

export interface RejectRow {
  code: string;
  message: string;
  claims: number;
  members: number;
}

export async function getRejectMix(): Promise<RejectRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT rejectCodes                AS code,
           rejectMessage              AS message,
           COUNT(*)                   AS claims,
           COUNT(DISTINCT memberId)   AS members
    FROM Claim
    WHERE responseStatus = 'R'
    GROUP BY rejectCodes
    ORDER BY claims DESC
  `;
  return rows.map((r) => {
    let code = String(r.code ?? "[]");
    try {
      const parsed = JSON.parse(code) as string[];
      code = parsed[0] ?? code;
    } catch {
      /* leave raw */
    }
    return {
      code,
      message: String(r.message ?? "").replace(/\.\s*Eligible.*$/, ""),
      claims: Number(r.claims ?? 0),
      members: Number(r.members ?? 0),
    };
  });
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

export async function getTopDrugs(limit = 12): Promise<TopDrugRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT c.drugId                     AS drugId,
           d.name                       AS name,
           d.therapeuticClass           AS therapeuticClass,
           d.isSpecialty                AS isSpecialty,
           COUNT(*)                     AS claims,
           SUM(c.totalBilledCents)      AS billedCents,
           SUM(c.patientPayCents)       AS memberPaidCents,
           SUM(c.estimatedRebateCents)  AS rebateCents
    FROM Claim c
    JOIN Drug d ON d.id = c.drugId
    WHERE c.responseStatus = 'P'
    GROUP BY c.drugId
    ORDER BY billedCents DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    drugId: String(r.drugId),
    name: String(r.name),
    therapeuticClass: r.therapeuticClass ? String(r.therapeuticClass) : null,
    isSpecialty: Boolean(Number(r.isSpecialty ?? 0)),
    claims: Number(r.claims ?? 0),
    billedCents: Number(r.billedCents ?? 0),
    memberPaidCents: Number(r.memberPaidCents ?? 0),
    rebateCents: Number(r.rebateCents ?? 0),
  }));
}

export interface ClassRow {
  therapeuticClass: string;
  claims: number;
  billedCents: number;
}

export async function getTopClasses(limit = 8): Promise<ClassRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COALESCE(d.therapeuticClass, 'Unclassified') AS therapeuticClass,
           COUNT(*)                                     AS claims,
           SUM(c.totalBilledCents)                      AS billedCents
    FROM Claim c
    JOIN Drug d ON d.id = c.drugId
    WHERE c.responseStatus = 'P'
    GROUP BY COALESCE(d.therapeuticClass, 'Unclassified')
    ORDER BY billedCents DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    therapeuticClass: String(r.therapeuticClass),
    claims: Number(r.claims ?? 0),
    billedCents: Number(r.billedCents ?? 0),
  }));
}

/** Which arm of the lesser-of actually won, across the book. */
export interface BasisRow {
  basis: string;
  claims: number;
  billedCents: number;
}

export async function getBasisMix(): Promise<BasisRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COALESCE(basisOfReimbursement, 'n/a') AS basis,
           COUNT(*)                              AS claims,
           SUM(totalBilledCents)                 AS billedCents
    FROM Claim
    WHERE responseStatus = 'P'
    GROUP BY COALESCE(basisOfReimbursement, 'n/a')
    ORDER BY claims DESC
  `;
  return rows.map((r) => ({
    basis: String(r.basis),
    claims: Number(r.claims ?? 0),
    billedCents: Number(r.billedCents ?? 0),
  }));
}
