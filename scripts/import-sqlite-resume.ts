/**
 * Resume decisions for SQLite → Postgres book import.
 *
 * Settlement and book-day aggregates are derived from Claim but do not carry a
 * Claim foreign key. A count-only skip after Claim is truncated and reloaded
 * leaves RemittanceRun / SponsorInvoice / RebateInvoice / BookDay dollars stale.
 */

/**
 * Aggregates whose row counts are stable (or nearly so) across Claim rewrites,
 * and which have no Claim FK to CASCADE-invalidate them.
 *
 * `build-financials` always writes a fixed number of remittance cycles and
 * sponsor invoices; BookDay is one row per calendar day. After Claim grows or
 * a parent TRUNCATE CASCADE wipes Claim, those counts still match SQLite and a
 * naive resume would skip them — leaving settlement / landing dollars pointing
 * at the previous Claim money.
 */
export const CLAIM_DERIVED_AGGREGATES = new Set([
  "BookDay",
  "BookDayDimension",
  "RebateInvoice",
  "RemittanceRun",
  "RemittanceLine",
  "SponsorInvoice",
]);

/**
 * Whether resume may skip copying this table.
 *
 * Empty SQLite tables are skipped (nothing to load). Matching counts skip
 * unless Claim was rewritten this run and the table is a Claim-derived
 * aggregate without a Claim FK.
 */
export function shouldSkipResume(args: {
  table: string;
  pgCount: number;
  sqliteCount: number;
  claimReloaded: boolean;
}): boolean {
  const { table, pgCount, sqliteCount, claimReloaded } = args;
  if (sqliteCount === 0) return true;
  if (pgCount < sqliteCount) return false;
  if (claimReloaded && CLAIM_DERIVED_AGGREGATES.has(table)) return false;
  return true;
}
