/**
 * Sanity-check the sponsor report aggregations against the seeded book.
 *
 * The reports read the daily rollup, so printing their output alone would only
 * prove the rollup is self-consistent. This pins the clock to the end of the
 * plan year, so the whole book is in scope, and reconciles the two figures the
 * rollup path could plausibly get wrong — ingredient cost and AWP, which drive
 * every guarantee on the page — against the claim table itself.
 */
import {
  getAwpSensitivity,
  getGuaranteeReconciliation,
  getRebateWaterfall,
  getSpreadComparison,
} from "../src/lib/queries/reports.js";
import { PLAN_YEAR_END, resolveClock } from "../src/lib/clock.js";
import { prisma } from "../src/lib/db.js";

const f = (c: number) =>
  "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const clock = resolveClock(PLAN_YEAR_END.toISOString());

  console.log("GUARANTEES");
  for (const r of await getGuaranteeReconciliation(clock)) {
    console.log(
      `  ${r.channel.padEnd(10)} ${r.scope.padEnd(8)} n=${String(r.claims).padStart(7)}` +
        ` guar=${r.guaranteedBps ?? "-"} actual=${r.actualDiscountBps} var=${r.discountVarianceBps}` +
        ` met=${r.met} $var=${r.dollarVarianceCents != null ? f(r.dollarVarianceCents) : "-"}`,
    );
  }

  const w = await getRebateWaterfall(clock);
  console.log("\nREBATES", {
    gross: f(w.grossRebateCents),
    adminFee: f(w.rebateAdminFeeCents),
    net: f(w.netToPlanCents),
    brandClaims: w.brandClaims,
    minGuarantee: f(w.minGuaranteeCents),
    met: w.guaranteeMet,
    perBrandClaim: f(w.perBrandClaimCents),
  });

  const s = await getSpreadComparison(clock);
  console.log("\nSPREAD", {
    passThrough: f(s.passThroughCents),
    spread: f(s.spreadCents),
    delta: f(s.deltaCents),
  });
  for (const b of s.byClass) {
    console.log(`  ${b.brandGeneric} n=${b.claims} pt=${f(b.passThroughCents)} spread=${f(b.spreadCents)} delta=${f(b.deltaCents)}`);
  }

  const a = await getAwpSensitivity(clock);
  console.log("\nAWP", {
    total: f(a.totalCents),
    awpPriced: f(a.awpPricedCents),
    share: (a.awpShare * 100).toFixed(1) + "%",
    verifiable: f(a.verifiableCents),
  });

  // ---------------------------------------------------------------------
  const [direct] = await prisma.$queryRaw<
    Array<{ claims: bigint; ingredient: bigint; awp: bigint }>
  >`
    SELECT COUNT(*)                       AS claims,
           SUM(billedIngredientCostCents) AS ingredient,
           SUM(awpTotalCents)             AS awp
    FROM Claim
    WHERE responseStatus = 'P' AND awpTotalCents > 0 AND scenarioTag IS NULL
  `;

  const rolled = (await getGuaranteeReconciliation(clock)).reduce(
    (acc, r) => ({
      claims: acc.claims + r.claims,
      ingredient: acc.ingredient + r.billedCents,
      awp: acc.awp + r.awpCents,
    }),
    { claims: 0, ingredient: 0, awp: 0 },
  );

  const checks: Array<[string, number, number]> = [
    ["claims", rolled.claims, Number(direct.claims)],
    ["ingredient cost", rolled.ingredient, Number(direct.ingredient)],
    ["AWP", rolled.awp, Number(direct.awp)],
  ];

  console.log("\nRECONCILIATION  (rollup vs claim table)");
  let failed = false;
  for (const [label, fromRollup, fromClaims] of checks) {
    const ok = fromRollup === fromClaims;
    failed ||= !ok;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${label.padEnd(16)} rollup=${fromRollup} claims=${fromClaims}`,
    );
  }
  if (failed) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
