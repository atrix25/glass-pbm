import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const inFlight = {
    receivedAt: { lte: now },
    OR: [{ decidedAt: null }, { decidedAt: { gt: now } }],
  };

  const [total, withTree, deniedWithTree, escalated, treeTotal, treeDenied] =
    await Promise.all([
      prisma.priorAuthorization.count({ where: inFlight }),
      prisma.priorAuthorization.count({
        where: { ...inFlight, treeId: { not: null } },
      }),
      prisma.priorAuthorization.count({
        where: { ...inFlight, treeId: { not: null }, determination: "Denied" },
      }),
      prisma.priorAuthorization.count({
        where: { ...inFlight, escalated: true, determination: null },
      }),
      prisma.priorAuthorization.count({ where: { treeId: { not: null } } }),
      prisma.priorAuthorization.count({
        where: { treeId: { not: null }, determination: "Denied" },
      }),
    ]);

  console.log({ now: now.toISOString(), total, withTree, deniedWithTree, escalated });
  console.log({ treeTotal, treeDenied });

  const escalatedEver = await prisma.priorAuthorization.count({
    where: { determination: null, decidedAt: null },
  });
  console.log({ undecidedEver: escalatedEver });

  // How PA arrivals are distributed across the year for criteria drugs.
  const byMonth = await prisma.$queryRaw<Array<{ m: string; n: number }>>`
    SELECT strftime('%Y-%m', receivedAt / 1000, 'unixepoch') AS m, COUNT(*) AS n
    FROM PriorAuthorization
    WHERE treeId IS NOT NULL
    GROUP BY m ORDER BY m
  `;
  console.log(byMonth.map((r) => `${r.m}: ${Number(r.n)}`).join("  "));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
