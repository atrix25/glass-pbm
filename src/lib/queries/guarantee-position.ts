import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";
import { PLAN_YEAR_START, type SimulationClock } from "@/lib/clock";
import { calculateGuaranteePosition, type GuaranteeBucket } from "@/lib/guarantee-position";
import type { RebatePeriod } from "@/lib/rebate-position";

export async function getGuaranteePosition(clock: SimulationClock) {
  const sponsorId = tenantSponsorId();
  const sponsor = await prisma.planSponsor.findUniqueOrThrow({ where: { id: sponsorId } });
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: sponsor.contractId } });
  const rates = await prisma.contractRate.findMany({ where: { contractId: contract.id, rateSide: "Client", lineOfBusiness: "Commercial" } });
  // Aggregate in Postgres. Remove only reversals recorded by the selected clock.
  const rows = await prisma.$queryRaw<Array<{
    channel: string; drugClass: string; serviceDate: Date; discountEligible: boolean; rebateEligible: boolean;
    count: bigint; awpCents: bigint; ingredientCents: bigint; feeCents: bigint; rebateCents: bigint;
    missingAwp: bigint; simulatedAwp: bigint;
  }>>`
    SELECT c."channel", c."brandGenericClass" AS "drugClass", c."dateOfService" AS "serviceDate",
      NOT c."excludedFromDiscountGuarantee" AS "discountEligible", c."rebateEligible",
      COUNT(*) AS count, COALESCE(SUM(c."awpTotalCents"),0) AS "awpCents",
      SUM(c."billedIngredientCostCents") AS "ingredientCents", SUM(c."billedDispensingFeeCents") AS "feeCents",
      SUM(c."estimatedRebateCents") AS "rebateCents",
      SUM(CASE WHEN c."awpTotalCents" IS NULL OR c."awpTotalCents" <= 0 THEN 1 ELSE 0 END) AS "missingAwp",
      SUM(CASE WHEN c."awpIsSimulated" THEN 1 ELSE 0 END) AS "simulatedAwp"
    FROM "Claim" c JOIN "BenefitPlan" p ON p.id = c."benefitPlanId"
    WHERE c."sponsorId" = ${sponsorId} AND c."contractId" = ${contract.id}
      AND p."lineOfBusiness" = 'Commercial' AND c."responseStatus" = 'P'
      AND c."transactionCode" IN ('B1','B3') AND c."dateOfService" >= ${PLAN_YEAR_START}
      AND c."dateOfService" <= ${clock.now} AND c."adjudicatedAt" <= ${clock.now}
      AND NOT EXISTS (SELECT 1 FROM "Claim" r WHERE r."reversalOfClaimId" = c.id
        AND r."sponsorId" = ${sponsorId} AND r."transactionCode" = 'B2' AND r."responseStatus" = 'A'
        AND r."adjudicatedAt" <= ${clock.now})
    GROUP BY c."channel", c."brandGenericClass", c."dateOfService", c."excludedFromDiscountGuarantee", c."rebateEligible"
  `;
  const buckets: GuaranteeBucket[] = rows.map(r => {
    const matches = rates.filter(rate => rate.channel === r.channel && (rate.drugClass === r.drugClass || rate.drugClass === "All") && rate.effectiveDate <= r.serviceDate && (!rate.terminationDate || rate.terminationDate >= r.serviceDate));
    const exact = matches.filter(rate => rate.drugClass === r.drugClass);
    const candidates = exact.length ? exact : matches;
    const rate = candidates.length === 1 ? candidates[0] : null;
    return {
      channel: r.channel, drugClass: r.drugClass ?? "Unclassified", count: Number(r.count),
      awpCents: Number(r.awpCents), ingredientCents: Number(r.ingredientCents), feeCents: Number(r.feeCents), rebateCents: Number(r.rebateCents),
      missingAwp: Number(r.missingAwp), simulatedAwp: Number(r.simulatedAwp),
      discountEligible: r.discountEligible, rebateEligible: r.rebateEligible,
      discountBps: rate?.awpDiscountBps ?? null, feeTargetCents: rate?.dispensingFeeCents ?? null,
      rebateTargetCents: rate?.minRebatePerBrandClaimCents ?? null, citation: rate?.citation ?? null,
    };
  });
  const categories = [...new Set(buckets.map(b => `${b.channel} / ${b.drugClass}`))].sort().map(name => {
    const group = buckets.filter(b => `${b.channel} / ${b.drugClass}` === name);
    const measures = calculateGuaranteePosition(group);
    return { name, measures, belowMinimum: measures.some(m => m.claims > 0 && m.claims < contract.minClaimsPerCategory), citations: [...new Set(group.map(b => b.citation).filter((v): v is string => !!v))] };
  });
  function rebatePeriods(monthsPerPeriod: number): RebatePeriod[] {
    const year = clock.today.getUTCFullYear();
    return Array.from({ length: Math.floor(clock.today.getUTCMonth() / monthsPerPeriod) + 1 }, (_, i) => {
      const startMonth = i * monthsPerPeriod;
      const selected = buckets.filter((_, index) => {
        const month = rows[index].serviceDate.getUTCMonth();
        return month >= startMonth && month < startMonth + monthsPerPeriod;
      });
      const measure = calculateGuaranteePosition(selected).find(m => m.id === "rebate")!;
      return {
        id: `${year}-${monthsPerPeriod}-${i}`,
        label: monthsPerPeriod === 3 ? `Q${i + 1} ${year}` : new Date(Date.UTC(year, startMonth, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
        closed: Date.UTC(year, startMonth + monthsPerPeriod, 1) <= clock.now.getTime(),
        claims: measure.claims,
        estimatedCents: selected.filter(b => b.rebateEligible).reduce((s,b) => s + b.rebateCents, 0),
        floorCents: measure.target === null ? null : Math.round(measure.target * measure.claims),
      };
    });
  }
  return {
    measures: calculateGuaranteePosition(buckets), categories, minClaims: contract.minClaimsPerCategory,
    monthlyRebates: rebatePeriods(1), quarterlyRebates: rebatePeriods(3),
    simulatedClaims: buckets.filter(b => b.discountEligible).reduce((s,b) => s+b.simulatedAwp,0),
    excludedClaims: buckets.filter(b => !b.discountEligible).reduce((s,b) => s+b.count,0),
  };
}
