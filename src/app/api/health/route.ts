import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Readiness: Postgres reachable and the daily rollup is present.
 * Fly http_service.checks should hit this path.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const days = await prisma.bookDay.count();
    if (days === 0) {
      return NextResponse.json(
        { ok: false, ready: false, reason: "no rollup rows: the book is not seeded" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ready: true, bookDays: days });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        ready: false,
        reason: e instanceof Error ? e.message : "unknown",
      },
      { status: 503 },
    );
  }
}
