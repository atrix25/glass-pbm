import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { saveCopyOverride } from "@/lib/copy";
import { HttpError, readJson, route } from "@/lib/http";

/**
 * Save one wording change.
 *
 * The key is the text exactly as it was rendered, which the browser knows
 * because it read it out of the DOM before letting anyone type over it. A
 * replacement equal to the original, or null, removes the override and puts
 * the written copy back. An empty string clears the text on purpose.
 */
export const POST = route("POST /api/copy", async (request: Request) => {
  const { original, replacement } = await readJson<{
    original?: unknown;
    replacement?: unknown;
  }>(request);

  if (typeof original !== "string" || original.trim() === "") {
    throw new HttpError(400, "An override needs the original text to key off.");
  }

  if (replacement !== null && typeof replacement !== "string") {
    throw new HttpError(
      400,
      "Replacement must be a string, or null to clear it.",
    );
  }

  // Long enough for a paragraph, short enough that a runaway paste cannot turn
  // the overrides file into something nobody can read in a diff.
  if (typeof replacement === "string" && replacement.length > 4000) {
    throw new HttpError(
      400,
      "That is longer than any single piece of copy on the site.",
    );
  }

  const persisted = await saveCopyOverride(original, replacement);

  // Server components hold the override map, so every route has to be told
  // that the wording it rendered is now out of date.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, persisted });
});
