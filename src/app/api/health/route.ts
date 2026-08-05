import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Readiness, not liveness.
 *
 * The book travels inside the image as a ~900 MB SQLite file, so the process
 * can be listening well before the database is actually readable. Answering
 * "yes" on the strength of the process being up is how a deploy reports
 * success against a machine that cannot serve a page. This touches the rollup,
 * which every dashboard reads, so a pass means the thing the app actually does
 * works.
 */
export async function GET() {
  try {
    const days = await prisma.bookDay.count();
    if (days === 0) {
      return NextResponse.json(
        { ok: false, reason: "no rollup rows: the book is not seeded" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, bookDays: days });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : "unknown" },
      { status: 503 },
    );
  }
}
