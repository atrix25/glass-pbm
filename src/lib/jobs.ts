import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";

export type JobType = "account_management" | "replay" | "nps_snapshot" | "rollup_refresh" | "enrich_batch";

export type EnqueueJobInput = {
  type: JobType | string;
  payload?: Record<string, unknown>;
  createdById?: string | null;
  maxAttempts?: number;
};

export async function enqueueJob(input: EnqueueJobInput) {
  return prisma.job.create({
    data: {
      type: input.type,
      payload: JSON.stringify(input.payload ?? {}),
      createdById: input.createdById ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      status: "pending",
    },
  });
}

export async function getJob(id: string) {
  return prisma.job.findUnique({ where: { id }, include: { runs: true } });
}

/**
 * Claim the next pending job. Uses SKIP LOCKED so multiple workers can poll
 * the same queue without double-processing.
 */
export async function claimNextJob(workerId: string) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Job"
      WHERE status = 'pending' AND attempts < "maxAttempts"
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (!id) return null;

    const job = await tx.job.update({
      where: { id },
      data: {
        status: "running",
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    await tx.jobRun.create({
      data: { jobId: id, workerId },
    });

    return job;
  });
}

export async function completeJob(
  id: string,
  result: Record<string, unknown>,
): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: {
      status: "succeeded",
      progress: 1,
      result: JSON.stringify(result),
      finishedAt: new Date(),
      error: null,
    },
  });
  await prisma.jobRun.updateMany({
    where: { jobId: id, finishedAt: null },
    data: { finishedAt: new Date() },
  });
}

export async function failJob(id: string, error: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return;
  const retry = job.attempts < job.maxAttempts;
  await prisma.job.update({
    where: { id },
    data: {
      status: retry ? "pending" : "failed",
      error,
      finishedAt: retry ? null : new Date(),
      startedAt: retry ? null : job.startedAt,
    },
  });
  await prisma.jobRun.updateMany({
    where: { jobId: id, finishedAt: null },
    data: { finishedAt: new Date(), error },
  });
}

export async function setJobProgress(id: string, progress: number): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { progress: Math.min(1, Math.max(0, progress)) },
  });
}

export { Prisma };
