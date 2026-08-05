/**
 * Score the book and print the shape.
 *
 * Used to calibrate: the thing to look at is not the headline figure but the
 * histogram and the driver table. A schedule where one term does most of the
 * damage is a schedule measuring one thing, and a histogram piled against zero
 * or ten is a schedule whose clamps are doing the work.
 *
 *   npx tsx scripts/check-nps.ts
 */

import { prisma } from "../src/lib/db.js";
import { resolveClock } from "../src/lib/clock.js";
import { buildExperiences } from "../src/lib/nps/experience.js";
import { readingFrom } from "../src/lib/nps/reading.js";
import { RUBRIC_BY_ID, RUBRIC_VERSION } from "../src/lib/nps/rubric.js";

async function main() {
  const clock = resolveClock(null);
  console.log(`clock      ${clock.now.toISOString()} (day ${clock.dayOfPlanYear})`);
  console.log(`rubric     ${RUBRIC_VERSION}\n`);

  let t = Date.now();
  const experiences = await buildExperiences(clock);
  const buildMs = Date.now() - t;

  t = Date.now();
  const reading = readingFrom(experiences);
  const scoreMs = Date.now() - t;

  const total = await prisma.member.count();

  console.log(
    `built ${experiences.length.toLocaleString()} experiences in ${buildMs} ms, ` +
      `scored in ${scoreMs} ms`,
  );
  console.log(
    `${(total - experiences.length).toLocaleString()} of ${total.toLocaleString()} members have presented nothing yet and are not scored\n`,
  );

  const c = reading.census;
  const s = reading.surveyed;
  console.log("CENSUS");
  console.log(
    `  NPS ${c.nps}   promoters ${pct(c.promoters, c.scored)}  passives ${pct(c.passives, c.scored)}  detractors ${pct(c.detractors, c.scored)}  n=${c.scored.toLocaleString()}`,
  );
  console.log("SURVEYED");
  console.log(
    `  NPS ${s.nps}   promoters ${pct(s.promoters, s.scored)}  passives ${pct(s.passives, s.scored)}  detractors ${pct(s.detractors, s.scored)}  n=${s.scored.toLocaleString()}`,
  );
  console.log(`  response rate ${pct(s.scored, c.scored)}\n`);

  console.log("HISTOGRAM");
  const peak = Math.max(...reading.histogram);
  reading.histogram.forEach((n, i) => {
    const bar = "#".repeat(Math.round((n / peak) * 46));
    console.log(
      `  ${String(i).padStart(2)}  ${String(n).padStart(7)}  ${pct(n, c.scored).padStart(6)}  ${bar}`,
    );
  });

  console.log("\nDRIVERS (total points across the book)");
  for (const d of reading.drivers) {
    const term = RUBRIC_BY_ID[d.id];
    console.log(
      `  ${d.totalPoints.toFixed(0).padStart(9)}  ${String(d.membersAffected).padStart(7)} members  ${d.id.padEnd(22)} ${term?.says ?? ""}`,
    );
  }

  const worst = reading.drivers[0];
  const share = Math.abs(worst.totalPoints) /
    reading.drivers.reduce((sum, d) => sum + Math.abs(d.totalPoints), 0);
  console.log(
    `\nheaviest term is ${worst.id} at ${(share * 100).toFixed(1)}% of all points moved`,
  );
  console.log(
    `clamped at zero: ${reading.histogram[0]}   clamped at ten: ${reading.histogram[10]}`,
  );

  await prisma.$disconnect();
}

function pct(a: number, b: number): string {
  return b === 0 ? "0.0%" : `${((a / b) * 100).toFixed(1)}%`;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
