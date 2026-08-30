import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import {
  countsTowardRxOop,
  parseRxOopEligibleLevels,
} from "@/lib/rx-oop";

export interface MemberListRow {
  id: string;
  firstName: string;
  lastName: string;
  cardholderId: string;
  personCode: string;
  city: string | null;
  planName: string;
  claims: number;
  billedCents: number;
  memberPaidCents: number;
  rejects: number;
  isDemo: boolean;
}

/** The membership directory, with each member's book as of the clock. */
export async function listMembers(
  opts: {
    q?: string;
    page?: number;
    perPage?: number;
    sort?: "spend" | "name";
  },
  clock: SimulationClock,
): Promise<{ rows: MemberListRow[]; total: number; pages: number; page: number }> {
  const perPage = opts.perPage ?? 30;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim() ?? "";
  const like = `%${q.replace(/['%_]/g, "")}%`;
  const orderBy =
    opts.sort === "name" ? "m.lastName ASC, m.firstName ASC" : "billedCents DESC";

  const where = q
    ? `WHERE (m.lastName LIKE '${like}' OR m.firstName LIKE '${like}' OR m.cardholderId LIKE '${like}')`
    : "";

  const dayIso = clock.today.toISOString();

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT m.id, m.firstName, m.lastName, m.cardholderId, m.personCode, m.city,
           MAX(COALESCE(bp.name, 'IYC Health Plan')) AS planName,
           SUM(CASE WHEN c.responseStatus = 'P' THEN 1 ELSE 0 END) AS claims,
           SUM(CASE WHEN c.responseStatus = 'R' THEN 1 ELSE 0 END) AS rejects,
           COALESCE(SUM(c.totalBilledCents), 0) AS billedCents,
           COALESCE(SUM(c.patientPayCents), 0)  AS memberPaidCents
    FROM Member m
    LEFT JOIN Claim c ON c.memberId = m.id AND c.dateOfService <= '${dayIso}'
    LEFT JOIN EligibilitySpan es ON es.memberId = m.id
    LEFT JOIN BenefitPlan bp ON bp.id = es.benefitPlanId
    ${where}
    GROUP BY m.id, m.firstName, m.lastName, m.cardholderId, m.personCode, m.city
    ORDER BY ${orderBy}
    LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
  `);

  const [countRow] = await prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(`
    SELECT COUNT(*) AS n FROM Member m ${where}
  `);
  const total = Number(countRow?.n ?? 0);

  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      firstName: String(r.firstName),
      lastName: String(r.lastName),
      cardholderId: String(r.cardholderId),
      personCode: String(r.personCode),
      city: r.city ? String(r.city) : null,
      planName: String(r.planName),
      claims: Number(r.claims ?? 0),
      rejects: Number(r.rejects ?? 0),
      billedCents: Number(r.billedCents ?? 0),
      memberPaidCents: Number(r.memberPaidCents ?? 0),
      isDemo: String(r.id).includes("DEMO"),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function getMemberDetail(id: string) {
  return prisma.member.findUnique({
    where: { id },
    include: {
      sponsor: true,
      eligibilitySpans: { include: { benefitPlan: true } },
      accumulators: true,
      priorAuths: {
        include: { drug: true, tree: true },
        orderBy: { receivedAt: "desc" },
      },
    },
  });
}

export async function getMemberClaims(memberId: string) {
  return prisma.claim.findMany({
    where: { memberId },
    select: {
      id: true,
      claimNumber: true,
      dateOfService: true,
      responseStatus: true,
      rejectCodes: true,
      rejectMessage: true,
      channel: true,
      formularyLevel: true,
      totalBilledCents: true,
      planPaidCents: true,
      patientPayCents: true,
      estimatedRebateCents: true,
      nadacTotalCents: true,
      daysSupply: true,
      quantityDispensed: true,
      basisOfReimbursement: true,
      drug: { select: { id: true, name: true, isSpecialty: true } },
      pharmacy: { select: { id: true, name: true } },
    },
    orderBy: { dateOfService: "asc" },
  });
}

/** Running out-of-pocket by fill, so the cap is visible as a line that flattens. */
export function buildOopCurve(
  claims: {
    dateOfService: Date;
    patientPayCents: number;
    formularyLevel: string | null;
    responseStatus: string;
  }[],
  /**
   * Levels that credit the prescription OOP limit for this member's plan.
   * Pass the parsed BenefitPlan.rxOopEligibleLevels; defaults to IYC [1, 2].
   */
  rxOopEligibleLevels?: readonly string[],
) {
  const eligible = rxOopEligibleLevels
    ? [...rxOopEligibleLevels]
    : parseRxOopEligibleLevels(undefined);
  let rx = 0;
  let federal = 0;
  return claims
    .filter((c) => c.responseStatus === "P")
    .map((c) => {
      if (countsTowardRxOop(c.formularyLevel, eligible)) {
        rx += c.patientPayCents;
      }
      federal += c.patientPayCents;
      return {
        date: c.dateOfService.toISOString().slice(0, 10),
        rxOopCents: rx,
        federalOopCents: federal,
      };
    });
}

/** Sum of paid patient pay that credits the prescription OOP limit. */
export function sumRxOopCents(
  claims: { patientPayCents: number; formularyLevel: string | null; responseStatus?: string }[],
  rxOopEligibleLevels: readonly string[],
): number {
  return claims
    .filter((c) => c.responseStatus === undefined || c.responseStatus === "P")
    .filter((c) => countsTowardRxOop(c.formularyLevel, rxOopEligibleLevels))
    .reduce((s, c) => s + c.patientPayCents, 0);
}
