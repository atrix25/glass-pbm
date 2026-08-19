import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api/body";
import { replay, type ConfigOverride } from "@/lib/engine/replay";

export const runtime = "nodejs";
export const maxDuration = 120;

// The engine reads only the override fields it knows, so what is checked here
// is the envelope: an object, and a sample rate that is genuinely a fraction.
// The rate is the interesting one — zero or negative samples nothing and would
// answer "nothing would change" to every question asked of the console.
const BODY = z.union([
  z.object({
    override: z.record(z.string(), z.unknown()).optional(),
    sampleRate: z.number().gt(0).lte(1).optional(),
  }),
  z.record(z.string(), z.unknown()),
]);

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
  const parsed = await parseBody(request, BODY);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data as ReplayBody | ConfigOverride;

  // Older callers posted the override at the top level. Accepting both keeps a
  // saved request or a copied fetch working.
  const isWrapped = typeof body === "object" && body !== null && "override" in body;
  const override = ((isWrapped ? (body as ReplayBody).override : body) ?? {}) as ConfigOverride;
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
