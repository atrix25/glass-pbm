import { NextResponse } from "next/server";
import { enqueueJob, getJob } from "@/lib/jobs";
import { replay, type ConfigOverride } from "@/lib/engine/replay";
import { recordAudit } from "@/lib/audit";
import { getClock } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ReplayBody {
  override: ConfigOverride;
  sampleRate?: number;
  /** When true (default for full-book runs), enqueue a worker job instead. */
  async?: boolean;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ReplayBody | ConfigOverride;
  const isWrapped = typeof body === "object" && body !== null && "override" in body;
  const override = (isWrapped ? (body as ReplayBody).override : body) ?? {};
  const sampleRate = isWrapped ? (body as ReplayBody).sampleRate : undefined;
  const projecting = sampleRate !== undefined && sampleRate < 1;
  const wantAsync =
    isWrapped && (body as ReplayBody).async === true
      ? true
      : isWrapped && (body as ReplayBody).async === false
        ? false
        : !projecting;

  // The change console models impact against the simulated present. Without
  // this cut, a mid-year pin would reprice November and December fills that
  // have not happened and invent plan/member deltas.
  const clock = await getClock();
  const asOf = clock.now;
  const asOfIso = asOf.toISOString();

  if (wantAsync) {
    const job = await enqueueJob({
      type: "replay",
      payload: {
        override,
        sampleRate,
        nps: true,
        maxDiffs: projecting ? 0 : 200,
        asOfIso,
      },
    });
    await recordAudit({
      action: "job.enqueue",
      entity: "Job",
      entityId: job.id,
      detail: { type: "replay" },
    });
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  }

  const result = await replay(override, {
    maxDiffs: projecting ? 0 : 200,
    nps: true,
    sampleRate,
    asOf,
  });
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("jobId");
  if (!id) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    result: job.result ? JSON.parse(job.result) : null,
  });
}
