import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness only — process is up. Used by orchestrators that should not
 * flap when the database is briefly unavailable.
 */
export async function GET() {
  return NextResponse.json({ ok: true, live: true });
}
