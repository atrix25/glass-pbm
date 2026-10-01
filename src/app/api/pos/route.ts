import { NextResponse } from "next/server";
import { simulateFill, type PosRequest } from "@/lib/engine/pos";
import { requireApiIdentity } from "@/lib/require-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

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
