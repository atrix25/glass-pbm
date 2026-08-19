import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api/body";
import { prisma } from "@/lib/db";
import { RUBRIC_VERSION } from "@/lib/nps/rubric";
import { getClock } from "@/lib/session";

export const runtime = "nodejs";

const finiteNumber = z.number().finite();

const SEGMENTS = z.object({
  scored: finiteNumber,
  promoters: finiteNumber,
  passives: finiteNumber,
  detractors: finiteNumber,
  nps: finiteNumber,
});

/**
 * The post-change reading from the replay this decision was taken against.
 *
 * Only the parts that are filed are checked; a reading arrives from the same
 * page that computed it, but it is written straight into the history table, and
 * a snapshot is worth nothing if its figures are whatever was posted.
 */
const READING = z.object({
  census: SEGMENTS,
  surveyed: SEGMENTS,
  histogram: z.array(finiteNumber).max(64),
  drivers: z
    .array(
      z.object({
        id: z.string().max(120),
        membersAffected: finiteNumber,
        totalPoints: finiteNumber,
      }),
    )
    .max(200),
});

const BODY = z.object({
  label: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullish(),
  override: z.record(z.string(), z.unknown()),
  changeSummary: z.array(z.string().max(2000)).max(200),
  metrics: z.object({
    claimsEvaluated: finiteNumber,
    claimsChanged: finiteNumber,
    membersAffected: finiteNumber,
    planDeltaCents: finiteNumber,
    memberDeltaCents: finiteNumber,
    newRejects: finiteNumber,
  }),
  // Only the first hundred are stored, so a longer array is a larger request
  // than it can possibly need to be.
  diffs: z.array(z.unknown()).max(1000),
  nps: READING.nullish(),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, BODY);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const payload = JSON.stringify(body.override);
  const contentHash = createHash("sha256").update(payload).digest("hex");

  const version = await prisma.configVersion.create({
    data: {
      label: body.label,
      description: body.description ?? null,
      contentHash,
      payload,
      changeSummary: JSON.stringify(body.changeSummary),
      createdBy: "Steel Potatoes LLC — Benefits Director",
    },
  });

  await prisma.readjudicationRun.create({
    data: {
      configVersionId: version.id,
      baselineLabel: "Plan year 2026 as filed",
      claimsEvaluated: body.metrics.claimsEvaluated,
      claimsChanged: body.metrics.claimsChanged,
      membersAffected: body.metrics.membersAffected,
      planCostDeltaCents: body.metrics.planDeltaCents,
      memberCostDeltaCents: body.metrics.memberDeltaCents,
      newRejects: body.metrics.newRejects,
      diffPayload: JSON.stringify(body.diffs.slice(0, 100)),
    },
  });

  /*
   * Record where member experience lands under the new configuration, tagged
   * to the version that caused it.
   *
   * Taken from the replay the decision was actually made against rather than
   * recomputed here, for two reasons. Recomputing would score the stored book,
   * which still reflects the old design and would therefore file the old
   * number against the new version. And the number on the screen when somebody
   * pressed commit is the number they committed to; storing a different one
   * afterwards would make the history a record of something nobody saw.
   */
  if (body.nps) {
    const clock = await getClock();
    await prisma.npsSnapshot.create({
      data: {
        label: body.label,
        note: "Recorded automatically on committing this change.",
        clockAt: clock.now,
        rubricVersion: RUBRIC_VERSION,
        configVersionId: version.id,
        scored: body.nps.census.scored,
        promoters: body.nps.census.promoters,
        passives: body.nps.census.passives,
        detractors: body.nps.census.detractors,
        npsCensus: body.nps.census.nps,
        responded: body.nps.surveyed.scored,
        npsSurveyed: body.nps.surveyed.nps,
        distribution: JSON.stringify(body.nps.histogram),
        drivers: JSON.stringify(body.nps.drivers),
      },
    });
  }

  return NextResponse.json({ id: version.id, contentHash });
}
