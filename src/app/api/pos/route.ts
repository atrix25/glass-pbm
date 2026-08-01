import { NextResponse } from "next/server";
import { simulateFill, type PosRequest } from "@/lib/engine/pos";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as PosRequest;
  try {
    return NextResponse.json(await simulateFill(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Adjudication failed" },
      { status: 400 },
    );
  }
}
