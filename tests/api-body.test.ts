/**
 * What an API route accepts.
 *
 * The routes used to read their bodies with a cast, which asserts a shape at
 * compile time over JSON that arrives from outside and checks nothing at run
 * time. These tests are about the two failures that mattered: a body that is not
 * JSON at all, which used to raise and answer 500, and a body of the right
 * shape carrying a value the code downstream cannot mean anything sensible by.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { idSchema, parseBody } from "@/lib/api/body";

function post(body: string): Request {
  return new Request("http://localhost/api/thing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const SCHEMA = z.object({
  paId: idSchema,
  days: z.number().int().positive().max(365),
});

describe("a request body is checked rather than asserted", () => {
  it("takes a body that satisfies the schema", async () => {
    const parsed = await parseBody(post(`{"paId":"pa-1","days":30}`), SCHEMA);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toEqual({ paId: "pa-1", days: 30 });
  });

  it("answers 400 rather than raising on a body that is not JSON", async () => {
    const parsed = await parseBody(post("not json at all"), SCHEMA);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response.status).toBe(400);
  });

  it("refuses a missing field and names it", async () => {
    const parsed = await parseBody(post(`{"days":30}`), SCHEMA);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      const { error } = (await parsed.response.json()) as { error: string };
      expect(error).toContain("paId");
    }
  });

  it("refuses a number outside the range the caller declared", async () => {
    for (const days of [0, -1, 366, 1.5, 1e308]) {
      const parsed = await parseBody(post(`{"paId":"pa-1","days":${days}}`), SCHEMA);
      expect(parsed.ok, `days: ${days}`).toBe(false);
    }
  });

  it("refuses an identifier carrying anything but an identifier", async () => {
    // The shapes that matter: SQL, a path, and a script, each of which used to
    // reach a query or a page as-is.
    for (const paId of ["' OR 1=1 --", "../../etc/passwd", "<script>", "a b", ""]) {
      const parsed = await parseBody(
        post(JSON.stringify({ paId, days: 30 })),
        SCHEMA,
      );
      expect(parsed.ok, paId).toBe(false);
    }
  });
});
