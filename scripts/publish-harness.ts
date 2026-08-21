/**
 * Publish tests/results.json into HarnessResult for the proof page.
 * Intended for CI after `npm test`.
 */
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";

async function main() {
  const payload = readFileSync("tests/results.json", "utf8");
  const row = await prisma.harnessResult.create({
    data: {
      payload,
      commitSha: process.env.GITHUB_SHA ?? process.env.GIT_SHA ?? null,
    },
  });
  console.log(`Published harness result ${row.id}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
