import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { saveCopyOverride } from "@/lib/copy";
import { requireApiIdentity } from "@/lib/require-auth";

/**
 * Save one wording change.
 *
 * The key is the text exactly as it was rendered, which the browser knows
 * because it read it out of the DOM before letting anyone type over it. A
 * replacement equal to the original, or null, removes the override and puts
 * the written copy back. An empty string clears the text on purpose.
 */
export async function POST(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  let body: { original?: unknown; replacement?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const { original, replacement } = body;

  if (typeof original !== "string" || original.trim() === "") {
    return NextResponse.json(
      { error: "An override needs the original text to key off." },
      { status: 400 },
    );
  }

  if (replacement !== null && typeof replacement !== "string") {
    return NextResponse.json(
      { error: "Replacement must be a string, or null to clear it." },
      { status: 400 },
    );
  }

  // Long enough for a paragraph, short enough that a runaway paste cannot turn
  // the overrides file into something nobody can read in a diff.
  if (typeof replacement === "string" && replacement.length > 4000) {
    return NextResponse.json(
      { error: "That is longer than any single piece of copy on the site." },
      { status: 400 },
    );
  }

  const persisted = await saveCopyOverride(original, replacement);

  // Server components hold the override map, so every route has to be told
  // that the wording it rendered is now out of date.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, persisted });
}
