/**
 * Fills that have already been reversed as of a point in time.
 *
 * Reversals are stored as B2 rows that leave the original B1 paid (`P`). The
 * net money is correct once both rows are summed, but any path that rebuilds a
 * member's live position from `responseStatus = 'P'` alone still sees the
 * undone fill: its quantity blocks a refill, and its patient pay still climbs
 * the deductible and out-of-pocket balances.
 *
 * Seed-time proof (`reproduce`) deliberately keeps those originals in history
 * — the book was priced before reversals were written. Point-of-sale quotes and
 * refill answers do not: they answer "what is true now," so a fill whose
 * reversal has already posted must drop out.
 */

import { prisma } from "@/lib/db";

/** Ids of B1 fills whose B2 had posted on or before `asOf`. */
export function claimIdsReversedAsOf(
  reversals: Array<{ reversalOfClaimId: string | null; adjudicatedAt: Date }>,
  asOf: Date,
): string[] {
  const asOfMs = asOf.getTime();
  const ids: string[] = [];
  for (const r of reversals) {
    if (!r.reversalOfClaimId) continue;
    if (r.adjudicatedAt.getTime() <= asOfMs) ids.push(r.reversalOfClaimId);
  }
  return ids;
}

/** Load the member's already-reversed fill ids as of `asOf`. */
export async function reversedFillIdsForMember(
  memberId: string,
  asOf: Date,
): Promise<string[]> {
  const rows = await prisma.claim.findMany({
    where: {
      memberId,
      transactionCode: "B2",
      adjudicatedAt: { lte: asOf },
      reversalOfClaimId: { not: null },
    },
    select: { reversalOfClaimId: true, adjudicatedAt: true },
  });
  return claimIdsReversedAsOf(rows, asOf);
}
