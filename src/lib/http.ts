import { NextResponse } from "next/server";

/**
 * What a route answers when it cannot do what was asked.
 *
 * Every route in this application is called by a component that renders the
 * failure to somebody: the POS terminal shows the reject, the reviewer console
 * shows the refusal. That only works when the answer is JSON with a status the
 * caller can act on. An uncaught throw is not that — Next answers it with an
 * opaque 500 whose body is HTML, the browser's `res.json()` then throws on the
 * HTML, and the page reports "the request did not reach the server" about a
 * request that reached it and failed inside.
 */

/** An error whose message and status are meant for the caller. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Parse the request body, answering 400 rather than 500 on malformed JSON. */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Expected a JSON body.");
  }
}

/**
 * Wrap a route so anything thrown inside becomes a JSON answer and a log line.
 *
 * The log matters as much as the status. These handlers run replays over the
 * whole book and write determinations, and a failure that only ever appeared as
 * a 500 in the browser left nothing on the server saying which query or which
 * row caused it.
 */
export function route<T extends Request>(
  name: string,
  handler: (request: T) => Promise<Response>,
): (request: T) => Promise<Response> {
  return async (request: T) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status },
        );
      }
      console.error(`[api] ${name} failed`, error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "The server could not complete that.",
        },
        { status: 500 },
      );
    }
  };
}
