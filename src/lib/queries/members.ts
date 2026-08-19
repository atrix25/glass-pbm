import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";

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

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * A search term as a LIKE pattern.
 *
 * The term is bound as a parameter, so quoting is not the concern; the
 * wildcards are. Left unescaped, a term of `%` matches every member and a
 * typed `_` silently matches any character, which reads as a broken search.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
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
  // Paging comes off a query string, so it is coerced to a whole number in a
  // sane range rather than trusted: a non-numeric page would otherwise reach
  // SQLite as `OFFSET NaN`, and an unbounded page size is a way to ask for the
  // whole membership in one request.
  const perPage = clampInt(opts.perPage, 30, 1, 200);
  const page = clampInt(opts.page, 1, 1, 1_000_000);
  const q = opts.q?.trim() ?? "";
  const like = `%${escapeLike(q)}%`;
  // One of two fixed clauses, chosen here. ORDER BY cannot be a bound
  // parameter, so the only safe form is a value that never comes from input.
  const orderBy =
    opts.sort === "name" ? "m.lastName ASC, m.firstName ASC" : "billedCents DESC";

  const where = q
    ? `WHERE (m.lastName LIKE ? ESCAPE '\\' OR m.firstName LIKE ? ESCAPE '\\' OR m.cardholderId LIKE ? ESCAPE '\\')`
    : "";
  const likeParams = q ? [like, like, like] : [];

  const day = clock.today.getTime();

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `
    SELECT m.id, m.firstName, m.lastName, m.cardholderId, m.personCode, m.city,
           COALESCE(bp.name, 'IYC Health Plan') AS planName,
           SUM(CASE WHEN c.responseStatus = 'P' THEN 1 ELSE 0 END) AS claims,
           SUM(CASE WHEN c.responseStatus = 'R' THEN 1 ELSE 0 END) AS rejects,
           COALESCE(SUM(c.totalBilledCents), 0) AS billedCents,
           COALESCE(SUM(c.patientPayCents), 0)  AS memberPaidCents
    FROM Member m
    LEFT JOIN Claim c ON c.memberId = m.id AND c.dateOfService <= ?
    LEFT JOIN EligibilitySpan es ON es.memberId = m.id
    LEFT JOIN BenefitPlan bp ON bp.id = es.benefitPlanId
    ${where}
    GROUP BY m.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `,
    day,
    ...likeParams,
    perPage,
    (page - 1) * perPage,
  );

  const [countRow] = await prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
    `SELECT COUNT(*) AS n FROM Member m ${where}`,
    ...likeParams,
  );
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
  claims: { dateOfService: Date; patientPayCents: number; formularyLevel: string | null; responseStatus: string }[],
) {
  let rx = 0;
  let federal = 0;
  return claims
    .filter((c) => c.responseStatus === "P")
    .map((c) => {
      const countsToRx = ["1", "2"].includes(c.formularyLevel ?? "");
      if (countsToRx) rx += c.patientPayCents;
      federal += c.patientPayCents;
      return {
        date: c.dateOfService.toISOString().slice(0, 10),
        rxOopCents: rx,
        federalOopCents: federal,
      };
    });
}
