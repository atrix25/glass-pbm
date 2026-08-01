import { NextResponse } from "next/server";
import { replay, type ConfigOverride } from "@/lib/engine/replay";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const override = (await request.json()) as ConfigOverride;
  const result = await replay(override, { maxDiffs: 200 });
  return NextResponse.json(result);
}
