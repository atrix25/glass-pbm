import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";

/**
 * BookDay primary keys are `day-YYYY-MM-DD` (see scripts/seed/index.ts).
 * Using the bare ISO date makes upsert miss every existing row and then fail
 * the unique `date` constraint — or, on an empty table, invent a second id
 * scheme that later readers cannot reconcile.
 */
export function bookDayRollupId(day: Date): string {
  return `day-${day.toISOString().slice(0, 10)}`;
}

/**
 * Rebuild BookDay rows from Claim for a date window.
 * Used by the rollup_refresh job so dashboards never scan the claim table.
 * Dimension rollups remain seed/enrich territory for now; this keeps the
 * primary daily totals correct after claim mutations or replay commits.
 *
 * Must match the seed + build-financials contract checked by invariants:
 * - headline counts/money = B1 claims with scenarioTag IS NULL
 * - channel / brand / specialty mix = paid B1 only
 * - reversals live in their own columns from B2 (never netted into paid)
 */
export async function refreshBookDayRollups(from?: Date, to?: Date) {
  const sponsorId = tenantSponsorId();
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      day: Date;
      claimsSubmitted: bigint;
      claimsPaid: bigint;
      claimsRejected: bigint;
      totalBilledCents: bigint;
      planPaidCents: bigint;
      patientPayCents: bigint;
      pharmacyPaidCents: bigint;
      estimatedRebateCents: bigint;
      genericClaims: bigint;
      brandClaims: bigint;
      specialtyClaims: bigint;
      specialtyBilledCents: bigint;
      mailClaims: bigint;
      retailClaims: bigint;
      retail90Claims: bigint;
      membersFilling: bigint;
      reversalsProcessed: bigint;
      reversalBilledCents: bigint;
      reversalPlanPaidCents: bigint;
      reversalPatientPayCents: bigint;
      reversalRebateCents: bigint;
    }>
  >(
    `SELECT date_trunc('day', "dateOfService") AS day,
            SUM(CASE WHEN "transactionCode" = 'B1' THEN 1 ELSE 0 END)::bigint AS "claimsSubmitted",
            SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' THEN 1 ELSE 0 END)::bigint AS "claimsPaid",
            SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'R' THEN 1 ELSE 0 END)::bigint AS "claimsRejected",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' THEN "totalBilledCents" ELSE 0 END), 0)::bigint AS "totalBilledCents",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' THEN "planPaidCents" ELSE 0 END), 0)::bigint AS "planPaidCents",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' THEN "patientPayCents" ELSE 0 END), 0)::bigint AS "patientPayCents",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' THEN "pharmacyPaidCents" ELSE 0 END), 0)::bigint AS "pharmacyPaidCents",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' THEN "estimatedRebateCents" ELSE 0 END), 0)::bigint AS "estimatedRebateCents",
            SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' AND "brandGenericClass" = 'Generic' THEN 1 ELSE 0 END)::bigint AS "genericClaims",
            SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' AND "brandGenericClass" = 'Brand' THEN 1 ELSE 0 END)::bigint AS "brandClaims",
            SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' AND "isSpecialtyClaim" IS TRUE THEN 1 ELSE 0 END)::bigint AS "specialtyClaims",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' AND "isSpecialtyClaim" IS TRUE THEN "totalBilledCents" ELSE 0 END), 0)::bigint AS "specialtyBilledCents",
            SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' AND "channel" = 'Mail' THEN 1 ELSE 0 END)::bigint AS "mailClaims",
            SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' AND "channel" = 'Retail' THEN 1 ELSE 0 END)::bigint AS "retailClaims",
            SUM(CASE WHEN "transactionCode" = 'B1' AND "responseStatus" = 'P' AND "channel" = 'Retail90' THEN 1 ELSE 0 END)::bigint AS "retail90Claims",
            COUNT(DISTINCT CASE WHEN "transactionCode" = 'B1' THEN "memberId" END)::bigint AS "membersFilling",
            SUM(CASE WHEN "transactionCode" = 'B2' THEN 1 ELSE 0 END)::bigint AS "reversalsProcessed",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B2' THEN "totalBilledCents" ELSE 0 END), 0)::bigint AS "reversalBilledCents",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B2' THEN "planPaidCents" ELSE 0 END), 0)::bigint AS "reversalPlanPaidCents",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B2' THEN "patientPayCents" ELSE 0 END), 0)::bigint AS "reversalPatientPayCents",
            COALESCE(SUM(CASE WHEN "transactionCode" = 'B2' THEN "estimatedRebateCents" ELSE 0 END), 0)::bigint AS "reversalRebateCents"
     FROM "Claim"
     WHERE "scenarioTag" IS NULL
       AND ($1::timestamptz IS NULL OR "dateOfService" >= $1)
       AND ($2::timestamptz IS NULL OR "dateOfService" <= $2)
     GROUP BY 1
     ORDER BY 1`,
    from ?? null,
    to ?? null,
  );

  let upserted = 0;
  for (const r of rows) {
    const id = bookDayRollupId(r.day);
    const data = {
      sponsorId,
      date: r.day,
      claimsSubmitted: Number(r.claimsSubmitted),
      claimsPaid: Number(r.claimsPaid),
      claimsRejected: Number(r.claimsRejected),
      totalBilledCents: Number(r.totalBilledCents),
      planPaidCents: Number(r.planPaidCents),
      patientPayCents: Number(r.patientPayCents),
      pharmacyPaidCents: Number(r.pharmacyPaidCents),
      estimatedRebateCents: Number(r.estimatedRebateCents),
      genericClaims: Number(r.genericClaims),
      brandClaims: Number(r.brandClaims),
      specialtyClaims: Number(r.specialtyClaims),
      specialtyBilledCents: Number(r.specialtyBilledCents),
      mailClaims: Number(r.mailClaims),
      retailClaims: Number(r.retailClaims),
      retail90Claims: Number(r.retail90Claims),
      membersFilling: Number(r.membersFilling),
      reversalsProcessed: Number(r.reversalsProcessed),
      reversalBilledCents: Number(r.reversalBilledCents),
      reversalPlanPaidCents: Number(r.reversalPlanPaidCents),
      reversalPatientPayCents: Number(r.reversalPatientPayCents),
      reversalRebateCents: Number(r.reversalRebateCents),
    };
    await prisma.bookDay.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    upserted += 1;
  }

  return { days: upserted, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null };
}
