/**
 * How good is the projection?
 *
 * The change console shows a sampled figure within a few seconds and the full
 * measurement half a minute later. That is only a decent trade if the first one
 * is close enough to act on. This runs several changes both ways and prints the
 * disagreement, so the sample rate is chosen against evidence rather than
 * chosen and then described as adequate.
 *
 *   npx tsx scripts/check-nps-projection.ts
 */

import { prisma } from "../src/lib/db.js";
import { replay, type ConfigOverride } from "../src/lib/engine/replay.js";

const CASES: { name: string; o: ConfigOverride }[] = [
  { name: "no change", o: {} },
  { name: "Level 1 generics to $0", o: { costShare: [{ level: "1", copayCents: 0 }] } },
  {
    name: "Level 3 coinsurance to 60%",
    o: { costShare: [{ level: "3", coinsuranceRateBps: 6000 }] },
  },
  {
    name: "Level 3 counts toward the limit",
    o: { costShare: [{ level: "3", accumulatesToRxOop: true }] },
  },
  {
    name: "Remove PA from CLARINEX-D",
    o: { formulary: [{ nameContains: "CLARINEX-D", requiresPA: false }] },
  },
];

const RATES = [0.08, 0.15];

async function main() {
  console.log(
    `${"change".padEnd(34)} ${"measured".padStart(9)} ${RATES.map((r) => `${`${Math.round(r * 100)}%`.padStart(9)}`).join(" ")}`,
  );
  console.log("-".repeat(34 + 10 + RATES.length * 10));

  for (const c of CASES) {
    const full = await replay(c.o, { nps: true, maxDiffs: 0 });
    const exact = full.nps!.after.census.nps - full.nps!.before.census.nps;

    const projections: string[] = [];
    for (const rate of RATES) {
      const s = await replay(c.o, { nps: true, maxDiffs: 0, sampleRate: rate });
      const est = s.nps!.after.census.nps - s.nps!.before.census.nps;
      projections.push(
        `${est.toFixed(1).padStart(6)}${diffMark(est - exact)}`,
      );
    }

    console.log(
      `${c.name.padEnd(34)} ${exact.toFixed(1).padStart(9)} ${projections.join(" ")}`,
    );
  }

  // And how long each costs, which is the other half of the trade.
  console.log("\ntiming on the no-change case");
  for (const rate of [1, ...RATES]) {
    const t = Date.now();
    const r = await replay({}, { nps: true, maxDiffs: 0, sampleRate: rate });
    console.log(
      `  ${`${Math.round(rate * 100)}%`.padStart(4)}  ${String(Date.now() - t).padStart(6)} ms  ` +
        `${r.nps!.before.census.scored.toLocaleString().padStart(7)} members  ` +
        `level ${r.nps!.before.census.nps.toFixed(1)}`,
    );
  }

  await prisma.$disconnect();
}

function diffMark(d: number): string {
  const a = Math.abs(d);
  if (a < 0.05) return "   ";
  return ` ${d > 0 ? "+" : "-"}${a.toFixed(1)}`;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
