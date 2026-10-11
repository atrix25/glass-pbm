/**
 * Background worker: claims Postgres jobs with SKIP LOCKED and runs them.
 *
 *   npx tsx scripts/worker.ts
 *
 * On Fly this is the `worker` process group in fly.toml.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import {
  claimNextJob,
  completeJob,
  failJob,
  setJobProgress,
} from "../src/lib/jobs";
import { replay } from "../src/lib/engine/replay";
import { getCurrentReading, saveSnapshot } from "../src/lib/queries/nps";
import { resolveClock } from "../src/lib/clock";
import { refreshBookDayRollups } from "../src/lib/rollups";

const WORKER_ID = process.env.FLY_MACHINE_ID ?? `worker-${randomBytes(4).toString("hex")}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);

async function handleJob(type: string, payload: Record<string, unknown>, jobId: string) {
  switch (type) {
    case "replay": {
      await setJobProgress(jobId, 0.05);
      const result = await replay((payload.override as object) ?? {}, {
        maxDiffs: typeof payload.maxDiffs === "number" ? payload.maxDiffs : 200,
        nps: payload.nps !== false,
        sampleRate: typeof payload.sampleRate === "number" ? payload.sampleRate : undefined,
      });
      await setJobProgress(jobId, 1);
      return result;
    }
    case "nps_snapshot": {
      const clock = resolveClock(
        typeof payload.clockIso === "string" ? payload.clockIso : undefined,
      );
      const reading = await getCurrentReading(clock);
      const id = await saveSnapshot({
        label: String(payload.label ?? "Scheduled snapshot"),
        note: typeof payload.note === "string" ? payload.note : null,
        clock,
        reading,
      });
      return {
        id,
        npsCensus: reading.census.nps,
        npsSurveyed: reading.surveyed.nps,
      };
    }
    case "rollup_refresh": {
      const stats = await refreshBookDayRollups(
        typeof payload.fromIso === "string" ? new Date(payload.fromIso) : undefined,
        typeof payload.toIso === "string" ? new Date(payload.toIso) : undefined,
      );
      return stats;
    }
    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}

async function tick() {
  const job = await claimNextJob(WORKER_ID);
  if (!job) return false;
  console.log(`[worker ${WORKER_ID}] claimed ${job.id} (${job.type})`);
  try {
    const payload = JSON.parse(job.payload || "{}") as Record<string, unknown>;
    const result = await handleJob(job.type, payload, job.id);
    await completeJob(job.id, (result as Record<string, unknown>) ?? {});
    console.log(`[worker ${WORKER_ID}] completed ${job.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker ${WORKER_ID}] failed ${job.id}:`, message);
    await failJob(job.id, message);
  }
  return true;
}

async function main() {
  console.log(`[worker ${WORKER_ID}] starting`);
  // Touch DB so a bad DATABASE_URL fails fast.
  await prisma.$queryRaw`SELECT 1`;
  for (;;) {
    try {
      const worked = await tick();
      if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error(`[worker ${WORKER_ID}] tick error`, err);
      await new Promise((r) => setTimeout(r, POLL_MS * 2));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
