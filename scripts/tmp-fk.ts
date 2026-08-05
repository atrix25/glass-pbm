import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  const counts: Record<string, number> = {
    Member: await prisma.member.count(),
    Drug: await prisma.drug.count(),
    FormularyEntry: await prisma.formularyEntry.count(),
    Pharmacy: await prisma.pharmacy.count(),
    Prescriber: await prisma.prescriber.count(),
    BenefitPlan: await prisma.benefitPlan.count(),
    Claim: await prisma.claim.count(),
    PriorAuthorization: await prisma.priorAuthorization.count(),
    EligibilitySpan: await prisma.eligibilitySpan.count(),
  };
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(20)} ${v.toLocaleString()}`);
  }
  const fks = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    "PRAGMA foreign_key_check('Claim')",
  );
  console.log(`\nforeign key violations on Claim: ${fks.length}`);
  console.log(fks.slice(0, 5));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
