import { NextResponse } from "next/server";
import { getClock } from "@/lib/session";
import { getCurrentReading, saveSnapshot } from "@/lib/queries/nps";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json()) as { label?: string; note?: string };
  const label = body.label?.trim();
  if (!label) {
    return NextResponse.json({ error: "A label is required." }, { status: 400 });
  }

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
}
