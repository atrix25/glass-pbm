/** Replay every stored claim with no configuration change and report drift. */
import { replay } from "../src/lib/engine/replay.js";

async function main() {
  const r = await replay({}, { maxDiffs: 20 });
  console.log(`claims evaluated : ${r.claimsEvaluated.toLocaleString()}`);
  console.log(`claims changed   : ${r.claimsChanged.toLocaleString()}`);
  console.log(`new rejects      : ${r.newRejects}`);
  console.log(`newly paid       : ${r.newlyPaid}`);
  console.log(
    `plan paid        : ${r.planPaidBeforeCents} -> ${r.planPaidAfterCents}`,
  );
  console.log(`elapsed          : ${r.elapsedMs} ms`);
  for (const d of r.diffs.slice(0, 20)) {
    console.log(
      `  ${d.claimNumber} ${d.memberName} ${d.drugName.slice(0, 26)} ` +
        `${d.before.status}${d.before.rejectCode ?? ""}->${d.after.status}${d.after.rejectCode ?? ""} ` +
        `plan ${d.before.planPaidCents}->${d.after.planPaidCents} member ${d.before.patientPayCents}->${d.after.patientPayCents}`,
    );
  }
}

main();
