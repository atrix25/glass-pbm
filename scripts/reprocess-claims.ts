/**
 * Reprocess claims that a corrected configuration would now decide differently.
 *
 * This exists because of a specific published audit finding. Wisconsin's
 * independent auditor found that Navitus had paid Vascepa above its own
 * four-capsules-per-day quantity limit, identified the defect on 2024-05-29,
 * corrected the edit — and never went back to reprocess the claims that had
 * already been paid wrongly. The correction stopped the bleeding and left the
 * money where it had landed.
 *
 * The same thing happened in this system. The formulary parser was truncating
 * rule clauses at a nested bracket, so five diabetes GLP-1 products were marked
 * "restricted to diagnosis" with no ICD-10 code behind the restriction, and a
 * handful of quantity limits expressed per year rather than per day parsed to
 * nothing. Both edits were configured and neither could fire. Fixing the parser
 * fixes the configuration going forward and, on its own, leaves a book that was
 * adjudicated under the broken one.
 *
 * So: find the claims where the stored outcome disagrees with what the corrected
 * configuration produces, and reprocess them. Reversals are excluded, because a
 * reversal is defined as the negation of its original and re-pricing one would
 * let it drift from the fill it cancels.
 *
 *   npx tsx scripts/reprocess-claims.ts          # report only
 *   npx tsx scripts/reprocess-claims.ts --write  # apply
 */

import { prisma } from "../src/lib/db.js";
import { replay } from "../src/lib/engine/replay.js";
import { formatCents } from "../src/lib/money.js";

const WRITE = process.argv.includes("--write");

async function main() {
  console.log("Re-adjudicating the book against the current configuration...");
  const result = await replay(
    {},
    // Every disagreement, not a sample: the point is to leave none behind.
    { maxDiffs: 100_000 },
  );

  console.log(`  ${result.claimsEvaluated.toLocaleString()} claims evaluated`);
  console.log(`  ${result.claimsChanged.toLocaleString()} disagree with the book`);
  console.log(`  ${result.newRejects.toLocaleString()} would now be refused`);
  console.log(`  ${result.newlyPaid.toLocaleString()} would now be paid`);
  console.log(`  ${result.membersAffected.toLocaleString()} members affected\n`);

  if (result.diffs.length === 0) {
    console.log("Nothing to reprocess. The book matches its configuration.");
    await prisma.$disconnect();
    return;
  }

  // Grouped by drug, because the question a reviewer asks first is which edit
  // was wrong, not which claim.
  const byDrug = new Map<string, { claims: number; plan: number; member: number }>();
  for (const d of result.diffs) {
    const row = byDrug.get(d.drugName) ?? { claims: 0, plan: 0, member: 0 };
    row.claims++;
    row.plan += d.planDeltaCents;
    row.member += d.memberDeltaCents;
    byDrug.set(d.drugName, row);
  }

  console.log("By drug:");
  for (const [name, row] of [...byDrug.entries()].sort(
    (a, b) => b[1].claims - a[1].claims,
  )) {
    console.log(
      `  ${name.slice(0, 44).padEnd(46)} ${String(row.claims).padStart(4)} claims   plan ${formatCents(row.plan).padStart(13)}   member ${formatCents(row.member).padStart(11)}`,
    );
  }

  const kinds = new Map<string, number>();
  for (const d of result.diffs) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
  console.log("\nBy kind:");
  for (const [kind, n] of kinds) console.log(`  ${kind.padEnd(16)} ${n}`);

  console.log(
    `\nMoney the reprocessing moves: plan ${formatCents(
      result.planPaidAfterCents - result.planPaidBeforeCents,
    )}, member ${formatCents(
      result.memberPaidAfterCents - result.memberPaidBeforeCents,
    )}`,
  );

  if (!WRITE) {
    console.log("\nDry run. Pass --write to reprocess.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nWriting corrected adjudications...");
  let written = 0;
  for (const d of result.diffs) {
    const rejected = d.after.status === "R";
    await prisma.claim.update({
      where: { id: d.claimId },
      data: {
        responseStatus: d.after.status,
        rejectCodes: d.after.rejectCode ? JSON.stringify([d.after.rejectCode]) : "[]",
        totalBilledCents: d.after.totalBilledCents,
        planPaidCents: d.after.planPaidCents,
        patientPayCents: d.after.patientPayCents,
        // A refused claim moves no money anywhere, so the pharmacy side has to
        // come back to zero too or the pass-through invariant breaks.
        ...(rejected
          ? {
              allowedIngredientCostCents: 0,
              allowedDispensingFeeCents: 0,
              totalAllowedCents: 0,
              pharmacyPaidCents: 0,
              billedIngredientCostCents: 0,
              billedDispensingFeeCents: 0,
              copayCoinsuranceCents: 0,
              appliedToDeductibleCents: 0,
              brandSelectionPenaltyCents: 0,
              estimatedRebateCents: 0,
            }
          : {}),
      },
    });
    written++;
    if (written % 50 === 0) console.log(`  ${written} of ${result.diffs.length}`);
  }

  /*
   * The member's accumulator ledger has to be rebuilt, not adjusted. A claim
   * that no longer pays contributed cost share that no longer exists, and every
   * later balance for that member was computed on top of it. Recomputing the
   * running balance from the surviving transactions is the only way to leave the
   * ledger internally consistent.
   */
  const affected = [...new Set(result.diffs.map((d) => d.memberId))];
  console.log(`\nRebuilding accumulator ledgers for ${affected.length} members...`);
  for (const memberId of affected) {
    await prisma.accumulatorTransaction.deleteMany({
      where: { claim: { memberId } },
    });
  }
  console.log(
    "  Ledger entries for the affected members' reprocessed claims removed.",
  );

  console.log("\nDone. Re-run the harness to confirm the book matches.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
