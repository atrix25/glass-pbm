/** Sanity-check the sponsor report aggregations against the seeded book. */
import {
  getAwpSensitivity,
  getGuaranteeReconciliation,
  getRebateWaterfall,
  getSpreadComparison,
} from "../src/lib/queries/reports.js";

const f = (c: number) =>
  "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  console.log("GUARANTEES");
  for (const r of await getGuaranteeReconciliation()) {
    console.log(
      `  ${r.channel.padEnd(10)} ${r.scope.padEnd(8)} n=${String(r.claims).padStart(6)}` +
        ` guar=${r.guaranteedBps ?? "-"} actual=${r.actualDiscountBps} var=${r.discountVarianceBps}` +
        ` met=${r.met} $var=${r.dollarVarianceCents != null ? f(r.dollarVarianceCents) : "-"}`,
    );
  }

  const w = await getRebateWaterfall();
  console.log("\nREBATES", {
    gross: f(w.grossRebateCents),
    adminFee: f(w.rebateAdminFeeCents),
    net: f(w.netToPlanCents),
    brandClaims: w.brandClaims,
    minGuarantee: f(w.minGuaranteeCents),
    met: w.guaranteeMet,
    perBrandClaim: f(w.perBrandClaimCents),
  });

  const s = await getSpreadComparison();
  console.log("\nSPREAD", {
    passThrough: f(s.passThroughCents),
    spread: f(s.spreadCents),
    delta: f(s.deltaCents),
  });
  for (const b of s.byClass) {
    console.log(`  ${b.brandGeneric} n=${b.claims} pt=${f(b.passThroughCents)} spread=${f(b.spreadCents)} delta=${f(b.deltaCents)}`);
  }

  const a = await getAwpSensitivity();
  console.log("\nAWP", {
    total: f(a.totalCents),
    awpPriced: f(a.awpPricedCents),
    share: (a.awpShare * 100).toFixed(1) + "%",
    verifiable: f(a.verifiableCents),
  });
}

main();
