import { NextResponse } from "next/server";
import { replay, type ConfigOverride } from "@/lib/engine/replay";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ReplayBody {
  override: ConfigOverride;
  /**
   * Between 0 and 1 to project from a sample instead of measuring the book.
   *
   * A full run walks 1.7 million claims and takes half a minute, which is the
   * right cost for a decision and the wrong one for a slider somebody is still
   * moving. The projection runs the identical engine over a fixed fraction of
   * members so the console can answer immediately, then be corrected.
   */
  sampleRate?: number;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ReplayBody | ConfigOverride;

  // Older callers posted the override at the top level. Accepting both keeps a
  // saved request or a copied fetch working.
  const isWrapped = typeof body === "object" && body !== null && "override" in body;
  const override = (isWrapped ? (body as ReplayBody).override : body) ?? {};
  const sampleRate = isWrapped ? (body as ReplayBody).sampleRate : undefined;
  const projecting = sampleRate !== undefined && sampleRate < 1;

  const result = await replay(override, {
    // Diffs are per-claim examples, and examples drawn from a twelfth of the
    // book invite a reader to check one against a page that will not have it.
    maxDiffs: projecting ? 0 : 200,
    // Scored on every run rather than behind a second button. A change's effect
    // on members is not supplementary information to be fetched if somebody
    // thinks to ask for it; it is half of what the change is.
    nps: true,
    sampleRate,
  });

  return NextResponse.json(result);
}
