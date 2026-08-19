import { prisma } from "@/lib/db";
import { getPaidPopulationTotals } from "@/lib/queries/population";

/**
 * The figures the methodology page states about itself.
 *
 * They are read out of the database rather than written into the copy, so a
 * page whose whole argument is "here is what is real" cannot quietly go out of
 * date the next time the book is regenerated.
 */
export async function getMethodologyFacts() {
  const [population, contracts, pricedDrugs, criteriaSteps, plan, generic] =
    await Promise.all([
      getPaidPopulationTotals(),
      prisma.member.count({ where: { personCode: "01" } }),
      prisma.drugPrice.count(),
      prisma.criteriaStep.count(),
      prisma.benefitPlan.findFirst({
        select: { rxOopLimitIndividual: true },
        orderBy: { rxOopLimitIndividual: "asc" },
      }),
      prisma.claim.count({
        where: { responseStatus: "P", brandGenericClass: "Generic" },
      }),
    ]);

  const {
    members,
    paidClaims: paid,
    billedCents: billed,
    memberPaidCents: memberPaid,
  } = population;

  return {
    members,
    contracts,
    pricedDrugs,
    criteriaSteps,
    claims: paid,
    rxOopLimitCents: plan?.rxOopLimitIndividual ?? 0,
    scriptsPerMember: members > 0 ? paid / members : 0,
    costPerMember: members > 0 ? billed / 100 / members : 0,
    memberShare: billed > 0 ? memberPaid / billed : 0,
    genericRate: paid > 0 ? generic / paid : 0,
  };
}
