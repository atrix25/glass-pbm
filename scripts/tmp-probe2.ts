import { prisma } from "../src/lib/db.js";
import { replay } from "../src/lib/engine/replay.js";

async function main() {
  const r = await replay({}, { maxDiffs: 50 });
  console.log(`changed ${r.claimsChanged} of ${r.claimsEvaluated}`);
  for (const d of r.diffs) {
    const c = await prisma.claim.findUnique({
      where: { id: d.claimId },
      include: { drug: true },
    });
    console.log(
      `\n${d.claimNumber} ${d.drugName} kind=${d.kind} dos=${d.dateOfService.toISOString().slice(0, 10)}`,
    );
    console.log(
      `  qty=${c?.quantityDispensed} ds=${c?.daysSupply} uom=${c?.drug.unitOfMeasure} pkg=${c?.drug.packageSize} containers=${c?.drug.packageContainers}`,
    );
    console.log(
      `  before status=${d.before.status} reject=${d.before.rejectCode} plan=${d.before.planPaidCents} pt=${d.before.patientPayCents}`,
    );
    console.log(
      `  after  status=${d.after.status} reject=${d.after.rejectCode} plan=${d.after.planPaidCents} pt=${d.after.patientPayCents}`,
    );
    const fe = await prisma.formularyEntry.findFirst({
      where: { drugId: c!.drugId },
      select: { qlQuantity: true, qlDays: true, qlUnit: true, qlBasis: true, qlRawText: true },
    });
    console.log(`  limit=${JSON.stringify(fe)}`);
  }
  await prisma.$disconnect();
}
main();
