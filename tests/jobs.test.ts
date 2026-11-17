/**
 * Raw SQL must take part in the transaction that issued it.
 *
 * db.ts rewrites SQLite-flavoured raw SQL on its way into Postgres by
 * replacing $queryRaw and friends on the client. Prisma clones that client to
 * build the `tx` handed to a $transaction callback, so those replacements are
 * what a transaction callback calls too. If they forward to a captured client
 * instead of to `this`, the statement leaves on a pooled connection of its
 * own: it commits by itself, it survives a rollback, and any row lock it takes
 * is released the moment it returns.
 *
 * That last consequence is the one with teeth. claimNextJob picks the next job
 * with SELECT … FOR UPDATE SKIP LOCKED, which is only exclusive for as long as
 * the lock is held, so a lock released early hands the same job to every
 * worker that asks for one.
 */

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { claimNextJob, enqueueJob } from "@/lib/jobs";

/** A second connection, so "is that row locked" can be asked from outside. */
const observer = new PrismaClient();

const COPY_KEY = "__jobs-test-rollback-probe__";
const JOB_TYPE = "__jobs-test__";

afterAll(async () => {
  await prisma.copyOverride.deleteMany({ where: { original: COPY_KEY } });
  await prisma.jobRun.deleteMany({ where: { job: { type: JOB_TYPE } } });
  await prisma.job.deleteMany({ where: { type: JOB_TYPE } });
  await observer.$disconnect();
});

describe("raw SQL inside a transaction", () => {
  it("is rolled back with the transaction that issued it", async () => {
    await prisma.copyOverride.deleteMany({ where: { original: COPY_KEY } });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "CopyOverride" (id, original, replacement, "updatedAt")
          VALUES (${`${COPY_KEY}-id`}, ${COPY_KEY}, 'probe', now())
        `;
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow("deliberate rollback");

    expect(
      await prisma.copyOverride.count({ where: { original: COPY_KEY } }),
    ).toBe(0);
  });

  it("holds its row lock until the transaction ends", async () => {
    const job = await enqueueJob({ type: JOB_TYPE });

    let seenByObserver: Array<{ id: string }> = [];
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Job" WHERE id = $1 FOR UPDATE`,
        job.id,
      );
      // SKIP LOCKED returns nothing for a row somebody else has locked, which
      // is exactly how claimNextJob avoids handing one job to two workers.
      seenByObserver = await observer.$queryRawUnsafe(
        `SELECT id FROM "Job" WHERE id = $1 FOR UPDATE SKIP LOCKED`,
        job.id,
      );
    });

    expect(seenByObserver).toEqual([]);
  });
});

describe("claimNextJob", () => {
  it("claims a pending job once and records the run", async () => {
    await prisma.jobRun.deleteMany({ where: { job: { type: JOB_TYPE } } });
    await prisma.job.deleteMany({ where: { type: JOB_TYPE } });
    const queued = await enqueueJob({ type: JOB_TYPE });

    const claimed = await claimNextJob("worker-under-test");
    expect(claimed?.id).toBe(queued.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);

    expect(
      await prisma.jobRun.count({
        where: { jobId: queued.id, workerId: "worker-under-test" },
      }),
    ).toBe(1);

    // Nothing pending is left behind for a second worker to pick up.
    expect(await claimNextJob("worker-under-test-2")).toBeNull();
  });
});
