/**
 * Which paid fills precede a claim in book order.
 *
 * Seed and empty-override replay walk members chronologically by
 * `(dateOfService, claimNumber)` and fold each paid fill into accumulators and
 * `priorFills` before pricing the next one. Reproduce and POS have to rebuild
 * that same prefix from the ledger: a same-day fill with a lower claim number
 * is a prior, not concurrent noise.
 */

import type { Prisma } from "@/generated/prisma";

export interface ClaimOrderKey {
  dateOfService: Date;
  claimNumber: string;
}

/**
 * True when `candidate` is priced before `current` in book order.
 *
 * Used by unit tests to pin the predicate the ledger query encodes. POS has no
 * claim number for the hypothetical fill, so every paid fill on the date of
 * service is treated as already on the books.
 */
export function isPriorPaidFill(
  candidate: ClaimOrderKey,
  current: ClaimOrderKey | { dateOfService: Date; claimNumber?: null },
): boolean {
  const delta =
    candidate.dateOfService.getTime() - current.dateOfService.getTime();
  if (delta < 0) return true;
  if (delta > 0) return false;
  if (current.claimNumber == null) return true;
  return candidate.claimNumber < current.claimNumber;
}

/**
 * Prisma filter for paid fills that precede a member's position at a fill.
 *
 * When `beforeClaimNumber` is set (reproduce), same-day rows with a lower
 * claim number are included and the claim itself is excluded. When omitted
 * (POS), every paid fill on the date of service is included.
 */
export function priorPaidClaimsWhere(
  memberId: string,
  dateOfService: Date,
  beforeClaimNumber?: string,
): Prisma.ClaimWhereInput {
  const sameDay: Prisma.ClaimWhereInput =
    beforeClaimNumber != null
      ? { dateOfService, claimNumber: { lt: beforeClaimNumber } }
      : { dateOfService };

  return {
    memberId,
    responseStatus: "P",
    OR: [{ dateOfService: { lt: dateOfService } }, sameDay],
  };
}
