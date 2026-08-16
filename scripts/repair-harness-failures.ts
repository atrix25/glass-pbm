/**
 * Repair the five harness failures against the current book without a full
 * reseed: rewrite the exception filings, and relabel agent runs whose brain
 * field disagrees with the steps they contain.
 *
 *   npx tsx scripts/repair-harness-failures.ts
 */

import { prisma } from "../src/lib/db.js";
import { PLAN_YEAR } from "../src/lib/clock.js";
import { seedExceptions } from "./seed/exceptions.js";

async function repairBrainLabels() {
  const fixed = await prisma.$executeRaw`
    UPDATE AgentRun
    SET brain = 'mixed'
    WHERE id IN (
      SELECT r.id
      FROM AgentRun r
      JOIN AgentStep s ON s.runId = r.id
      GROUP BY r.id
      HAVING GROUP_CONCAT(DISTINCT s.brain) LIKE '%,%'
         AND r.brain <> 'mixed'
    )
  `;
  console.log(`  relabelled ${fixed} agent runs as mixed`);
}

async function main() {
  console.log("Repairing harness failures...");
  await seedExceptions(prisma, { planYear: PLAN_YEAR });
  await repairBrainLabels();

  const appeal = await prisma.priorAuthorization.findUnique({
    where: { paNumber: "AP2026000204" },
    select: {
      treeId: true,
      decidingStepNumber: true,
      urgency: true,
      receivedAt: true,
      decidedAt: true,
    },
  });
  const hours =
    appeal?.decidedAt && appeal.receivedAt
      ? (appeal.decidedAt.getTime() - appeal.receivedAt.getTime()) / 3_600_000
      : null;
  console.log("  AP2026000204", {
    treeId: appeal?.treeId,
    decidingStepNumber: appeal?.decidingStepNumber,
    hours,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
