/**
 * Print the survey feedback and the recommendations it produces.
 *
 *   npx tsx scripts/check-nps-feedback.ts
 */

import { prisma } from "../src/lib/db.js";
import { resolveClock } from "../src/lib/clock.js";
import { getReadingWithExamples } from "../src/lib/queries/nps.js";
import { getRecommendations } from "../src/lib/nps/recommendations.js";
import { RUBRIC_BY_ID } from "../src/lib/nps/rubric.js";

async function main() {
  const clock = resolveClock(null);
  const { reading, quotes } = await getReadingWithExamples(clock);

  console.log(
    `NPS ${reading.census.nps.toFixed(1)} census, ${reading.surveyed.nps.toFixed(1)} surveyed\n`,
  );

  console.log("COMPLAINT THEMES (members whose worst experience this was)");
  for (const t of reading.themes.slice(0, 10)) {
    const term = RUBRIC_BY_ID[t.id];
    console.log(
      `  ${t.id.padEnd(24)} ${String(t.members).padStart(7)} members  ${String(t.detractors).padStart(6)} detractors  ${term?.group ?? ""}`,
    );
  }

  console.log("\nVERBATIMS");
  for (const q of quotes) {
    console.log(`\n  [${q.score}] ${q.name} (${q.segment}) — ${q.memberId}`);
    console.log(`  "${q.text}"`);
    console.log(`  ${q.reason}`);
  }

  console.log("\n\nRECOMMENDATIONS");
  for (const r of await getRecommendations(clock)) {
    console.log(`\n  ${r.title}`);
    console.log(`    ${r.rationale}`);
    console.log(
      `    addresses ${r.addresses} · ${r.membersAffected.toLocaleString()} members · ` +
        (r.pointsAtStake === null
          ? "points need the engine"
          : `up to ${r.pointsAtStake.toLocaleString()} pts`),
    );
    console.log(`    ${r.href}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
