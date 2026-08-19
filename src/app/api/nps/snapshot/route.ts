import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api/body";
import { getClock } from "@/lib/session";
import { getCurrentReading, saveSnapshot } from "@/lib/queries/nps";

export const runtime = "nodejs";
export const maxDuration = 120;

const BODY = z.object({
  label: z.string().trim().min(1).max(200),
  note: z.string().max(4000).nullish(),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, BODY);
  if (!parsed.ok) return parsed.response;
  const { label, note } = parsed.data;

  const clock = await getClock();
  const reading = await getCurrentReading(clock);
  const id = await saveSnapshot({
    label,
    note: note ?? null,
    clock,
    reading,
  });

  return NextResponse.json({
    id,
    npsCensus: reading.census.nps,
    npsSurveyed: reading.surveyed.nps,
  });
}
