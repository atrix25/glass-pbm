import { NextResponse, type NextRequest } from "next/server";
import { authMode } from "@/lib/config";

// Production gate: session cookie or API key. Basic auth remains available for
// DEMO_FEATURES / AUTH_MODE=basic. /api/health and /api/health/live stay open.
//
// In session|oidc mode the edge can only see that a cookie is present. Node
// layouts and API routes must call requirePageSession / requireApiIdentity so
// a forged or expired glass_session value cannot read the book.

const USERNAME = process.env.DEMO_USERNAME ?? "josh";
const SECOND_USERNAME = process.env.DEMO_USERNAME_2 ?? "test";
const SECOND_PASSWORD = process.env.DEMO_PASSWORD_2 ?? "glasspba";
const REALM = 'Basic realm="Glass", charset="UTF-8"';
const SESSION_COOKIE = "glass_session";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function checkBasic(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const split = decoded.indexOf(":");
  if (split === -1) return false;
  const username = decoded.slice(0, split);
  const password = decoded.slice(split + 1);
  let ok = false;
  for (const account of [
    { username: USERNAME, password: expected },
    { username: SECOND_USERNAME, password: SECOND_PASSWORD },
  ]) {
    const nameOk = constantTimeEqual(username, account.username);
    const passwordOk = constantTimeEqual(password, account.password);
    ok = (nameOk && passwordOk) || ok;
  }
  return ok;
}

export function middleware(request: NextRequest) {
  const mode = authMode();
  if (mode === "open") return NextResponse.next();

  // Service API key for POS / switch adapters (Bearer or X-Api-Key).
  const apiKey =
    request.headers.get("x-api-key") ??
    (request.headers.get("authorization")?.startsWith("Bearer glass_")
      ? request.headers.get("authorization")!.slice(7)
      : null);
  if (apiKey && process.env.SERVICE_API_KEY) {
    if (constantTimeEqual(apiKey, process.env.SERVICE_API_KEY)) {
      return NextResponse.next();
    }
  }

  if (mode === "basic") {
    const expected = process.env.DEMO_PASSWORD;
    if (!expected) return NextResponse.next();
    if (checkBasic(request.headers.get("authorization"), expected)) {
      return NextResponse.next();
    }
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": REALM },
    });
  }

  // session | oidc — presence only at the edge (no Prisma on Edge). Invalid
  // tokens are rejected in requirePageSession / requireApiIdentity.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/health/live|login|api/auth).*)",
  ],
};
