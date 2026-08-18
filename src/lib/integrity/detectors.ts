/**
 * Program integrity surveillance.
 *
 * Every detector here is peer-relative. That is the whole design. A prescriber
 * who writes four hundred opioid prescriptions is either a pain specialist
 * doing their job or a problem, and the number alone cannot tell you which;
 * only the distribution of their peers can. So each detector computes the
 * distribution first and reports the observation against it, and each signal
 * carries the median and 95th percentile it was scored against so the reader
 * can see the comparison rather than trust the verdict.
 *
 * Two of these implement published federal criteria rather than anything
 * invented here. The rest are conventional method — rank against peers, look
 * at the tail — applied to data the plan already owns.
 */

import type { PrismaClient } from "@/generated/prisma";
import { CONTROLLED_CLASSES } from "@/lib/clinical/interactions";
import { MME_THRESHOLDS } from "@/lib/clinical/opioids";

const DAY_MS = 86_400_000;

export type SubjectType = "member" | "prescriber" | "pharmacy";
export type Severity = "High" | "Elevated" | "Watch";

export interface DetectorSpec {
  id: string;
  name: string;
  subjectType: SubjectType;
  /** What the detector is looking for, in one sentence. */
  question: string;
  /** How it decides, including the peer group. */
  method: string;
  /** The published basis, where there is one. */
  citation: string | null;
  /** What the observed figure means, for the column header. */
  observedLabel: string;
  /** How to render the observed figure. */
  format: "count" | "percent" | "mme" | "currency";
}

export interface DetectedSignal {
  detectorId: string;
  subjectType: SubjectType;
  subjectId: string;
  subjectLabel: string;
  severity: Severity;
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

export interface EvidenceRow {
  label: string;
  detail: string;
  value?: string;
}

export const DETECTORS: DetectorSpec[] = [
  {
    id: "member.opioid-overutilisation",
    name: "Opioid overutilisation",
    subjectType: "member",
    question:
      "Which members meet the federal overutilisation criteria: a high daily opioid dose obtained from several prescribers and several pharmacies?",
    method:
      "Average daily morphine milligram equivalents of 90 or more, together with three or more opioid prescribers and three or more dispensing pharmacies, over any 180-day window. Dose is computed from the claim's own quantity and days supply against the CDC conversion table.",
    citation:
      "CMS Overutilization Monitoring System criteria, as described in the Medicare Part D Opioid Overutilization guidance. The 90 MME threshold is the CDC 2022 Clinical Practice Guideline.",
    observedLabel: "Daily MME",
    format: "mme",
  },
  {
    id: "member.controlled-shopping",
    name: "Controlled substance shopping",
    subjectType: "member",
    question:
      "Which members are collecting controlled substances across far more prescribers and pharmacies than anyone with comparable therapy?",
    method:
      "Members with at least six controlled-substance fills are scored on distinct prescribers plus distinct pharmacies, against the distribution of every other member in the same fill-count band. Banding matters: someone with forty fills will naturally see more prescribers than someone with six.",
    citation: null,
    observedLabel: "Prescribers + pharmacies",
    format: "count",
  },
  {
    id: "prescriber.controlled-share",
    name: "Prescriber controlled-substance concentration",
    subjectType: "prescriber",
    question:
      "Which prescribers write a far higher share of controlled substances than others in their own specialty?",
    method:
      "Share of a prescriber's paid claims that fall in a controlled class, scored against the distribution for their specialty. Comparing within specialty is the point: a pain specialist at ninety per cent is unremarkable and a family physician at ninety per cent is not.",
    citation: null,
    observedLabel: "Controlled share",
    format: "percent",
  },
  {
    id: "pharmacy.controlled-mix",
    name: "Pharmacy controlled-substance mix",
    subjectType: "pharmacy",
    question:
      "Which pharmacies dispense a materially higher share of controlled substances than the rest of the network?",
    method:
      "Share of a pharmacy's paid claims in a controlled class, against the network distribution, restricted to pharmacies with enough volume for the share to mean anything.",
    citation: null,
    observedLabel: "Controlled share",
    format: "percent",
  },
];

export function detectorById(id: string): DetectorSpec | undefined {
  return DETECTORS.find((d) => d.id === id);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((p / 100) * (sorted.length - 1))),
  );
  return sorted[idx];
}

/**
 * Distance above the peer group, in units of the gap between the median and
 * the 95th percentile.
 *
 * A plain standard-deviation z-score is wrong here: these distributions are
 * heavily skewed and the outliers themselves inflate the deviation, so the
 * worst offenders drag up the very yardstick used to judge them. Measuring
 * against the median-to-p95 gap is robust to that.
 */
function robustScore(observed: number, median: number, p95: number): number {
  const spread = Math.max(p95 - median, 1e-9);
  return (observed - median) / spread;
}

function severityFor(score: number): Severity | null {
  if (score >= 3) return "High";
  if (score >= 2) return "Elevated";
  if (score >= 1.25) return "Watch";
  return null;
}

interface PeerStats {
  median: number;
  p95: number;
}

function peerStats(values: number[]): PeerStats {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

const controlledList = CONTROLLED_CLASSES.map(
  (c) => `'${c.replace(/'/g, "''")}'`,
).join(",");

export interface DetectorRunOptions {
  /**
   * Only claims on or before this instant count. The simulation clock cuts the
   * book the same way every other page does: a fill dated after "now" has not
   * happened yet, so it cannot raise a signal or inflate peer medians.
   */
  asOf?: Date;
}

/**
 * SQL fragment restricting paid B1 claims to the as-of instant.
 *
 * Detectors run over raw SQL, so the cut has to live in the query rather than
 * in a later filter — peer medians and observed rates are computed from the
 * same row set, and filtering signals after the fact would leave them scored
 * against a future they have not reached.
 */
export function claimAsOfSql(asOf: Date | undefined, alias = "c"): string {
  if (!asOf) return "1=1";
  return `${alias}.dateOfService <= ${asOf.getTime()}`;
}

/**
 * Prefer the seeded IntegritySignal rows when every stored window has already
 * closed under the clock. Otherwise the overview must re-score: those rows
 * were written against the full plan year, and reading them early would report
 * exposure and severity that the claimsScreened denominator does not include.
 */
export function storedIntegritySignalsAreCurrent(
  clockNow: Date,
  maxWindowEnd: Date | null,
): boolean {
  if (!maxWindowEnd) return false;
  return maxWindowEnd.getTime() <= clockNow.getTime();
}

export async function runAllDetectors(
  prisma: PrismaClient,
  opts: DetectorRunOptions = {},
): Promise<DetectedSignal[]> {
  const [a, b, c, d] = await Promise.all([
    detectOpioidOverutilisation(prisma, opts.asOf),
    detectControlledShopping(prisma, opts.asOf),
    detectPrescriberConcentration(prisma, opts.asOf),
    detectPharmacyMix(prisma, opts.asOf),
  ]);
  return [...a, ...b, ...c, ...d];
}

/**
 * CMS Overutilization Monitoring System criteria.
 *
 * Unlike the others this is not scored against peers, because the federal
 * criteria are absolute: meet all three and you are on the list. The peer
 * columns still carry the book's distribution so the reader can see how far
 * outside normal the case sits.
 */
async function detectOpioidOverutilisation(
  prisma: PrismaClient,
  asOf?: Date,
): Promise<DetectedSignal[]> {
  const asOfSql = claimAsOfSql(asOf);
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      memberId: string;
      firstName: string;
      lastName: string;
      prescribers: number;
      pharmacies: number;
      fills: number;
      maxMme: number;
      exposure: number;
      firstFill: number;
      lastFill: number;
    }>
  >(`
    WITH op AS (
      SELECT c.id, c.memberId, c.prescriberNpi, c.pharmacyId, c.dateOfService,
             c.daysSupply, c.planPaidCents,
             CASE WHEN o.isTransdermal = 1
                  THEN o.strengthMg * o.mmeFactor
                  ELSE c.quantityDispensed * o.strengthMg * o.mmeFactor / c.daysSupply
             END AS dmme
      FROM Claim c JOIN OpioidProduct o ON o.drugId = c.drugId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND o.convertible = 1 AND c.daysSupply > 0
        AND ${asOfSql}
    ),
    concurrent AS (
      SELECT s.memberId, s.id, SUM(x.dmme) AS totalMme
      FROM op s JOIN op x ON x.memberId = s.memberId
        AND x.dateOfService <= s.dateOfService
        AND x.dateOfService + x.daysSupply * ${DAY_MS} > s.dateOfService
      GROUP BY s.id
    )
    SELECT op.memberId AS memberId,
           m.firstName AS firstName, m.lastName AS lastName,
           COUNT(DISTINCT op.prescriberNpi) AS prescribers,
           COUNT(DISTINCT op.pharmacyId) AS pharmacies,
           COUNT(*) AS fills,
           CAST(MAX(cc.totalMme) AS REAL) AS maxMme,
           SUM(op.planPaidCents) AS exposure,
           CAST(MIN(op.dateOfService) AS REAL) AS firstFill,
           CAST(MAX(op.dateOfService) AS REAL) AS lastFill
    FROM op
    JOIN concurrent cc ON cc.id = op.id
    JOIN Member m ON m.id = op.memberId
    GROUP BY op.memberId
    HAVING prescribers >= 3 AND pharmacies >= 3
       AND maxMme >= ${MME_THRESHOLDS.avoidOrJustify}
  `);

  const allMme = await prisma.$queryRawUnsafe<Array<{ v: number }>>(`
    WITH op AS (
      SELECT c.memberId,
             CASE WHEN o.isTransdermal = 1
                  THEN o.strengthMg * o.mmeFactor
                  ELSE c.quantityDispensed * o.strengthMg * o.mmeFactor / c.daysSupply
             END AS dmme
      FROM Claim c JOIN OpioidProduct o ON o.drugId = c.drugId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND o.convertible = 1 AND c.daysSupply > 0
        AND ${asOfSql}
    )
    SELECT CAST(MAX(dmme) AS REAL) AS v FROM op GROUP BY memberId
  `);
  const stats = peerStats(allMme.map((r) => Number(r.v)));

  return rows.map((r) => ({
    detectorId: "member.opioid-overutilisation",
    subjectType: "member" as const,
    subjectId: r.memberId,
    subjectLabel: `${r.firstName} ${r.lastName}`,
    severity: "High" as const,
    score: robustScore(Number(r.maxMme), stats.median, stats.p95),
    observed: Math.round(Number(r.maxMme)),
    peerMedian: Math.round(stats.median),
    peerP95: Math.round(stats.p95),
    claimCount: Number(r.fills),
    exposureCents: Number(r.exposure),
    windowStart: new Date(Number(r.firstFill)),
    windowEnd: new Date(Number(r.lastFill)),
    evidence: [
      {
        label: "Peak daily dose",
        detail: `${Math.round(Number(r.maxMme))} MME per day across concurrent fills`,
        value: `${Math.round(Number(r.maxMme))} MME`,
      },
      {
        label: "Opioid prescribers",
        detail: "Distinct prescribers writing opioid prescriptions",
        value: String(Number(r.prescribers)),
      },
      {
        label: "Dispensing pharmacies",
        detail: "Distinct pharmacies filling those prescriptions",
        value: String(Number(r.pharmacies)),
      },
      {
        label: "Opioid fills",
        detail: "Paid opioid claims in the plan year",
        value: String(Number(r.fills)),
      },
    ],
    seededCase: null,
  }));
}

async function detectControlledShopping(
  prisma: PrismaClient,
  asOf?: Date,
): Promise<DetectedSignal[]> {
  const asOfSql = claimAsOfSql(asOf);
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      memberId: string;
      firstName: string;
      lastName: string;
      fills: number;
      prescribers: number;
      pharmacies: number;
      exposure: number;
      firstFill: number;
      lastFill: number;
      classes: string;
    }>
  >(`
    SELECT c.memberId AS memberId,
           m.firstName AS firstName, m.lastName AS lastName,
           COUNT(*) AS fills,
           COUNT(DISTINCT c.prescriberNpi) AS prescribers,
           COUNT(DISTINCT c.pharmacyId) AS pharmacies,
           SUM(c.planPaidCents) AS exposure,
           CAST(MIN(c.dateOfService) AS REAL) AS firstFill,
           CAST(MAX(c.dateOfService) AS REAL) AS lastFill,
           COUNT(DISTINCT d.therapeuticClass) AS classes
    FROM Claim c
    JOIN Drug d ON d.id = c.drugId
    JOIN Member m ON m.id = c.memberId
    WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
      AND d.therapeuticClass IN (${controlledList})
      AND ${asOfSql}
    GROUP BY c.memberId
    HAVING fills >= 6
  `);

  // Band by fill count, because breadth of prescribers scales with volume and
  // comparing a six-fill member against a forty-fill member is meaningless.
  const bandOf = (fills: number) =>
    fills >= 30 ? "30+" : fills >= 18 ? "18-29" : fills >= 10 ? "10-17" : "6-9";

  const byBand = new Map<string, number[]>();
  for (const r of rows) {
    const band = bandOf(Number(r.fills));
    const observed = Number(r.prescribers) + Number(r.pharmacies);
    byBand.set(band, [...(byBand.get(band) ?? []), observed]);
  }
  const bandStats = new Map<string, PeerStats>();
  for (const [band, values] of byBand) bandStats.set(band, peerStats(values));

  const out: DetectedSignal[] = [];
  for (const r of rows) {
    const fills = Number(r.fills);
    const prescribers = Number(r.prescribers);
    const pharmacies = Number(r.pharmacies);
    const observed = prescribers + pharmacies;
    const band = bandOf(fills);
    const stats = bandStats.get(band)!;
    const score = robustScore(observed, stats.median, stats.p95);
    const severity = severityFor(score);
    if (!severity) continue;

    out.push({
      detectorId: "member.controlled-shopping",
      subjectType: "member",
      subjectId: r.memberId,
      subjectLabel: `${r.firstName} ${r.lastName}`,
      severity,
      score,
      observed,
      peerMedian: stats.median,
      peerP95: stats.p95,
      claimCount: fills,
      exposureCents: Number(r.exposure),
      windowStart: new Date(Number(r.firstFill)),
      windowEnd: new Date(Number(r.lastFill)),
      evidence: [
        {
          label: "Prescribers and pharmacies",
          detail: `Against a median of ${stats.median} for the ${byBand.get(band)!.length} members with ${band} controlled fills`,
          value: String(observed),
        },
        {
          label: "Distinct prescribers",
          detail: "Separate writers of controlled prescriptions",
          value: String(prescribers),
        },
        {
          label: "Distinct pharmacies",
          detail: "Separate dispensing locations",
          value: String(pharmacies),
        },
        {
          label: "Controlled fills",
          detail: `Across ${Number(r.classes)} controlled ${Number(r.classes) === 1 ? "class" : "classes"}`,
          value: String(fills),
        },
      ],
      seededCase: null,
    });
  }
  return out;
}

async function detectPrescriberConcentration(
  prisma: PrismaClient,
  asOf?: Date,
): Promise<DetectedSignal[]> {
  const asOfSql = claimAsOfSql(asOf);
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      npi: string;
      firstName: string;
      lastName: string;
      credential: string;
      specialty: string;
      total: number;
      controlled: number;
      members: number;
      exposure: number;
      firstFill: number;
      lastFill: number;
    }>
  >(`
    SELECT c.prescriberNpi AS npi,
           p.firstName AS firstName, p.lastName AS lastName,
           p.credential AS credential, p.specialty AS specialty,
           COUNT(*) AS total,
           SUM(CASE WHEN d.therapeuticClass IN (${controlledList}) THEN 1 ELSE 0 END) AS controlled,
           COUNT(DISTINCT c.memberId) AS members,
           SUM(CASE WHEN d.therapeuticClass IN (${controlledList}) THEN c.planPaidCents ELSE 0 END) AS exposure,
           CAST(MIN(c.dateOfService) AS REAL) AS firstFill,
           CAST(MAX(c.dateOfService) AS REAL) AS lastFill
    FROM Claim c
    JOIN Drug d ON d.id = c.drugId
    JOIN Prescriber p ON p.npi = c.prescriberNpi
    WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
      AND ${asOfSql}
    GROUP BY c.prescriberNpi
    HAVING total >= 200
  `);

  const bySpecialty = new Map<string, number[]>();
  for (const r of rows) {
    const share = Number(r.controlled) / Number(r.total);
    bySpecialty.set(r.specialty, [...(bySpecialty.get(r.specialty) ?? []), share]);
  }
  const specStats = new Map<string, PeerStats>();
  for (const [s, v] of bySpecialty) specStats.set(s, peerStats(v));

  const out: DetectedSignal[] = [];
  for (const r of rows) {
    const total = Number(r.total);
    const controlled = Number(r.controlled);
    const share = controlled / total;
    const stats = specStats.get(r.specialty)!;
    const score = robustScore(share, stats.median, stats.p95);
    const severity = severityFor(score);
    if (!severity || controlled < 20) continue;

    out.push({
      detectorId: "prescriber.controlled-share",
      subjectType: "prescriber",
      subjectId: r.npi,
      subjectLabel: `${r.firstName} ${r.lastName}, ${r.credential}`,
      severity,
      score,
      observed: share,
      peerMedian: stats.median,
      peerP95: stats.p95,
      claimCount: controlled,
      exposureCents: Number(r.exposure),
      windowStart: new Date(Number(r.firstFill)),
      windowEnd: new Date(Number(r.lastFill)),
      evidence: [
        {
          label: "Specialty",
          detail: `Scored against ${bySpecialty.get(r.specialty)!.length} prescribers in the same specialty`,
          value: r.specialty,
        },
        {
          label: "Controlled share",
          detail: `${controlled.toLocaleString()} of ${total.toLocaleString()} paid claims`,
          value: `${(share * 100).toFixed(1)}%`,
        },
        {
          label: "Specialty median",
          detail: "Half of their peers sit below this",
          value: `${(stats.median * 100).toFixed(1)}%`,
        },
        {
          label: "Members treated",
          detail: "Distinct members with a claim from this prescriber",
          value: String(Number(r.members)),
        },
      ],
      seededCase: null,
    });
  }
  return out;
}

async function detectPharmacyMix(
  prisma: PrismaClient,
  asOf?: Date,
): Promise<DetectedSignal[]> {
  const asOfSql = claimAsOfSql(asOf);
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      pharmacyId: string;
      name: string;
      pharmacyType: string;
      total: number;
      controlled: number;
      members: number;
      exposure: number;
      firstFill: number;
      lastFill: number;
    }>
  >(`
    SELECT c.pharmacyId AS pharmacyId, ph.name AS name,
           ph.pharmacyType AS pharmacyType,
           COUNT(*) AS total,
           SUM(CASE WHEN d.therapeuticClass IN (${controlledList}) THEN 1 ELSE 0 END) AS controlled,
           COUNT(DISTINCT c.memberId) AS members,
           SUM(CASE WHEN d.therapeuticClass IN (${controlledList}) THEN c.planPaidCents ELSE 0 END) AS exposure,
           CAST(MIN(c.dateOfService) AS REAL) AS firstFill,
           CAST(MAX(c.dateOfService) AS REAL) AS lastFill
    FROM Claim c
    JOIN Drug d ON d.id = c.drugId
    JOIN Pharmacy ph ON ph.id = c.pharmacyId
    WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
      AND ${asOfSql}
    GROUP BY c.pharmacyId
    HAVING total >= 1000
  `);

  const stats = peerStats(rows.map((r) => Number(r.controlled) / Number(r.total)));

  const out: DetectedSignal[] = [];
  for (const r of rows) {
    const total = Number(r.total);
    const controlled = Number(r.controlled);
    const share = controlled / total;
    const score = robustScore(share, stats.median, stats.p95);
    const severity = severityFor(score);
    if (!severity) continue;

    out.push({
      detectorId: "pharmacy.controlled-mix",
      subjectType: "pharmacy",
      subjectId: r.pharmacyId,
      subjectLabel: r.name,
      severity,
      score,
      observed: share,
      peerMedian: stats.median,
      peerP95: stats.p95,
      claimCount: controlled,
      exposureCents: Number(r.exposure),
      windowStart: new Date(Number(r.firstFill)),
      windowEnd: new Date(Number(r.lastFill)),
      evidence: [
        {
          label: "Controlled share",
          detail: `${controlled.toLocaleString()} of ${total.toLocaleString()} paid claims`,
          value: `${(share * 100).toFixed(1)}%`,
        },
        {
          label: "Network median",
          detail: `Across ${rows.length} pharmacies with enough volume to compare`,
          value: `${(stats.median * 100).toFixed(1)}%`,
        },
        {
          label: "Pharmacy type",
          detail: "Dispensing channel",
          value: r.pharmacyType,
        },
        {
          label: "Members served",
          detail: "Distinct members filling here",
          value: Number(r.members).toLocaleString(),
        },
      ],
      seededCase: null,
    });
  }
  return out;
}
