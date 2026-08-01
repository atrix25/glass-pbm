import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ConfigOverride } from "@/lib/engine/replay";

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
}

export async function POST(request: Request) {
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
      createdBy: "Wisconsin ETF — Benefits Director",
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

  return NextResponse.json({ id: version.id, contentHash });
}
