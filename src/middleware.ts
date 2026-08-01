import { NextResponse, type NextRequest } from "next/server";

// The demo runs on a public URL against a book of synthetic members built from
// a real, named contract. A shared password keeps it from being read as an
// official ETF or Navitus system by anyone who stumbles onto the host.
// Unset DEMO_PASSWORD disables the gate, which is what local development wants.

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
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (constantTimeEqual(password, expected)) return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
