import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * The parsed body of a request, or the response to send instead.
 *
 * Route handlers here previously cast `await request.json()` straight to the
 * shape they wanted, which is a claim about the caller rather than a check on
 * it: a missing field arrived as `undefined` and surfaced deep in a query, and
 * a malformed body threw before the handler ran and answered 500. Both are the
 * caller's error and should be reported as one, in the handler, against a
 * schema that says what the endpoint accepts.
 */
export type Parsed<T> =
  { ok: true; data: T } | { ok: false; response: NextResponse };

export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<Parsed<z.output<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Expected a JSON body." },
        { status: 400 },
      ),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: parsed.error.issues
            .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
            .join("; "),
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * An identifier as it appears in this book: `mbr-DEMO-0001-01`, `pa-000123`.
 *
 * Bounded and restricted to the characters those ids actually use, so an id is
 * rejected at the edge rather than travelling into a query as arbitrary text.
 */
export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "not a valid identifier");
