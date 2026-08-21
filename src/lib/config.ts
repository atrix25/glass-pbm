/**
 * Runtime feature flags for a single-tenant deploy.
 *
 * DEMO_FEATURES=1 (default when unset in non-production) keeps the pitch
 * clock, cookie role switcher, and Basic-auth fallback. Production sets
 * DEMO_FEATURES=0 and AUTH_MODE=session|oidc.
 */

export function demoFeaturesEnabled(): boolean {
  const raw = process.env.DEMO_FEATURES;
  if (raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return process.env.NODE_ENV !== "production";
}

export type AuthMode = "open" | "basic" | "session" | "oidc";

export function authMode(): AuthMode {
  const mode = (process.env.AUTH_MODE ?? "").toLowerCase() as AuthMode;
  if (mode === "open" || mode === "basic" || mode === "session" || mode === "oidc") {
    return mode;
  }
  if (!process.env.DEMO_PASSWORD && !process.env.SESSION_SECRET) return "open";
  if (process.env.OIDC_ISSUER) return "oidc";
  if (process.env.SESSION_SECRET) return "session";
  if (process.env.DEMO_PASSWORD) return "basic";
  return "open";
}

export function tenantContractId(): string {
  return process.env.TENANT_CONTRACT_ID ?? "etg0013";
}

export function tenantSponsorId(): string {
  return process.env.TENANT_SPONSOR_ID ?? "steel-potatoes";
}

export function tenantDefaultMemberId(): string {
  return process.env.TENANT_DEFAULT_MEMBER_ID ?? "mbr-DEMO-0001-01";
}
