/**
 * The behaviour that failures are reported rather than absorbed.
 *
 * Both helpers under test exist because the alternative is silent: a route that
 * threw answered with whatever the framework chose, and a client that never
 * looked at the status code rendered a rejection body as a result. Neither
 * shows up in a screenshot of the happy path, so it is asserted here.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { HttpError, readJson, route } from "@/lib/http";
import { describeFailure, postJson } from "@/lib/post-json";

function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/thing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("readJson", () => {
  it("reads a well-formed body", async () => {
    const body = await readJson<{ a: number }>(jsonRequest('{"a":1}'));
    expect(body.a).toBe(1);
  });

  it("answers 400 rather than 500 on malformed JSON", async () => {
    await expect(readJson(jsonRequest("{not json"))).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a successful answer through untouched", async () => {
    const handler = route("POST /api/thing", async () =>
      Response.json({ ok: true }),
    );
    const res = await handler(jsonRequest("{}"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("keeps the status and wording of a deliberate refusal", async () => {
    const handler = route("POST /api/thing", async () => {
      throw new HttpError(409, "Already decided.");
    });
    const res = await handler(jsonRequest("{}"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Already decided." });
  });

  it("turns an unexpected failure into a logged 500 carrying JSON", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = route("POST /api/thing", async () => {
      throw new Error("the book is not readable");
    });
    const res = await handler(jsonRequest("{}"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "the book is not readable" });
    expect(logged).toHaveBeenCalledOnce();
  });
});

describe("postJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function answering(status: number, body: string, type = "application/json") {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status, headers: { "Content-Type": type } }),
    );
  }

  it("returns the parsed body of a successful answer", async () => {
    answering(200, '{"paNumber":"PA-1"}');
    await expect(postJson("/api/thing", {})).resolves.toEqual({
      paNumber: "PA-1",
    });
  });

  it("raises the server's own wording on a refusal", async () => {
    answering(400, '{"error":"An appeal must name what it contests."}');
    await expect(postJson("/api/thing", {})).rejects.toThrow(
      "An appeal must name what it contests.",
    );
  });

  it("raises the status when the answer is not JSON at all", async () => {
    answering(502, "<html>Bad gateway</html>", "text/html");
    await expect(postJson("/api/thing", {})).rejects.toThrow("502");
  });
});

describe("describeFailure", () => {
  it("prefers the error's own message", () => {
    expect(describeFailure(new Error("No such request."), "fallback")).toBe(
      "No such request.",
    );
  });

  it("falls back for a thrown non-error or an empty message", () => {
    expect(describeFailure(new Error("  "), "fallback")).toBe("fallback");
    expect(describeFailure("nope", "fallback")).toBe("fallback");
  });
});
