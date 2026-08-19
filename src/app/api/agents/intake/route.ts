import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runIntake } from "@/lib/agents/pa-intake/agent";
import { HttpError, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Runs the intake agent live against a request that is already in the book.
 *
 * The run is not persisted. The corpus already holds one recorded run per
 * request, and writing a second every time somebody clicks the button would
 * turn the operations page into a log of people pressing buttons.
 */
export const POST = route(
  "POST /api/agents/intake",
  async (request: Request) => {
    const { paId } = await readJson<{ paId?: string }>(request);
    if (!paId) throw new HttpError(400, "A request id is required.");

    const [note, pa] = await Promise.all([
      prisma.clinicalNote.findUnique({ where: { paId } }),
      prisma.priorAuthorization.findUnique({
        where: { id: paId },
        select: {
          paNumber: true,
          determination: true,
          decidingStepNumber: true,
          decidedBy: true,
          drug: { select: { name: true } },
          tree: { select: { name: true } },
        },
      }),
    ]);
    if (!note || !pa) throw new HttpError(404, "No such request.");

    const { run, result } = await runIntake({ paId, persist: false });
    const snapshot = run.snapshot(
      result.outcome === "Escalated" ? "Escalated" : "Completed",
      result.escalationReason ?? "Answer set filled from the note.",
    );

    return NextResponse.json({
      paNumber: pa.paNumber,
      drug: pa.drug.name,
      tree: pa.tree?.name ?? null,
      note: { body: note.body, channel: note.channel, author: note.author },
      onFile: {
        determination: pa.determination,
        decidingStep: pa.decidingStepNumber,
        decidedBy: pa.decidedBy,
      },
      result,
      steps: snapshot.steps.map((s) => ({
        kind: s.kind,
        tool: s.tool,
        because: s.because,
        summary: s.summary,
        brain: s.brain,
        elapsedMs: s.elapsedMs,
      })),
      brain: snapshot.brain,
      elapsedMs: snapshot.elapsedMs,
      autonomy: snapshot.autonomy,
    });
  },
);
