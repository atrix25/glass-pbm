/**
 * How fast is it, actually.
 *
 * The last argument left to an incumbent, once the pricing is on the table, is
 * capacity: that adjudicating pharmacy claims at national scale is a decade of
 * mainframe engineering and a plan sponsor could not possibly do it. That is a
 * measurable claim, so this measures it.
 *
 * Two runs, because they answer different questions. The first times the
 * decision itself — eligibility, coverage, utilisation management, the
 * lesser-of pricing walk, cost share, accumulators — with the reference data
 * resident, which is how every real processor runs it. The second times the
 * whole round trip a live pharmacy sees, database reads included, through the
 * same endpoint the point-of-sale terminal calls.
 *
 * Percentiles come from the individual timings, not from dividing a total.
 * A mean latency is the number you quote when the tail is embarrassing.
 *
 *   npx tsx scripts/benchmark-throughput.ts
 */

import os from "node:os";
import { prisma } from "../src/lib/db.js";
import { loadWorld } from "../src/lib/engine/replay.js";
import { adjudicate, type AdjudicationContext } from "../src/lib/engine/adjudicate.js";
import { DEFAULT_ASSUMPTIONS } from "../src/lib/engine/benchmark.js";
import { simulateFill } from "../src/lib/engine/pos.js";

const ADJUDICATION_SAMPLE = 200_000;
const POS_SAMPLE = 300;

interface Timing {
  sample: number;
  elapsedMs: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  p999Ms: number;
  maxMs: number;
  histogram: { upperMs: number; count: number }[];
}

/** Buckets chosen to straddle the range a claim actually lands in. */
const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 100, 1000];

function summarise(timingsMs: Float64Array, elapsedMs: number): Timing {
  const sorted = Float64Array.from(timingsMs).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

  const histogram = BUCKETS.map((upperMs) => ({ upperMs, count: 0 }));
  for (const t of sorted) {
    const bucket = histogram.find((b) => t <= b.upperMs) ?? histogram[histogram.length - 1];
    bucket.count++;
  }

  return {
    sample: sorted.length,
    elapsedMs,
    p50Ms: at(0.5),
    p90Ms: at(0.9),
    p99Ms: at(0.99),
    p999Ms: at(0.999),
    maxMs: sorted[sorted.length - 1],
    histogram: histogram.filter((b) => b.count > 0),
  };
}

async function record(kind: string, timing: Timing, notes: string) {
  await prisma.throughputRun.create({
    data: {
      id: `run-${kind.toLowerCase()}-${Date.now()}`,
      ranAt: new Date(),
      kind,
      sample: timing.sample,
      elapsedMs: timing.elapsedMs,
      claimsPerSecond: (timing.sample / timing.elapsedMs) * 1000,
      p50Ms: timing.p50Ms,
      p90Ms: timing.p90Ms,
      p99Ms: timing.p99Ms,
      p999Ms: timing.p999Ms,
      maxMs: timing.maxMs,
      histogram: JSON.stringify(timing.histogram),
      machine: os.cpus()[0]?.model ?? "unknown",
      cores: os.cpus().length,
      memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      runtime: `Node ${process.version} on ${os.platform()} ${os.arch()}`,
      notes,
    },
  });
}

async function benchmarkAdjudication(): Promise<Timing> {
  console.log("  loading reference data...");
  const loadStart = performance.now();
  const world = await loadWorld(true);
  console.log(`  world resident in ${Math.round(performance.now() - loadStart)}ms`);

  /*
   * Real requests, not synthetic ones. Every context below is built from a
   * claim the book actually contains, so the mix of channels, drugs, plans and
   * pricing arms is the mix a live processor would see rather than the easy
   * case repeated a hundred thousand times.
   */
  const rows = await prisma.$queryRaw<
    Array<{
      memberId: string;
      drugId: string;
      pharmacyId: string;
      dateOfService: Date;
      rxNumber: string;
      fillNumber: number;
      quantityDispensed: number;
      daysSupply: number;
      dawCode: string;
      compoundCode: string;
      usualAndCustomaryCents: number;
      ingredientCostSubmittedCents: number;
    }>
  >`
    SELECT memberId, drugId, pharmacyId, dateOfService, rxNumber, fillNumber,
           quantityDispensed, daysSupply, dawCode, compoundCode,
           usualAndCustomaryCents, ingredientCostSubmittedCents
    FROM Claim
    WHERE transactionCode = 'B1'
    LIMIT ${ADJUDICATION_SAMPLE}
  `;

  const contexts: AdjudicationContext[] = [];
  for (const row of rows) {
    const drug = world.drugs.get(row.drugId);
    const pharmacy = world.pharmacies.get(row.pharmacyId);
    const member = world.members.get(row.memberId);
    const elig = world.eligibility.get(row.memberId);
    if (!drug || !pharmacy || !member || !elig) continue;
    const plan = world.plans.get(elig.benefitPlanId);
    if (!plan) continue;

    contexts.push({
      request: {
        dateOfService: new Date(row.dateOfService),
        cardholderId: "",
        personCode: "01",
        serviceProviderId: pharmacy.npi,
        productServiceId: drug.ndc11,
        rxNumber: row.rxNumber,
        fillNumber: row.fillNumber,
        quantityDispensed: row.quantityDispensed,
        daysSupply: row.daysSupply,
        dawCode: row.dawCode,
        usualAndCustomaryCents: row.usualAndCustomaryCents,
        ingredientCostSubmittedCents: row.ingredientCostSubmittedCents,
        compoundCode: row.compoundCode,
      },
      member: {
        id: row.memberId,
        diagnosisCodes: member.diagnosisCodes,
        weightKg: member.weightKg,
      },
      eligibility: elig,
      plan,
      drug,
      formularyEntry: world.formulary.get(row.drugId) ?? null,
      pharmacy,
      contract: world.contract,
      priorFills: [],
      accumulators: {
        rxOopAccumulatedCents: 0,
        federalOopAccumulatedCents: 0,
        deductibleAccumulatedCents: 0,
      },
      approvedPAs: world.approvedPAs.get(row.memberId) ?? [],
      assumptions: DEFAULT_ASSUMPTIONS,
    });
  }
  console.log(`  ${contexts.length} requests prepared`);

  // Warm the just-in-time compiler, so the first thousand claims are not
  // reported as the slowest thousand.
  for (let i = 0; i < Math.min(20_000, contexts.length); i++) {
    adjudicate(contexts[i]);
  }

  const timings = new Float64Array(contexts.length);
  const started = performance.now();
  for (let i = 0; i < contexts.length; i++) {
    const t0 = performance.now();
    adjudicate(contexts[i]);
    timings[i] = performance.now() - t0;
  }
  const elapsedMs = performance.now() - started;

  return summarise(timings, elapsedMs);
}

async function benchmarkPointOfSale(): Promise<Timing> {
  const rows = await prisma.$queryRaw<
    Array<{
      memberId: string;
      drugId: string;
      pharmacyId: string;
      dateOfService: string;
      quantityDispensed: number;
      daysSupply: number;
      dawCode: string;
      prescriberNpi: string | null;
    }>
  >`
    SELECT c.memberId AS memberId, c.drugId AS drugId, c.pharmacyId AS pharmacyId,
           STRFTIME('%Y-%m-%d', c.dateOfService / 1000, 'unixepoch') AS dateOfService,
           c.quantityDispensed AS quantityDispensed,
           c.daysSupply AS daysSupply, c.dawCode AS dawCode,
           c.prescriberNpi AS prescriberNpi
    FROM Claim c
    WHERE c.transactionCode = 'B1' AND (c.rowid % 997) = 0
    LIMIT ${POS_SAMPLE}
  `;

  const request = (row: (typeof rows)[number]) => ({
    memberId: row.memberId,
    drugId: row.drugId,
    pharmacyId: row.pharmacyId,
    dateOfService: row.dateOfService,
    quantityDispensed: row.quantityDispensed,
    daysSupply: row.daysSupply,
    dawCode: row.dawCode,
    prescriberNpi: row.prescriberNpi,
  });

  // One pass to warm connections and query plans, then the measured pass.
  for (const row of rows.slice(0, 20)) await simulateFill(request(row));

  const timings = new Float64Array(rows.length);
  const started = performance.now();
  for (let i = 0; i < rows.length; i++) {
    const t0 = performance.now();
    await simulateFill(request(rows[i]));
    timings[i] = performance.now() - t0;
  }
  const elapsedMs = performance.now() - started;

  return summarise(timings, elapsedMs);
}

async function main() {
  console.log("Benchmarking the engine...");
  await prisma.throughputRun.deleteMany();

  const adjudication = await benchmarkAdjudication();
  console.log(
    `  adjudication: ${Math.round((adjudication.sample / adjudication.elapsedMs) * 1000).toLocaleString()} claims/sec, ` +
      `p50 ${adjudication.p50Ms.toFixed(3)}ms, p99 ${adjudication.p99Ms.toFixed(3)}ms, max ${adjudication.maxMs.toFixed(2)}ms`,
  );
  await record(
    "Adjudication",
    adjudication,
    "Single thread, reference data resident, every request drawn from a claim in the book.",
  );

  const pos = await benchmarkPointOfSale();
  console.log(
    `  point of sale: ${((pos.sample / pos.elapsedMs) * 1000).toFixed(1)} claims/sec, ` +
      `p50 ${pos.p50Ms.toFixed(1)}ms, p99 ${pos.p99Ms.toFixed(1)}ms, max ${pos.maxMs.toFixed(1)}ms`,
  );
  await record(
    "PointOfSale",
    pos,
    "Full round trip through the same endpoint the pharmacy terminal calls, including every database read: eligibility, drug, pharmacy, formulary, accumulators, claim history and clinical screening.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
