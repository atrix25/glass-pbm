import { prisma } from "@/lib/db";
import { DETECTORS, type DetectorSpec, type EvidenceRow } from "@/lib/integrity/detectors";
import type { SimulationClock } from "@/lib/clock";

export interface SignalRow {
  id: string;
  detector: DetectorSpec;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  severity: string;
  score: number;
  observed: number;
  peerMedian: number;
  peerP95: number;
  claimCount: number;
  exposureCents: number;
  windowStart: Date;
  windowEnd: Date;
  evidence: EvidenceRow[];
  seededCase: string | null;
}

export interface IntegrityOverview {
  signals: SignalRow[];
  bySeverity: { high: number; elevated: number; watch: number };
  totalExposureCents: number;
  claimsScreened: number;
  membersScreened: number;
  prescribersScreened: number;
  pharmaciesScreened: number;
  /** Planted cases and whether the detectors surfaced them unaided. */
  plantedFound: number;
  plantedTotal: number;
}

export async function getIntegrityOverview(
  clock: SimulationClock,
): Promise<IntegrityOverview> {
  const [rows, counts] = await Promise.all([
    prisma.integritySignal.findMany({ orderBy: { score: "desc" } }),
    prisma.$queryRaw<
      Array<{
        claims: number;
        members: number;
        prescribers: number;
        pharmacies: number;
      }>
    >`
      SELECT COUNT(*) AS claims,
             COUNT(DISTINCT memberId) AS members,
             COUNT(DISTINCT prescriberNpi) AS prescribers,
             COUNT(DISTINCT pharmacyId) AS pharmacies
      FROM Claim c
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND NOT EXISTS (
          SELECT 1 FROM Claim r
          WHERE r.reversalOfClaimId = c.id
            AND r.transactionCode = 'B2'
        )
        AND c.dateOfService <= ${clock.now}
    `,
  ]);

  const byId = new Map(DETECTORS.map((d) => [d.id, d]));
  const signals: SignalRow[] = rows
    .filter((r) => byId.has(r.detectorId))
    .map((r) => ({
      id: r.id,
      detector: byId.get(r.detectorId)!,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      subjectLabel: r.subjectLabel,
      severity: r.severity,
      score: r.score,
      observed: r.observed,
      peerMedian: r.peerMedian,
      peerP95: r.peerP95,
      claimCount: r.claimCount,
      exposureCents: r.exposureCents,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      evidence: JSON.parse(r.evidenceJson) as EvidenceRow[],
      seededCase: r.seededCase,
    }));

  const c = counts[0];
  const planted = signals.filter((s) => s.seededCase !== null);

  return {
    signals,
    bySeverity: {
      high: signals.filter((s) => s.severity === "High").length,
      elevated: signals.filter((s) => s.severity === "Elevated").length,
      watch: signals.filter((s) => s.severity === "Watch").length,
    },
    totalExposureCents: signals
      .filter((s) => s.severity !== "Watch")
      .reduce((sum, s) => sum + s.exposureCents, 0),
    claimsScreened: Number(c?.claims ?? 0),
    membersScreened: Number(c?.members ?? 0),
    prescribersScreened: Number(c?.prescribers ?? 0),
    pharmaciesScreened: Number(c?.pharmacies ?? 0),
    plantedFound: planted.length,
    plantedTotal: 5,
  };
}

export function formatObserved(detector: DetectorSpec, value: number): string {
  switch (detector.format) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "mme":
      return `${Math.round(value)} MME`;
    case "currency":
      return `$${(value / 100).toFixed(2)}`;
    default:
      return Math.round(value).toLocaleString();
  }
}
