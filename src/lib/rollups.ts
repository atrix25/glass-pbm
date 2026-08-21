import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";

/**
 * Rebuild BookDay rows from Claim for a date window.
 * Used by the rollup_refresh job so dashboards never scan the claim table.
 * Dimension rollups remain seed/enrich territory for now; this keeps the
 * primary daily totals correct after claim mutations or replay commits.
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
    }>
  >(
    `SELECT date_trunc('day', "dateOfService") AS day,
            COUNT(*)::bigint AS "claimsSubmitted",
            SUM(CASE WHEN "responseStatus" = 'P' AND "transactionCode" = 'B1' THEN 1 ELSE 0 END)::bigint AS "claimsPaid",
            SUM(CASE WHEN "responseStatus" = 'R' THEN 1 ELSE 0 END)::bigint AS "claimsRejected",
            COALESCE(SUM(CASE WHEN "responseStatus" = 'P' AND "transactionCode" = 'B1' THEN "totalBilledCents" ELSE 0 END), 0)::bigint AS "totalBilledCents",
            COALESCE(SUM(CASE WHEN "responseStatus" = 'P' AND "transactionCode" = 'B1' THEN "planPaidCents" ELSE 0 END), 0)::bigint AS "planPaidCents",
            COALESCE(SUM(CASE WHEN "responseStatus" = 'P' AND "transactionCode" = 'B1' THEN "patientPayCents" ELSE 0 END), 0)::bigint AS "patientPayCents",
            COALESCE(SUM(CASE WHEN "responseStatus" = 'P' AND "transactionCode" = 'B1' THEN "pharmacyPaidCents" ELSE 0 END), 0)::bigint AS "pharmacyPaidCents",
            COALESCE(SUM(CASE WHEN "responseStatus" = 'P' AND "transactionCode" = 'B1' THEN "estimatedRebateCents" ELSE 0 END), 0)::bigint AS "estimatedRebateCents",
            SUM(CASE WHEN "responseStatus" = 'P' AND "brandGenericClass" = 'Generic' THEN 1 ELSE 0 END)::bigint AS "genericClaims",
            SUM(CASE WHEN "responseStatus" = 'P' AND "brandGenericClass" = 'Brand' THEN 1 ELSE 0 END)::bigint AS "brandClaims",
            SUM(CASE WHEN "responseStatus" = 'P' AND "isSpecialtyClaim" IS TRUE THEN 1 ELSE 0 END)::bigint AS "specialtyClaims",
            COALESCE(SUM(CASE WHEN "responseStatus" = 'P' AND "isSpecialtyClaim" IS TRUE THEN "totalBilledCents" ELSE 0 END), 0)::bigint AS "specialtyBilledCents",
            SUM(CASE WHEN "channel" = 'Mail' THEN 1 ELSE 0 END)::bigint AS "mailClaims",
            SUM(CASE WHEN "channel" = 'Retail' THEN 1 ELSE 0 END)::bigint AS "retailClaims",
            SUM(CASE WHEN "channel" = 'Retail90' THEN 1 ELSE 0 END)::bigint AS "retail90Claims",
            COUNT(DISTINCT "memberId")::bigint AS "membersFilling"
     FROM "Claim"
     WHERE ($1::timestamptz IS NULL OR "dateOfService" >= $1)
       AND ($2::timestamptz IS NULL OR "dateOfService" <= $2)
     GROUP BY 1
     ORDER BY 1`,
    from ?? null,
    to ?? null,
  );

  let upserted = 0;
  for (const r of rows) {
    const id = r.day.toISOString().slice(0, 10);
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
