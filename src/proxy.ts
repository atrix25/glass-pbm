import { NextResponse, type NextRequest } from "next/server";
import { authMode, demoFeaturesEnabled } from "@/lib/config";
import {
  DEMO_SESSION_COOKIE,
  validBasicHeader,
  validDemoSession,
} from "@/lib/demo-auth";

// Production gate: session cookie or API key. Basic auth remains available for
// DEMO_FEATURES / AUTH_MODE=basic. /api/health and /api/health/live stay open.

const SESSION_COOKIE = "glass_session";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function nextForSponsor(request: NextRequest) {
  if (demoFeaturesEnabled() && request.cookies.get("glass_demo_sponsor")?.value === "tennessee") {
    const path=request.nextUrl.pathname;
    const allowed=["/sponsor","/sponsor/assurance","/rebate-protection","/contract-checks","/api/contract-checks","/api/operational-assurance","/api/operational-assurance/process","/api/demo-sponsor","/leakage-challenges","/api/leakage-challenges","/agents/leakage-challenge","/agents/rebate-protection","/data-agent-checks","/api/data-agent-checks","/agents/data-agent-tester"];
    if (!allowed.includes(path) && !path.startsWith("/api/auth") && !path.startsWith("/_next/") && !path.startsWith("/agents/runs/cck_") && !path.startsWith("/agents/runs/lch_") && !path.startsWith("/agents/runs/oas_") && !path.startsWith("/agents/runs/prc_")) {
      if(path.startsWith("/api/")) return NextResponse.json({error:"This workflow is unavailable for the Tennessee demo sponsor."},{status:409});
      return NextResponse.redirect(new URL("/rebate-protection",request.url));
    }
  }
  return NextResponse.next();
}

export function proxy(request: NextRequest) {
  const mode = authMode();
  if (mode === "open") return nextForSponsor(request);

  // Service API key for POS / switch adapters (Bearer or X-Api-Key).
  const apiKey =
    request.headers.get("x-api-key") ??
    (request.headers.get("authorization")?.startsWith("Bearer glass_")
      ? request.headers.get("authorization")!.slice(7)
      : null);
  if (apiKey && process.env.SERVICE_API_KEY) {
    if (constantTimeEqual(apiKey, process.env.SERVICE_API_KEY)) {
      return nextForSponsor(request);
    }
  }

  if (mode === "basic") {
    const expected = process.env.DEMO_PASSWORD;
    if (!expected) return nextForSponsor(request);
    if (
      validBasicHeader(request.headers.get("authorization")) ||
      validDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
    ) {
      return nextForSponsor(request);
    }
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set(
      "next",
      request.nextUrl.pathname + request.nextUrl.search,
    );
    return NextResponse.redirect(login);
  }

  // session | oidc — cookie present is enough at the edge; route handlers
  // resolve the user against Postgres. Missing cookie → login.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) return nextForSponsor(request);

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
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
