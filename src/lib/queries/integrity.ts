import { prisma } from "@/lib/db";
import {
  DETECTORS,
  runAllDetectors,
  storedIntegritySignalsAreCurrent,
  type DetectorSpec,
  type DetectedSignal,
  type EvidenceRow,
} from "@/lib/integrity/detectors";
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

function signalKey(detectorId: string, subjectId: string): string {
  return `${detectorId}::${subjectId}`;
}

function toSignalRow(
  r: {
    id: string;
    detectorId: string;
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
    evidenceJson: string;
    seededCase: string | null;
  },
  byId: Map<string, DetectorSpec>,
): SignalRow | null {
  const detector = byId.get(r.detectorId);
  if (!detector) return null;
  return {
    id: r.id,
    detector,
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
  };
}

function detectedToSignalRow(
  d: DetectedSignal,
  id: string,
  seededCase: string | null,
  byId: Map<string, DetectorSpec>,
): SignalRow | null {
  const detector = byId.get(d.detectorId);
  if (!detector) return null;
  return {
    id,
    detector,
    subjectType: d.subjectType,
    subjectId: d.subjectId,
    subjectLabel: d.subjectLabel,
    severity: d.severity,
    score: d.score,
    observed: d.observed,
    peerMedian: d.peerMedian,
    peerP95: d.peerP95,
    claimCount: d.claimCount,
    exposureCents: d.exposureCents,
    windowStart: d.windowStart,
    windowEnd: d.windowEnd,
    evidence: d.evidence,
    seededCase,
  };
}

function summarize(signals: SignalRow[], claimsScreened: number, members: number, prescribers: number, pharmacies: number): IntegrityOverview {
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
    claimsScreened,
    membersScreened: members,
    prescribersScreened: prescribers,
    pharmaciesScreened: pharmacies,
    plantedFound: planted.length,
    plantedTotal: 5,
  };
}

export async function getIntegrityOverview(
  clock: SimulationClock,
): Promise<IntegrityOverview> {
  const byId = new Map(DETECTORS.map((d) => [d.id, d]));

  const [stored, counts] = await Promise.all([
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
      FROM Claim
      WHERE responseStatus = 'P' AND transactionCode = 'B1'
        AND dateOfService <= ${clock.now}
    `,
  ]);

  const c = counts[0];
  const claimsScreened = Number(c?.claims ?? 0);
  const membersScreened = Number(c?.members ?? 0);
  const prescribersScreened = Number(c?.prescribers ?? 0);
  const pharmaciesScreened = Number(c?.pharmacies ?? 0);

  const maxWindowEnd =
    stored.length === 0
      ? null
      : stored.reduce(
          (max, r) => (r.windowEnd > max ? r.windowEnd : max),
          stored[0].windowEnd,
        );

  /*
   * Seed writes IntegritySignal against the full plan year. claimsScreened is
   * already cut at the clock. Until every stored window has closed, reading the
   * table would report future exposure next to a partial denominator — so
   * re-score with the same as-of cut the claim count uses.
   */
  if (storedIntegritySignalsAreCurrent(clock.now, maxWindowEnd)) {
    const signals = stored
      .map((r) => toSignalRow(r, byId))
      .filter((s): s is SignalRow => s !== null);
    return summarize(
      signals,
      claimsScreened,
      membersScreened,
      prescribersScreened,
      pharmaciesScreened,
    );
  }

  const detected = await runAllDetectors(prisma, { asOf: clock.now });
  const plantedByKey = new Map(
    stored
      .filter((r) => r.seededCase !== null)
      .map((r) => [signalKey(r.detectorId, r.subjectId), r] as const),
  );
  const idByKey = new Map(
    stored.map((r) => [signalKey(r.detectorId, r.subjectId), r.id] as const),
  );

  const signals = detected
    .map((d, i) => {
      const key = signalKey(d.detectorId, d.subjectId);
      const planted = plantedByKey.get(key);
      return detectedToSignalRow(
        d,
        idByKey.get(key) ?? `asof-${String(i + 1).padStart(6, "0")}`,
        planted?.seededCase ?? null,
        byId,
      );
    })
    .filter((s): s is SignalRow => s !== null)
    .sort((a, b) => b.score - a.score);

  return summarize(
    signals,
    claimsScreened,
    membersScreened,
    prescribersScreened,
    pharmaciesScreened,
  );
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
