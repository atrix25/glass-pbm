/**
 * Session|OIDC must resolve the glass_session cookie against Postgres.
 *
 * Edge middleware only checks cookie presence. A forged value used to reach
 * every page and most APIs; requireApiIdentity / requirePageSession close that.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sessionUser = vi.fn();
const verifyApiKey = vi.fn();
const cookies = vi.fn();

vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "glass_session",
  sessionUser: (...args: unknown[]) => sessionUser(...args),
  verifyApiKey: (...args: unknown[]) => verifyApiKey(...args),
}));

vi.mock("next/headers", () => ({
  cookies: () => cookies(),
}));

describe("identityMustResolve", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.AUTH_MODE;
    delete process.env.SESSION_SECRET;
    delete process.env.DEMO_PASSWORD;
    delete process.env.OIDC_ISSUER;
    vi.resetModules();
  });

  it("is true for session and oidc, false for basic and open", async () => {
    process.env.AUTH_MODE = "session";
    expect((await import("@/lib/config")).identityMustResolve()).toBe(true);

    vi.resetModules();
    process.env.AUTH_MODE = "oidc";
    expect((await import("@/lib/config")).identityMustResolve()).toBe(true);

    vi.resetModules();
    process.env.AUTH_MODE = "basic";
    expect((await import("@/lib/config")).identityMustResolve()).toBe(false);

    vi.resetModules();
    process.env.AUTH_MODE = "open";
    expect((await import("@/lib/config")).identityMustResolve()).toBe(false);
  });

  it("defaults to session when SESSION_SECRET is set without AUTH_MODE", async () => {
    process.env.SESSION_SECRET = "test-secret";
    expect((await import("@/lib/config")).identityMustResolve()).toBe(true);
  });
});

describe("requireApiIdentity", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    process.env.AUTH_MODE = "session";
    delete process.env.SERVICE_API_KEY;
    sessionUser.mockReset();
    verifyApiKey.mockReset();
    cookies.mockReset();
    cookies.mockResolvedValue({
      get: () => ({ value: "forged-token" }),
    });
    vi.resetModules();
  });

  it("rejects a forged session cookie with 401", async () => {
    sessionUser.mockResolvedValue(null);
    const { requireApiIdentity } = await import("@/lib/require-auth");
    const result = await requireApiIdentity(new Request("http://localhost/api/replay"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(sessionUser).toHaveBeenCalledWith("forged-token");
  });

  it("accepts a resolved session user", async () => {
    sessionUser.mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      role: "admin",
      active: true,
    });
    const { requireApiIdentity } = await import("@/lib/require-auth");
    const result = await requireApiIdentity(new Request("http://localhost/api/replay"));
    expect(result).toEqual({
      kind: "user",
      user: expect.objectContaining({ id: "u1", role: "admin" }),
    });
  });

  it("accepts the service API key without a session", async () => {
    process.env.SERVICE_API_KEY = "glass_service_secret";
    sessionUser.mockResolvedValue(null);
    const { requireApiIdentity } = await import("@/lib/require-auth");
    const result = await requireApiIdentity(
      new Request("http://localhost/api/pos", {
        headers: { "x-api-key": "glass_service_secret" },
      }),
    );
    expect(result).toEqual({ kind: "service" });
  });
});
