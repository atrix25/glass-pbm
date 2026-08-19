/**
 * One POST, with the failures actually reported.
 *
 * The pattern this replaces was `const data = await res.json()` with no look at
 * `res.ok`, which reads a rejection body as if it were a result: a 400 carrying
 * `{ error }` became an answer object with every field undefined, and the page
 * rendered it as success. Anything non-2xx is raised here, carrying the server's
 * own `error` text when there is one, so a caller's catch has something true to
 * show.
 */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Read as text first: a route that failed before its handler ran answers with
  // HTML, and parsing that as JSON would throw over the status code that is the
  // one useful thing in the response.
  const raw = await res.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    throw new Error(
      serverError(parsed) ?? `The server answered ${res.status}.`,
    );
  }

  if (parsed === null) {
    throw new Error("The server answered without a body.");
  }

  return parsed as T;
}

/** The message to show a reader for a failed request, never an empty string. */
export function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return fallback;
}

function serverError(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const { error } = parsed as { error?: unknown };
  return typeof error === "string" && error.trim() !== "" ? error : null;
}
