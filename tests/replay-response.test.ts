import { describe, expect, it } from "vitest";
import {
  assertFinishedReplayResponse,
  isReplayJobEnvelope,
} from "@/lib/engine/replay-response";

describe("replay API response shape", () => {
  it("treats a 202 job envelope as unfinished", () => {
    expect(
      isReplayJobEnvelope({ jobId: "job_123", status: "queued" }),
    ).toBe(true);
  });

  it("rejects casting a job envelope as a finished money result", () => {
    expect(() =>
      assertFinishedReplayResponse({ jobId: "job_123", status: "queued" }),
    ).toThrow(/background job/);
  });

  it("accepts a finished replay body with claimsEvaluated", () => {
    const body = {
      claimsEvaluated: 10,
      claimsChanged: 2,
      planPaidBeforeCents: 100,
      planPaidAfterCents: 80,
    };
    expect(isReplayJobEnvelope(body)).toBe(false);
    expect(assertFinishedReplayResponse(body)).toEqual(body);
  });
});
