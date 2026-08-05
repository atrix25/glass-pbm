import { PrismaClient } from "../src/generated/prisma/index.js";
import { paDeadlines } from "../src/lib/pa/engine.js";
import { seedExceptions } from "./seed/exceptions.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Recomputing prior authorization deadlines...");
  const rows = await prisma.priorAuthorization.findMany({
    select: {
      id: true,
      receivedAt: true,
      urgency: true,
      requestType: true,
      prescriberStatementAt: true,
      decisionDueAt: true,
    },
  });

  let changed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await prisma.$transaction(
      batch
        .map((r) => {
          if (r.requestType === "Grievance") return null;
          const due = paDeadlines(
            r.receivedAt,
            r.urgency === "Expedited" ? "Expedited" : "Standard",
            "Commercial",
            {
              requestType: r.requestType,
              supportingStatementAt: r.prescriberStatementAt,
            },
          ).binding.dueAt;
          if (r.decisionDueAt && r.decisionDueAt.getTime() === due.getTime()) {
            return null;
          }
          changed++;
          return prisma.priorAuthorization.update({
            where: { id: r.id },
            data: { decisionDueAt: due },
          });
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    );
  }
  console.log(`  ${changed} of ${rows.length} deadlines moved`);

  console.log("Seeding exceptions, appeals and grievances...");
  await seedExceptions(prisma, { planYear: 2026 });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
