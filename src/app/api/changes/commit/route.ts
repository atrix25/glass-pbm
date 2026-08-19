import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ConfigOverride } from "@/lib/engine/replay";
import { HttpError, readJson, route } from "@/lib/http";
import type { NpsReading } from "@/lib/nps/reading";
import { RUBRIC_VERSION } from "@/lib/nps/rubric";
import { getClock } from "@/lib/session";

export const runtime = "nodejs";

interface CommitBody {
  label: string;
  description?: string;
  override: ConfigOverride;
  changeSummary: string[];
  metrics: {
    claimsEvaluated: number;
    claimsChanged: number;
    membersAffected: number;
    planDeltaCents: number;
    memberDeltaCents: number;
    newRejects: number;
  };
  diffs: unknown[];
  /** The post-change reading from the replay this decision was taken against. */
  nps?: NpsReading | null;
}

export const POST = route(
  "POST /api/changes/commit",
  async (request: Request) => {
    const body = await readJson<CommitBody>(request);
    if (!body?.label?.trim()) {
      throw new HttpError(400, "A change needs a label to be committed under.");
    }
    if (!body.override || !body.metrics) {
      throw new HttpError(
        400,
        "A commit needs the override and the metrics it was measured at.",
      );
    }

    const payload = JSON.stringify(body.override);
    const contentHash = createHash("sha256").update(payload).digest("hex");

    const clock = body.nps ? await getClock() : null;

    /*
     * One transaction, because a version without its run is not a history.
     *
     * These three rows are one fact: this configuration was committed, measured
     * against this replay, at this member-experience reading. Written
     * independently, a failure on the second left a committed version on
     * /changes with no numbers beside it and nothing saying why.
     */
    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.configVersion.create({
        data: {
          label: body.label,
          description: body.description ?? null,
          contentHash,
          payload,
          changeSummary: JSON.stringify(body.changeSummary),
          createdBy: "Steel Potatoes LLC — Benefits Director",
        },
      });

      await tx.readjudicationRun.create({
        data: {
          configVersionId: created.id,
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
      if (body.nps && clock) {
        await tx.npsSnapshot.create({
          data: {
            label: body.label,
            note: "Recorded automatically on committing this change.",
            clockAt: clock.now,
            rubricVersion: RUBRIC_VERSION,
            configVersionId: created.id,
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

      return created;
    });

    return NextResponse.json({ id: version.id, contentHash });
  },
);
