import { NextResponse } from "next/server";
import { HttpError, readJson, route } from "@/lib/http";
import { getClock } from "@/lib/session";
import { getCurrentReading, saveSnapshot } from "@/lib/queries/nps";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route("POST /api/nps/snapshot", async (request: Request) => {
  const body = await readJson<{ label?: string; note?: string }>(request);
  const label = body.label?.trim();
  if (!label) throw new HttpError(400, "A label is required.");

  const clock = await getClock();
  const reading = await getCurrentReading(clock);
  const id = await saveSnapshot({
    label,
    note: body.note ?? null,
    clock,
    reading,
  });

  return NextResponse.json({
    id,
    npsCensus: reading.census.nps,
    npsSurveyed: reading.surveyed.nps,
  });
});
