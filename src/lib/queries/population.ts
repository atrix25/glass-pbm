import { prisma } from "@/lib/db";

/**
 * Book-wide paid-claim totals used to characterise the seeded population:
 * how many members, how many paid claims, and the money split between the
 * plan's bill and the members' share.
 */
export async function getPaidPopulationTotals() {
  const [members, paidClaims, agg] = await Promise.all([
    prisma.member.count(),
    prisma.claim.count({ where: { responseStatus: "P" } }),
    prisma.claim.aggregate({
      where: { responseStatus: "P" },
      _sum: { totalBilledCents: true, patientPayCents: true },
    }),
  ]);

  return {
    members,
    paidClaims,
    billedCents: agg._sum.totalBilledCents ?? 0,
    memberPaidCents: agg._sum.patientPayCents ?? 0,
  };
}
