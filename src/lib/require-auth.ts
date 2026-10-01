import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  sessionUser,
  verifyApiKey,
  type AppRole,
} from "@/lib/auth";
import { identityMustResolve } from "@/lib/config";

export { identityMustResolve };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function serviceApiKeyFrom(request: Request): string | null {
  const headerKey = request.headers.get("x-api-key");
  if (headerKey) return headerKey;
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer glass_")) return auth.slice(7);
  return null;
}

async function cookieSessionUser() {
  const jar = await cookies();
  return sessionUser(jar.get(SESSION_COOKIE)?.value);
}

/** Redirect to /login when session|oidc and the cookie is missing or invalid. */
export async function requirePageSession(): Promise<void> {
  if (!identityMustResolve()) return;
  const user = await cookieSessionUser();
  if (!user) redirect("/login");
}

export type ApiIdentity =
  | { kind: "user"; user: NonNullable<Awaited<ReturnType<typeof sessionUser>>> }
  | { kind: "service" }
  | { kind: "apiKey"; key: NonNullable<Awaited<ReturnType<typeof verifyApiKey>>> };

/**
 * Gate mutating and book-reading APIs in session|oidc mode.
 * Returns a 401 Response when the caller has no valid session or API key.
 */
export async function requireApiIdentity(
  request: Request,
): Promise<ApiIdentity | NextResponse> {
  if (!identityMustResolve()) {
    const user = await cookieSessionUser();
    return user ? { kind: "user", user } : { kind: "service" };
  }

  const rawKey = serviceApiKeyFrom(request);
  if (rawKey && process.env.SERVICE_API_KEY) {
    if (constantTimeEqual(rawKey, process.env.SERVICE_API_KEY)) {
      return { kind: "service" };
    }
  }
  if (rawKey) {
    const key = await verifyApiKey(rawKey);
    if (key) return { kind: "apiKey", key };
  }

  const user = await cookieSessionUser();
  if (user) return { kind: "user", user };

  return NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

export function apiUserRole(identity: ApiIdentity): AppRole | null {
  if (identity.kind === "user") return identity.user.role as AppRole;
  return null;
}
