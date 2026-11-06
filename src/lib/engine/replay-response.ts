/**
 * Shape checks for /api/replay responses.
 *
 * The route returns either a finished ReplayResult JSON body (sync path) or a
 * 202 job envelope `{ jobId, status }` when it enqueues a worker. The change
 * console Measure path historically cast every JSON body as a finished result,
 * so a job envelope was rendered as plan/member deltas and crashed in
 * formatNumber(undefined). These helpers keep that class of bug loud at the
 * boundary instead of in the money UI.
 */

export function isReplayJobEnvelope(
  json: unknown,
): json is { jobId: string; status?: string } {
  if (!json || typeof json !== "object") return false;
  const body = json as Record<string, unknown>;
  return typeof body.jobId === "string" && typeof body.claimsEvaluated !== "number";
}

export function assertFinishedReplayResponse<T extends { claimsEvaluated: number }>(
  json: unknown,
): T {
  if (isReplayJobEnvelope(json)) {
    throw new Error(
      `Replay is still a background job (${json.jobId}). The change console must request a synchronous run or poll until the worker finishes.`,
    );
  }
  if (
    !json ||
    typeof json !== "object" ||
    typeof (json as { claimsEvaluated?: unknown }).claimsEvaluated !== "number"
  ) {
    throw new Error("Replay response was missing claimsEvaluated.");
  }
  return json as T;
}
