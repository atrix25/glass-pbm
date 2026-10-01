import { NextResponse } from "next/server";
import { enqueueJob } from "@/lib/jobs";
import { getClock } from "@/lib/session";
import { getCurrentReading, saveSnapshot } from "@/lib/queries/nps";
import { recordAudit } from "@/lib/audit";
import { requireApiIdentity } from "@/lib/require-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const body = (await request.json()) as {
    label?: string;
    note?: string;
    async?: boolean;
  };
  const label = body.label?.trim();
  if (!label) {
    return NextResponse.json({ error: "A label is required." }, { status: 400 });
  }

  if (body.async) {
    const clock = await getClock();
    const job = await enqueueJob({
      type: "nps_snapshot",
      payload: {
        label,
        note: body.note ?? null,
        clockIso: clock.now.toISOString(),
      },
    });
    await recordAudit({
      action: "job.enqueue",
      entity: "Job",
      entityId: job.id,
      detail: { type: "nps_snapshot" },
    });
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  }

  const clock = await getClock();
  const reading = await getCurrentReading(clock);
  const id = await saveSnapshot({
    label,
    note: body.note ?? null,
    clock,
    reading,
  });
  await recordAudit({
    action: "nps.snapshot",
    entity: "NpsSnapshot",
    entityId: id,
    detail: { label },
  });

  return NextResponse.json({
    id,
    npsCensus: reading.census.nps,
    npsSurveyed: reading.surveyed.nps,
  });
}
