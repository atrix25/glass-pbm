/**
 * Paid fills that remittance has not already unwound.
 *
 * Reversals are stored as B2 rows that leave the original B1 marked paid
 * (`responseStatus = 'P'`). Net money is correct once both rows are summed, but
 * any path that treats `P` alone as "still on the books" keeps counting the
 * undone fill: its days supply still overlaps later opioids, its plan paid
 * still inflates exposure, and the integrity triage agent still builds an
 * early-refill timeline that remittance already erased.
 *
 * Detectors and the triage agent answer "what is true of the book now," so a
 * fill whose B2 has posted must drop out. Seed-time proof that rebuilds the
 * original pricing order is a different question and is not handled here.
 */

/** Ids of B1 fills whose B2 has already posted. */
export function claimIdsReversedBy(
  reversals: Array<{ reversalOfClaimId: string | null }>,
): string[] {
  const ids: string[] = [];
  for (const r of reversals) {
    if (r.reversalOfClaimId) ids.push(r.reversalOfClaimId);
  }
  return ids;
}

/**
 * SQL predicate: the claim alias has no posted B2 pointing at it.
 *
 * Written in the unquoted SQLite dialect the Postgres adapter quotes on the
 * way in (`Claim`, `reversalOfClaimId`, `transactionCode`).
 */
export function notReversedSql(claimAlias = "c"): string {
  return `NOT EXISTS (
      SELECT 1 FROM Claim r
      WHERE r.reversalOfClaimId = ${claimAlias}.id
        AND r.transactionCode = 'B2'
    )`;
}
