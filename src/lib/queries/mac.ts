/**
 * The maximum allowable cost list, and the appeals against it.
 *
 * Two questions this page has to answer, both of which an incumbent will
 * decline to answer in writing. What is the ceiling on each generic, and how
 * was it set. And when a pharmacy says the ceiling is below what it can buy
 * the drug for, what happens.
 *
 * Wisconsin's answer to the second is unusually concrete. Wis. Stat.
 * 632.865(2)(b) gives the pharmacy twenty-one days from the claim to appeal
 * and the plan twenty-one days to resolve, requires a reason and a national
 * drug code available at or below the ceiling on every denial, and allows one
 * day from determination to adjustment. Everything below is measured against
 * those four numbers rather than against a service level somebody invented.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";

const DAY_MS = 86_400_000;

/** Wis. Stat. 632.865(2)(b), the deadlines the statute actually sets. */
export const MAC_STATUTE = {
  appealWindowDays: 21,
  resolutionDays: 21,
  adjustmentDays: 1,
  refreshBusinessDays: 7,
  citation: "Wis. Stat. § 632.865(2)",
};

export interface MacListVersion {
  version: number;
  effectiveDate: Date;
  publishedAt: Date;
  drugCount: number;
  changeCount: number;
  /** Days since the version before it. The statute caps the interval. */
  intervalDays: number;
  live: boolean;
}

export interface MacRow {
  drugId: string;
  drugName: string;
  ndc11: string;
  unitPrice: number;
  nadacUnitPrice: number;
  /** Claims this ceiling priced, and what it paid out. */
  claims: number;
  paidCents: number;
}

export interface MacOverview {
  liveVersion: number;
  liveEffective: Date;
  basis: string;
  drugCount: number;
  versions: MacListVersion[];
  /** Claims the ceiling governed, against everything else. */
  macClaims: number;
  totalClaims: number;
  macPaidCents: number;
  /**
   * What the network earned above surveyed acquisition cost on those fills.
   * Positive is margin to the pharmacy, which is the point of the margin, and
   * it is disclosed rather than retained by the processor.
   */
  networkMarginCents: number;
  topRows: MacRow[];
}

export async function getMacOverview(
  clock: SimulationClock,
): Promise<MacOverview> {
  const now = clock.now;

  const versions = await prisma.macList.findMany({
    orderBy: { version: "asc" },
  });
  const published = versions.filter((v) => v.effectiveDate <= now);
  const live = published[published.length - 1] ?? versions[0];

  const [basisSplit, margin, top] = await Promise.all([
    prisma.$queryRaw<Array<{ basis: string | null; n: number; cents: number }>>`
      SELECT basisOfReimbursement AS basis, COUNT(*) AS n,
             SUM(pharmacyPaidCents) AS cents
      FROM Claim
      WHERE responseStatus = 'P' AND transactionCode = 'B1'
        AND dateOfService <= ${now}
      GROUP BY basisOfReimbursement
    `,
    prisma.$queryRaw<Array<{ cents: number | null }>>`
      SELECT SUM((c.macUnitAtDos - c.nadacUnitAtDos) * c.quantityDispensed * 100) AS cents
      FROM Claim c
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND c.basisOfReimbursement = '7'
        AND c.macUnitAtDos IS NOT NULL AND c.nadacUnitAtDos IS NOT NULL
        AND c.dateOfService <= ${now}
    `,
    prisma.$queryRaw<
      Array<{
        drugId: string;
        drugName: string;
        ndc11: string;
        unitPrice: number;
        nadacUnitPrice: number;
        claims: number;
        paidCents: number;
      }>
    >`
      SELECT m.drugId AS drugId, d.name AS drugName, d.ndc11 AS ndc11,
             m.unitPrice AS unitPrice, m.nadacUnitPrice AS nadacUnitPrice,
             COUNT(c.id) AS claims, SUM(c.pharmacyPaidCents) AS paidCents
      FROM MacPrice m
      JOIN Drug d ON d.id = m.drugId
      JOIN Claim c ON c.drugId = m.drugId
        AND c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND c.basisOfReimbursement = '7' AND c.dateOfService <= ${now}
      WHERE m.listId = ${live.id}
      GROUP BY m.drugId
      ORDER BY SUM(c.pharmacyPaidCents) DESC
      LIMIT 12
    `,
  ]);

  const macBucket = basisSplit.find((b) => b.basis === "7");

  return {
    liveVersion: live.version,
    liveEffective: live.effectiveDate,
    basis: live.basis,
    drugCount: live.drugCount,
    versions: published.slice(-10).map((v, i, arr) => ({
      version: v.version,
      effectiveDate: v.effectiveDate,
      publishedAt: v.publishedAt,
      drugCount: v.drugCount,
      changeCount: v.changeCount,
      intervalDays: i === 0
        ? MAC_STATUTE.refreshBusinessDays
        : Math.round(
            (v.effectiveDate.getTime() - arr[i - 1].effectiveDate.getTime()) /
              DAY_MS,
          ),
      live: v.version === live.version,
    })),
    macClaims: Number(macBucket?.n ?? 0),
    totalClaims: basisSplit.reduce((s, b) => s + Number(b.n), 0),
    macPaidCents: Number(macBucket?.cents ?? 0),
    networkMarginCents: Math.round(Number(margin[0]?.cents ?? 0)),
    topRows: top.map((r) => ({
      ...r,
      claims: Number(r.claims),
      paidCents: Number(r.paidCents),
    })),
  };
}

export interface AppealRow {
  id: string;
  pharmacyName: string;
  pharmacyType: string;
  drugName: string;
  dateOfService: Date;
  submittedAt: Date;
  decidedAt: Date;
  /** Days from the fill to the appeal. The statute allows 21. */
  filedWithinDays: number;
  /** Days from the appeal to the determination. The statute allows 21. */
  resolvedWithinDays: number | null;
  status: "Under review" | "Upheld" | "Overturned";
  invoiceUnitPrice: number;
  macUnitPrice: number;
  revisedUnitPrice: number | null;
  adjustmentCents: number;
  /** Fills the adjustment was paid on, not just the one that was appealed. */
  affectedClaims: number;
  denialReason: string | null;
  citedNdc: string | null;
  citedWholesaler: string | null;
}

export interface AppealOverview {
  total: number;
  underReview: number;
  upheld: number;
  overturned: number;
  overturnRateBps: number;
  adjustmentCents: number;
  /** Fills the adjustments were paid on across every overturn. */
  adjustedClaims: number;
  medianResolutionDays: number;
  /** Appeals resolved inside the statutory 21 days, and those that were not. */
  withinStatute: number;
  outsideStatute: number;
  /** Denials carrying both a reason and an NDC, as the statute requires. */
  denialsWithCitation: number;
  denials: number;
  byPharmacyType: {
    pharmacyType: string;
    count: number;
    overturned: number;
    /** Appeals per ten thousand fills the ceiling governed, so a chain's
     * larger footprint does not read as a greater willingness to challenge. */
    perTenThousand: number;
  }[];
  recent: AppealRow[];
}

export async function getAppealOverview(
  clock: SimulationClock,
): Promise<AppealOverview> {
  const now = clock.now;

  const [rows, fillsByType] = await Promise.all([
    prisma.macAppeal.findMany({
      where: { submittedAt: { lte: now } },
      include: {
        pharmacy: { select: { name: true, pharmacyType: true } },
        drug: { select: { name: true } },
      },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.$queryRaw<Array<{ pharmacyType: string; n: number }>>`
      SELECT p.pharmacyType AS pharmacyType, COUNT(*) AS n
      FROM Claim c
      JOIN Pharmacy p ON p.id = c.pharmacyId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND c.basisOfReimbursement = '7' AND c.dateOfService <= ${now}
      GROUP BY p.pharmacyType
    `,
  ]);
  const fills = new Map(fillsByType.map((f) => [f.pharmacyType, Number(f.n)]));

  const enriched: AppealRow[] = rows.map((a) => {
    const decided = a.decidedAt <= now;
    return {
      id: a.id,
      pharmacyName: a.pharmacy.name,
      pharmacyType: a.pharmacy.pharmacyType,
      drugName: a.drug.name,
      dateOfService: a.dateOfService,
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      filedWithinDays: Math.round(
        (a.submittedAt.getTime() - a.dateOfService.getTime()) / DAY_MS,
      ),
      resolvedWithinDays: decided
        ? Math.round((a.decidedAt.getTime() - a.submittedAt.getTime()) / DAY_MS)
        : null,
      status: decided
        ? (a.outcome as "Upheld" | "Overturned")
        : "Under review",
      invoiceUnitPrice: a.invoiceUnitPrice,
      macUnitPrice: a.macUnitPrice,
      revisedUnitPrice: decided ? a.revisedUnitPrice : null,
      adjustmentCents: decided ? a.adjustmentCents : 0,
      affectedClaims: decided ? a.affectedClaims : 0,
      denialReason: decided ? a.denialReason : null,
      citedNdc: decided ? a.citedNdc : null,
      citedWholesaler: decided ? a.citedWholesaler : null,
    };
  });

  const decided = enriched.filter((a) => a.resolvedWithinDays !== null);
  const overturned = decided.filter((a) => a.status === "Overturned");
  const denials = decided.filter((a) => a.status === "Upheld");
  const lags = decided
    .map((a) => a.resolvedWithinDays!)
    .sort((a, b) => a - b);

  const byType = new Map<string, { count: number; overturned: number }>();
  for (const a of enriched) {
    const entry = byType.get(a.pharmacyType) ?? { count: 0, overturned: 0 };
    entry.count++;
    if (a.status === "Overturned") entry.overturned++;
    byType.set(a.pharmacyType, entry);
  }

  return {
    total: enriched.length,
    underReview: enriched.length - decided.length,
    upheld: denials.length,
    overturned: overturned.length,
    overturnRateBps: decided.length
      ? Math.round((overturned.length / decided.length) * 10_000)
      : 0,
    adjustmentCents: overturned.reduce((s, a) => s + a.adjustmentCents, 0),
    adjustedClaims: overturned.reduce((s, a) => s + a.affectedClaims, 0),
    medianResolutionDays: lags[Math.floor(lags.length / 2)] ?? 0,
    withinStatute: decided.filter(
      (a) => a.resolvedWithinDays! <= MAC_STATUTE.resolutionDays,
    ).length,
    outsideStatute: decided.filter(
      (a) => a.resolvedWithinDays! > MAC_STATUTE.resolutionDays,
    ).length,
    denialsWithCitation: denials.filter((a) => a.citedNdc && a.denialReason)
      .length,
    denials: denials.length,
    byPharmacyType: Array.from(byType.entries())
      .map(([pharmacyType, v]) => ({
        pharmacyType,
        ...v,
        perTenThousand: fills.get(pharmacyType)
          ? (v.count / fills.get(pharmacyType)!) * 10_000
          : 0,
      }))
      .sort((a, b) => b.perTenThousand - a.perTenThousand),
    recent: enriched.slice(0, 12),
  };
}
