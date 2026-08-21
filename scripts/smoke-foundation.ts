import { prisma } from "../src/lib/db";
import { claimNextJob } from "../src/lib/jobs";
import { sqlitePlaceholdersToPg } from "../src/lib/pg-sql";

async function main() {
  console.log(
    sqlitePlaceholdersToPg(
      "SELECT c.memberId FROM Claim c WHERE instr(traceJson, ?) > 0 AND json_extract(rejectCodes, '$[0]') = ?",
    ),
  );
  await prisma.tenantConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  const job = await prisma.job.create({
    data: { type: "rollup_refresh", payload: "{}" },
  });
  const claimed = await claimNextJob("smoke");
  console.log({ job: job.id, claimed: claimed?.id, type: claimed?.type });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
