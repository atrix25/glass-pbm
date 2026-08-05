/**
 * Prove the two paths agree.
 *
 * The change console subtracts a replayed reading from a stored one. That is
 * only meaningful if replaying against no change reproduces the stored book
 * exactly, and if the incremental tally in the replay loop counts the same
 * things as the grouped statement that reads the database. Either failing would
 * show up as a benefit change appearing to move member experience when nothing
 * had moved at all.
 *
 *   npx tsx scripts/check-nps-replay.ts
 */

import { prisma } from "../src/lib/db.js";
import { resolveClock } from "../src/lib/clock.js";
import { replay } from "../src/lib/engine/replay.js";
import { buildExperiences } from "../src/lib/nps/experience.js";
import { readingFrom } from "../src/lib/nps/reading.js";

async function main() {
  const clock = resolveClock(null);

  console.log("stored path...");
  const stored = readingFrom(await buildExperiences(clock));

  console.log("replay path (no change)...");
  const r = await replay({}, { nps: true, asOf: clock.now, maxDiffs: 0 });
  if (!r.nps) throw new Error("replay returned no nps block");

  const { before, after } = r.nps;

  const line = (name: string, x: typeof before) =>
    `${name.padEnd(9)} nps ${String(x.census.nps).padStart(6)}  ` +
    `n ${String(x.census.scored).padStart(7)}  ` +
    `P ${String(x.census.promoters).padStart(6)} ` +
    `N ${String(x.census.passives).padStart(6)} ` +
    `D ${String(x.census.detractors).padStart(6)}  ` +
    `surveyed ${x.surveyed.nps}`;

  console.log();
  console.log(line("stored", stored));
  console.log(line("before", before));
  console.log(line("after", after));
  console.log();

  let failures = 0;
  const check = (what: string, ok: boolean) => {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
    if (!ok) failures++;
  };

  check(
    "no-op replay leaves the score unchanged",
    before.census.nps === after.census.nps,
  );
  check(
    "no-op replay leaves the histogram unchanged",
    JSON.stringify(before.histogram) === JSON.stringify(after.histogram),
  );
  check(
    "replay reproduces the stored score",
    before.census.nps === stored.census.nps,
  );
  check(
    "replay reproduces the stored histogram",
    JSON.stringify(before.histogram) === JSON.stringify(stored.histogram),
  );
  check(
    "segments reconcile",
    before.census.promoters + before.census.passives + before.census.detractors ===
      before.census.scored,
  );
  check(
    "histogram sums to the scored population",
    before.histogram.reduce((a, b) => a + b, 0) === before.census.scored,
  );

  if (failures > 0) {
    console.log("\nstored histogram", stored.histogram.join(","));
    console.log("replay histogram", before.histogram.join(","));
    const dp = new Map(stored.drivers.map((d) => [d.id, d]));
    console.log("\ndriver comparison (stored vs replay):");
    for (const d of before.drivers) {
      const s = dp.get(d.id);
      const flag =
        s && s.membersAffected === d.membersAffected ? "    " : " != ";
      console.log(
        `${flag}${d.id.padEnd(24)} stored ${String(s?.membersAffected ?? 0).padStart(7)}  replay ${String(d.membersAffected).padStart(7)}`,
      );
    }
  }

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
