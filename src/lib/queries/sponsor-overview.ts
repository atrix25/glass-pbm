import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";
import { PLAN_YEAR, PLAN_YEAR_START, type SimulationClock } from "@/lib/clock";
import { memberMonthsByMonth, sponsorCosts } from "@/lib/sponsor-metrics";

export async function getSponsorOverview(clock: SimulationClock) {
  const sponsorId = tenantSponsorId();
  const sponsor = await prisma.planSponsor.findUniqueOrThrow({ where: { id: sponsorId } });
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: sponsor.contractId } });
  const days = await prisma.bookDay.findMany({ where: { sponsorId, date: { gte: PLAN_YEAR_START, lte: clock.today } }, orderBy: { date: "asc" } });
  const spans = await prisma.eligibilitySpan.findMany({
    where: { member: { sponsorId }, effectiveDate: { lte: clock.today }, OR: [{ terminationDate: null }, { terminationDate: { gte: PLAN_YEAR_START } }] },
    select: { memberId: true, effectiveDate: true, terminationDate: true },
  });
  const exposure = memberMonthsByMonth(spans, PLAN_YEAR, clock.today);
  const feeRate = contract.adminFeePmpmCommercialCents + contract.rebateAdminFeePmpmCents;
  const trend = Array.from({ length: clock.today.getUTCMonth() + 1 }, (_, month) => {
    const rows = days.filter(d => d.date.getUTCMonth() === month);
    const planCents = rows.reduce((s, d) => s + d.planPaidCents + d.reversalPlanPaidCents, 0);
    const rebateCents = rows.reduce((s, d) => s + d.estimatedRebateCents + d.reversalRebateCents, 0);
    const oopCents = rows.reduce((s, d) => s + d.patientPayCents + d.reversalPatientPayCents, 0);
    return {
      month: new Date(Date.UTC(PLAN_YEAR, month, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      complete: Date.UTC(PLAN_YEAR, month + 1, 1) <= clock.tomorrow.getTime(),
      memberMonths: exposure[month], planCents, rebateCents, oopCents,
      claims: rows.reduce((s, d) => s + d.claimsPaid - d.reversalsProcessed, 0),
      ...sponsorCosts(planCents, rebateCents, exposure[month], feeRate),
    };
  });
  const memberMonths = exposure.reduce((a, b) => a + b, 0);
  const netCents = trend.reduce((s, m) => s + m.netCents, 0);
  const oopCents = trend.reduce((s, m) => s + m.oopCents, 0);
  const closed = trend.filter(m => m.complete);
  return {
    sponsor: sponsor.name, contract: contract.name, pbm: contract.pbmName,
    asOf: clock.today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    year: PLAN_YEAR, trend, memberMonths, netCents, oopCents,
    pmpmCents: memberMonths > 0 ? Math.round(netCents / memberMonths) : null,
    oopPmpmCents: memberMonths > 0 ? Math.round(oopCents / memberMonths) : null,
    runRateCents: closed.length ? Math.round(closed.reduce((s, m) => s + m.netCents, 0) / closed.length * 12) : null,
    feesCents: trend.reduce((s, m) => s + m.feesCents, 0),
    rebateCents: trend.reduce((s, m) => s + m.rebateCents, 0),
    planCents: trend.reduce((s, m) => s + m.planCents, 0),
    claims: trend.reduce((s, m) => s + m.claims, 0),
  };
}
