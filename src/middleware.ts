import { NextResponse, type NextRequest } from "next/server";

// The demo runs on a public URL against a book of synthetic members built from
// a real, named contract. A shared name and password keep it from being read as
// an official ETF or Navitus system by anyone who stumbles onto the host.
// Unset DEMO_PASSWORD disables the gate, which is what local development wants.

// Overridable so the deployed host can change them without a code change, but
// defaulted so there is one fewer secret to keep in step with the invitations.
const USERNAME = process.env.DEMO_USERNAME ?? "josh";
const SECOND_USERNAME = process.env.DEMO_USERNAME_2 ?? "test";
const SECOND_PASSWORD = process.env.DEMO_PASSWORD_2 ?? "glasspba";

// Header values are Latin-1; keep this ASCII.
const REALM = 'Basic realm="Glass proof of concept", charset="UTF-8"';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function middleware(request: NextRequest) {
  const expected = process.env.DEMO_PASSWORD;
  if (!expected) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    const split = decoded.indexOf(":");
    if (split !== -1) {
      const username = decoded.slice(0, split);
      const password = decoded.slice(split + 1);

      // Two sets of credentials, so a link can go to someone without handing
      // over the one the rest of the invitations carry. Every pair is checked
      // before any is acted on: returning as soon as one matches would make a
      // correct name measurably slower to reject than a wrong one.
      let ok = false;
      for (const account of [
        { username: USERNAME, password: expected },
        { username: SECOND_USERNAME, password: SECOND_PASSWORD },
      ]) {
        const nameOk = constantTimeEqual(username, account.username);
        const passwordOk = constantTimeEqual(password, account.password);
        ok = (nameOk && passwordOk) || ok;
      }
      if (ok) return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

// The health check is excluded: Fly's checker cannot authenticate, and a
// readiness probe that answers 401 is a probe that always fails.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
