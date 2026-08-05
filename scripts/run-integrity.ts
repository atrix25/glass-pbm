/**
 * Runs surveillance over the book and writes the findings.
 *
 *   npx tsx scripts/run-integrity.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
import { runAllDetectors, DETECTORS } from "../src/lib/integrity/detectors.js";
import type { SeededCaseRegistry } from "./seed-integrity-cases.js";

const CASE_FILE = "data/integrity-cases.json";

function loadRegistry(): SeededCaseRegistry {
  if (!existsSync(CASE_FILE)) {
    return { members: [], prescribers: [], pharmacies: [] };
  }
  return JSON.parse(readFileSync(CASE_FILE, "utf8")) as SeededCaseRegistry;
}

async function main() {
  const started = Date.now();
  console.log("Running detectors over the book...");

  const signals = await runAllDetectors(prisma);

  // The detectors are never told where the planted cases are. Labelling
  // happens here, after the fact, purely so the page and the proof harness can
  // show which findings were checkable.
  const registry = loadRegistry();
  const seeded = new Map<string, string>();
  for (const m of registry.members) seeded.set(m.id, m.story);
  for (const p of registry.prescribers) seeded.set(p.npi, p.story);
  for (const p of registry.pharmacies) seeded.set(p.id, p.story);
  for (const s of signals) {
    s.seededCase = seeded.get(s.subjectId) ?? null;
  }

  await prisma.integritySignal.deleteMany({});
  const rows = signals.map((s, i) => ({
    id: `sig-${String(i + 1).padStart(6, "0")}`,
    detectorId: s.detectorId,
    subjectType: s.subjectType,
    subjectId: s.subjectId,
    subjectLabel: s.subjectLabel,
    severity: s.severity,
    score: s.score,
    observed: s.observed,
    peerMedian: s.peerMedian,
    peerP95: s.peerP95,
    claimCount: s.claimCount,
    exposureCents: s.exposureCents,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    evidenceJson: JSON.stringify(s.evidence),
    seededCase: s.seededCase,
  }));
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.integritySignal.createMany({ data: rows.slice(i, i + 1000) });
  }

  console.log(`\n${rows.length} signals:`);
  for (const d of DETECTORS) {
    const mine = signals.filter((s) => s.detectorId === d.id);
    const high = mine.filter((s) => s.severity === "High").length;
    const elev = mine.filter((s) => s.severity === "Elevated").length;
    const watch = mine.filter((s) => s.severity === "Watch").length;
    console.log(
      `  ${d.id.padEnd(36)} ${String(mine.length).padStart(5)}  ` +
        `high ${high}, elevated ${elev}, watch ${watch}`,
    );
    for (const s of mine.sort((a, b) => b.score - a.score).slice(0, 3)) {
      const obs =
        d.format === "percent"
          ? `${(s.observed * 100).toFixed(1)}%`
          : String(Math.round(s.observed));
      console.log(
        `      ${s.subjectLabel.padEnd(28)} ${obs.padStart(7)} ` +
          `(peer median ${d.format === "percent" ? `${(s.peerMedian * 100).toFixed(1)}%` : Math.round(s.peerMedian)}) ` +
          `score ${s.score.toFixed(1)}`,
      );
    }
  }
  const planted = [
    ...registry.members.map((m) => ({ id: m.id, kind: "member" })),
    ...registry.prescribers.map((p) => ({ id: p.npi, kind: "prescriber" })),
    ...registry.pharmacies.map((p) => ({ id: p.id, kind: "pharmacy" })),
  ];
  if (planted.length > 0) {
    console.log("\nPlanted cases:");
    for (const p of planted) {
      const hit = signals.find((s) => s.subjectId === p.id);
      console.log(
        `  ${p.kind.padEnd(11)} ${p.id.padEnd(20)} ` +
          (hit
            ? `found by ${hit.detectorId}, ${hit.severity.toLowerCase()}, score ${hit.score.toFixed(1)}`
            : "NOT FOUND"),
      );
    }
  }

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
