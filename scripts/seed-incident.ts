/**
 * The bad week.
 *
 * A book where nothing ever goes wrong is a book nobody believes, and more to
 * the point it never exercises the machinery that matters: what happens when
 * the plan misses a promise it made in writing. This puts one genuine service
 * degradation into the year — a clinical review queue that backed up behind a
 * failed integration — and leaves the consequences to be discovered by the
 * scorecard rather than recorded here.
 *
 * Nothing is written that says "this guarantee was missed". The decisions
 * simply took longer, the way they would have, and the reconciliation reads
 * that off the case records and computes the credit itself.
 *
 *   npx tsx scripts/seed-incident.ts
 */

import { prisma } from "../src/lib/db.js";
import { Rng } from "./seed/population.js";
import { PLAN_YEAR } from "../src/lib/clock.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Four days in June: Monday the 15th through Thursday the 18th. */
const INCIDENT_START = new Date(Date.UTC(PLAN_YEAR, 5, 15, 6, 0, 0));
const INCIDENT_END = new Date(Date.UTC(PLAN_YEAR, 5, 18, 22, 0, 0));

async function main() {
  console.log("Seeding the incident...");
  const rng = new Rng(90210);

  await prisma.serviceIncident.deleteMany();

  /*
   * The queue backs up. Requests that arrive during the window wait behind
   * whatever is in front of them, so the delay grows through the incident and
   * then drains over the two days after it is fixed rather than snapping back.
   */
  const affected = await prisma.priorAuthorization.findMany({
    where: {
      receivedAt: { gte: INCIDENT_START, lte: INCIDENT_END },
      decidedAt: { not: null },
    },
    select: {
      id: true,
      urgency: true,
      receivedAt: true,
      decidedAt: true,
      decisionDueAt: true,
    },
  });

  const span = INCIDENT_END.getTime() - INCIDENT_START.getTime();
  let standardLate = 0;
  let expeditedLate = 0;

  for (const pa of affected) {
    const through = (pa.receivedAt.getTime() - INCIDENT_START.getTime()) / span;
    /*
     * Expedited requests are worked by hand when the queue stalls, so most of
     * them still land inside the day. Standard requests are what the backlog
     * is made of.
     */
    const expedited = pa.urgency === "Expedited";
    const stall = expedited
      ? rng.bool(0.35 * through)
        ? rng.int(25, 40)
        : 0
      : rng.bool(0.25 + 0.55 * through)
        ? rng.int(74, 150)
        : 0;
    if (stall === 0) continue;

    const decidedAt = new Date(pa.receivedAt.getTime() + stall * HOUR_MS);
    await prisma.priorAuthorization.update({
      where: { id: pa.id },
      data: { decidedAt },
    });
    if (expedited) expeditedLate++;
    else standardLate++;
  }

  /*
   * The same integration carried the eligibility feed, so the files that
   * landed during the window sat in the inbox until it came back.
   */
  const files = await prisma.eligibilityFile.findMany({
    where: { receivedAt: { gte: INCIDENT_START, lte: INCIDENT_END } },
    select: { id: true, receivedAt: true },
  });
  for (const f of files) {
    await prisma.eligibilityFile.update({
      where: { id: f.id },
      data: {
        processedAt: new Date(
          Math.max(
            f.receivedAt.getTime() + 3 * DAY_MS,
            INCIDENT_END.getTime() + 6 * HOUR_MS,
          ),
        ),
      },
    });
  }

  await prisma.serviceIncident.create({
    data: {
      id: "incident-2026-06-15",
      startedAt: INCIDENT_START,
      endedAt: INCIDENT_END,
      // Told the same morning it was found, not in the quarterly review.
      notifiedAt: new Date(INCIDENT_START.getTime() + 5 * HOUR_MS),
      title: "Clinical review queue backlog",
      severity: "Degraded",
      summary:
        `Prior authorisation decisions and eligibility file loading were delayed for ` +
        `four days. ${standardLate} standard and ${expeditedLate} expedited requests ` +
        `were decided outside the contracted turnaround, and ${files.length} eligibility ` +
        `files loaded late. No claim was misadjudicated and no member was charged ` +
        `incorrectly; the delay was in deciding, not in pricing.`,
      cause:
        "A schema change at the electronic prior authorisation vendor silently dropped " +
        "the attachment payload on inbound requests. Requests arrived without the " +
        "clinical documentation attached and fell out of automated review into the " +
        "manual queue, which had been sized for a tenth of that volume.",
      remedy:
        "Inbound payloads are now validated against the published schema at the edge " +
        "and a request missing its attachment is rejected back to the prescriber " +
        "within the minute rather than accepted and queued. Queue depth beyond two " +
        "hours of work now pages, and the daily operations page carries the oldest " +
        "undecided request in the queue.",
      guaranteeId: "pa-standard",
    },
  });

  console.log(
    `  ${affected.length} requests in the window, ${standardLate} standard and ` +
      `${expeditedLate} expedited decided late, ${files.length} files delayed`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
