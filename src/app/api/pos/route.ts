import { NextResponse } from "next/server";
import { simulateFill, type PosRequest } from "@/lib/engine/pos";
import { HttpError, readJson, route } from "@/lib/http";

export const runtime = "nodejs";

export const POST = route("POST /api/pos", async (request: Request) => {
  const body = await readJson<PosRequest>(request);
  try {
    return NextResponse.json(await simulateFill(body));
  } catch (error) {
    // A fill the engine refuses is a bad request, not a broken server: the
    // terminal shows the reason next to the field that caused it. Logged all
    // the same, because a missing drug row and a bad quantity both land here
    // and only one of them is the caller's fault.
    console.error("[api] POST /api/pos could not adjudicate", error);
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Adjudication failed",
    );
  }
});
