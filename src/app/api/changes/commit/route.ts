import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ConfigOverride } from "@/lib/engine/replay";
import type { NpsReading } from "@/lib/nps/reading";
import { RUBRIC_VERSION } from "@/lib/nps/rubric";
import { getClock, getSessionUser } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { canMutate } from "@/lib/auth";
import { demoFeaturesEnabled } from "@/lib/config";

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

export async function POST(request: Request) {
  if (!demoFeaturesEnabled()) {
    const user = await getSessionUser();
    if (!user || !canMutate(user.role)) {
      return NextResponse.json({ error: "Insufficient role." }, { status: 403 });
    }
  }

  const body = (await request.json()) as CommitBody;
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

  const actor = await getSessionUser();
  await recordAudit({
    actorId: actor?.id,
    action: "config.commit",
    entity: "ConfigVersion",
    entityId: version.id,
    detail: { label: body.label, contentHash },
  });

  return NextResponse.json({ id: version.id, contentHash });
}
