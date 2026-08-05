/**
 * The eligibility feed, and what it costs when it is wrong.
 *
 * Membership is the input every other number in this application depends on.
 * A claim priced perfectly for somebody who is not covered is not a correct
 * claim, and no amount of pricing sophistication downstream repairs a feed
 * that arrives late or arrives broken. This is the file inbox, the instructions
 * inside those files, the ones that could not be applied, and the gap between
 * what the sponsor believes about its population and what the processor has.
 *
 * Every status here is derived from the simulation clock rather than stored,
 * for the same reason the settlement statuses are: a file scheduled for next
 * Monday is scheduled until next Monday arrives, and nothing has to be
 * re-seeded for that to become true.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";

const DAY_MS = 86_400_000;

export interface FeedFile {
  id: string;
  controlNumber: string;
  fileType: string;
  createdAt: Date;
  receivedAt: Date;
  processedAt: Date;
  status: "Processed" | "In processing" | "Scheduled";
  recordCount: number;
  addCount: number;
  changeCount: number;
  termCount: number;
  rejectCount: number;
  /** Hours between the sponsor cutting the file and the plan applying it. */
  turnaroundHours: number;
}

export interface FeedOverview {
  livesOnFile: number;
  filesReceived: number;
  transactionsApplied: number;
  adds: number;
  changes: number;
  terms: number;
  rejected: number;
  openRejects: number;
  resolvedRejects: number;
  medianTurnaroundHours: number;
  files: FeedFile[];
}

function statusOf(
  file: { receivedAt: Date; processedAt: Date },
  now: Date,
): FeedFile["status"] {
  if (file.receivedAt > now) return "Scheduled";
  if (file.processedAt > now) return "In processing";
  return "Processed";
}

export async function getFeedOverview(
  clock: SimulationClock,
): Promise<FeedOverview> {
  const now = clock.now;

  const fileRows = await prisma.eligibilityFile.findMany({
    orderBy: { receivedAt: "desc" },
  });
  const arrived = fileRows.filter((f) => f.receivedAt <= now);
  const processed = fileRows.filter((f) => f.processedAt <= now);

  const [applied, rejects, lives] = await Promise.all([
    prisma.eligibilityTransaction.groupBy({
      by: ["maintenanceType"],
      where: {
        status: "Applied",
        file: { processedAt: { lte: now } },
      },
      _count: true,
    }),
    prisma.eligibilityTransaction.findMany({
      where: { status: "Rejected", file: { processedAt: { lte: now } } },
      select: { resolvedAt: true },
    }),
    prisma.eligibilitySpan.count({
      where: {
        effectiveDate: { lte: now },
        OR: [{ terminationDate: null }, { terminationDate: { gte: now } }],
      },
    }),
  ]);

  const count = (type: string) =>
    applied.find((a) => a.maintenanceType === type)?._count ?? 0;

  const turnarounds = processed
    .map((f) => (f.processedAt.getTime() - f.createdAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);

  return {
    livesOnFile: lives,
    filesReceived: arrived.length,
    transactionsApplied: applied.reduce((s, a) => s + a._count, 0),
    adds: count("021"),
    changes: count("001"),
    terms: count("024"),
    rejected: rejects.length,
    openRejects: rejects.filter((r) => !r.resolvedAt || r.resolvedAt > now)
      .length,
    resolvedRejects: rejects.filter((r) => r.resolvedAt && r.resolvedAt <= now)
      .length,
    medianTurnaroundHours: Math.round(
      turnarounds[Math.floor(turnarounds.length / 2)] ?? 0,
    ),
    files: arrived.slice(0, 14).map((f) => ({
      id: f.id,
      controlNumber: f.controlNumber,
      fileType: f.fileType,
      createdAt: f.createdAt,
      receivedAt: f.receivedAt,
      processedAt: f.processedAt,
      status: statusOf(f, now),
      recordCount: f.recordCount,
      addCount: f.addCount,
      changeCount: f.changeCount,
      termCount: f.termCount,
      rejectCount: f.rejectCount,
      turnaroundHours: Math.round(
        (f.processedAt.getTime() - f.createdAt.getTime()) / 3_600_000,
      ),
    })),
  };
}

export interface RejectRow {
  id: string;
  fileControlNumber: string;
  receivedAt: Date;
  maintenanceType: string;
  cardholderId: string;
  personCode: string;
  memberName: string;
  rejectCode: string;
  rejectReason: string;
  /** Days the instruction has been sitting unapplied, as of the clock. */
  ageDays: number;
  resolvedAfterDays: number | null;
  resolution: string | null;
}

export interface RejectOverview {
  open: RejectRow[];
  openCount: number;
  /** Open rejects grouped by how long they have been waiting. */
  aging: { bucket: string; count: number }[];
  reasons: { code: string; reason: string; count: number; open: number }[];
  medianResolutionDays: number;
}

export async function getRejectOverview(
  clock: SimulationClock,
): Promise<RejectOverview> {
  const now = clock.now;

  const rows = await prisma.eligibilityTransaction.findMany({
    where: { status: "Rejected", file: { processedAt: { lte: now } } },
    select: {
      id: true,
      maintenanceType: true,
      cardholderId: true,
      personCode: true,
      memberName: true,
      rejectCode: true,
      rejectReason: true,
      resolvedAt: true,
      resolution: true,
      file: { select: { controlNumber: true, receivedAt: true } },
    },
  });

  /*
   * A rejection closes when the correction is applied or the sponsor withdraws
   * it, and neither has happened until the clock reaches that date. Before
   * then it is an open item, whatever the record eventually says about it.
   */
  const enriched: RejectRow[] = rows.map((r) => {
    const closedAt = r.resolvedAt && r.resolvedAt <= now ? r.resolvedAt : null;
    return {
      id: r.id,
      fileControlNumber: r.file.controlNumber,
      receivedAt: r.file.receivedAt,
      maintenanceType: r.maintenanceType,
      cardholderId: r.cardholderId,
      personCode: r.personCode,
      memberName: r.memberName,
      rejectCode: r.rejectCode ?? "",
      rejectReason: r.rejectReason ?? "",
      ageDays: Math.floor(
        ((closedAt ?? now).getTime() - r.file.receivedAt.getTime()) / DAY_MS,
      ),
      resolvedAfterDays: closedAt
        ? Math.floor((closedAt.getTime() - r.file.receivedAt.getTime()) / DAY_MS)
        : null,
      resolution: closedAt ? r.resolution : null,
    };
  });

  const open = enriched.filter((r) => r.resolvedAfterDays === null);
  const closed = enriched
    .map((r) => r.resolvedAfterDays)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);

  const buckets = [
    { bucket: "Under 7 days", test: (d: number) => d < 7 },
    { bucket: "7 to 30 days", test: (d: number) => d >= 7 && d < 30 },
    { bucket: "30 to 90 days", test: (d: number) => d >= 30 && d < 90 },
    { bucket: "Over 90 days", test: (d: number) => d >= 90 },
  ];

  const byCode = new Map<string, { reason: string; count: number; open: number }>();
  for (const r of enriched) {
    const entry = byCode.get(r.rejectCode) ?? {
      reason: r.rejectReason,
      count: 0,
      open: 0,
    };
    entry.count++;
    if (r.resolvedAfterDays === null) entry.open++;
    byCode.set(r.rejectCode, entry);
  }

  // A worklist leads with what has been waiting longest.
  open.sort((a, b) => b.ageDays - a.ageDays);

  return {
    open: open.slice(0, 12),
    openCount: open.length,
    aging: buckets.map((b) => ({
      bucket: b.bucket,
      count: open.filter((r) => b.test(r.ageDays)).length,
    })),
    reasons: Array.from(byCode.entries())
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.count - a.count),
    medianResolutionDays: closed[Math.floor(closed.length / 2)] ?? 0,
  };
}

/**
 * One instruction, with everything the renderer needs to rebuild its segments.
 *
 * A termination is chosen where one exists, because the segment worth reading
 * is the one that ends somebody's coverage: it is a dozen characters in a text
 * file, and it is the difference between a claim paying and rejecting.
 */
export async function getSampleTransaction(clock: SimulationClock) {
  const where = {
    status: "Applied",
    memberId: { not: null },
    file: { processedAt: { lte: clock.now } },
  } as const;

  const row =
    (await prisma.eligibilityTransaction.findFirst({
      where: { ...where, maintenanceType: "024" },
      orderBy: { file: { receivedAt: "desc" } },
      include: { file: true },
    })) ??
    (await prisma.eligibilityTransaction.findFirst({
      where,
      orderBy: { file: { receivedAt: "desc" } },
      include: { file: true },
    }));
  if (!row) return null;

  const member = row.memberId
    ? await prisma.member.findUnique({
        where: { id: row.memberId },
        select: { dateOfBirth: true, gender: true },
      })
    : null;

  return { transaction: row, file: row.file, member };
}

export interface AuditFinding {
  controlNumber: string;
  processedAt: Date;
  restatedLives: number;
  /** Terminations the sponsor never sent, which the restatement exposed. */
  terminationsFound: number;
  /** Days between the coverage ending and the audit noticing. */
  medianLagDays: number;
  claimsAfterTermination: number;
  recoverableCents: number;
}

/**
 * What the monthly restatement caught.
 *
 * A change file can only tell you about changes the sponsor knew to send. The
 * audit is the only mechanism that finds the ones it did not: the member is
 * simply absent from the roster, and their absence is the notice. This is
 * where the recovery worklist on the reversals page comes from, and the link
 * matters — the money is recoverable because of a process, not because
 * somebody noticed.
 */
export async function getAuditFindings(
  clock: SimulationClock,
): Promise<AuditFinding[]> {
  const now = clock.now;

  const audits = await prisma.eligibilityFile.findMany({
    where: { fileType: "Full audit", processedAt: { lte: now } },
    orderBy: { processedAt: "desc" },
    take: 6,
  });
  if (audits.length === 0) return [];

  const findings: AuditFinding[] = [];
  for (const audit of audits) {
    const terms = await prisma.eligibilityTransaction.findMany({
      where: { fileId: audit.id, maintenanceType: "024", status: "Applied" },
      select: { terminationDate: true },
    });
    if (terms.length === 0) continue;

    const lags = terms
      .filter((t) => t.terminationDate)
      .map((t) =>
        Math.floor(
          (audit.processedAt.getTime() - t.terminationDate!.getTime()) / DAY_MS,
        ),
      )
      .sort((a, b) => a - b);

    /*
     * The exposure is the claims that fall after the termination this audit
     * reported. The spans carry the date the plan learned, which the feed sets
     * to the audit that found them, so the two join on that instant rather
     * than on a list of member identifiers.
     */
    const [exposure] = await prisma.$queryRaw<
      Array<{ n: number; cents: number | null }>
    >`
      SELECT COUNT(*) AS n, SUM(c.planPaidCents) AS cents
      FROM Claim c
      JOIN EligibilitySpan e ON e.memberId = c.memberId
      WHERE c.responseStatus = 'P'
        AND c.transactionCode = 'B1'
        AND e.retroReportedAt = ${audit.processedAt}
        AND e.reportedTerminationDate IS NOT NULL
        AND c.dateOfService > e.reportedTerminationDate
    `;

    findings.push({
      controlNumber: audit.controlNumber,
      processedAt: audit.processedAt,
      restatedLives: audit.recordCount,
      terminationsFound: terms.length,
      medianLagDays: lags[Math.floor(lags.length / 2)] ?? 0,
      claimsAfterTermination: Number(exposure?.n ?? 0),
      recoverableCents: Number(exposure?.cents ?? 0),
    });
  }
  return findings;
}
