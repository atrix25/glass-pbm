import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDemoSession,
  validDemoSession,
  validDemoCredentials,
  validBasicHeader,
  DEMO_SESSION_SECONDS,
} from "@/lib/demo-auth";
beforeEach(() => {
  vi.stubEnv("DEMO_USERNAME", "owner");
  vi.stubEnv("DEMO_PASSWORD", "test-only-primary");
  vi.stubEnv("DEMO_USERNAME_2", "visitor");
  vi.stubEnv("DEMO_PASSWORD_2", "test-only-secondary");
});
afterEach(() => vi.unstubAllEnvs());
describe("existing demo credentials with a browser session", () => {
  it("accepts the existing accounts and rejects wrong passwords", () => {
    expect(validDemoCredentials("owner", "test-only-primary")).toBe(true);
    expect(validDemoCredentials("visitor", "test-only-secondary")).toBe(true);
    expect(validDemoCredentials("owner", "test-only-secondary")).toBe(false);
  });
  it("retains authenticated Basic requests", () => {
    expect(
      validBasicHeader(
        "Basic " + Buffer.from("owner:test-only-primary").toString("base64"),
      ),
    ).toBe(true);
    expect(validBasicHeader("Basic !!!")).toBe(false);
    expect(validBasicHeader(null)).toBe(false);
  });
  it("requires valid credentials to create a session", () => {
    expect(() => createDemoSession("owner", "wrong")).toThrow(
      "Invalid credentials",
    );
  });
  it("expires after eight hours and rejects tampering", () => {
    const now = 100000;
    const token = createDemoSession("owner", "test-only-primary", now);
    expect(validDemoSession(token, now + 1)).toBe(true);
    expect(validDemoSession(token, now + DEMO_SESSION_SECONDS * 1000)).toBe(
      false,
    );
    expect(validDemoSession(token + "x", now)).toBe(false);
    const [p, s] = token.split(".");
    const changed = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(p, "base64url").toString()),
        username: "visitor",
      }),
    ).toString("base64url");
    expect(validDemoSession(changed + "." + s, now)).toBe(false);
  });
  it("revokes sessions when their password changes or demo access is removed", () => {
    const token = createDemoSession("owner", "test-only-primary");
    vi.stubEnv("DEMO_PASSWORD", "rotated");
    expect(validDemoSession(token)).toBe(false);
    vi.stubEnv("DEMO_PASSWORD", "");
    expect(validDemoSession(token)).toBe(false);
    expect(validDemoCredentials("visitor", "test-only-secondary")).toBe(false);
  });
  it("rejects missing and malformed sessions", () => {
    for (const t of [
      undefined,
      "",
      "not-json.signature",
      "a.b.c",
      "a".repeat(3000),
    ])
      expect(validDemoSession(t)).toBe(false);
  });
});

import { NextRequest } from "next/server";
import { proxy as middleware } from "@/proxy";
import { DEMO_SESSION_COOKIE } from "@/lib/demo-auth";
describe("password-protected browser access", () => {
  beforeEach(() => vi.stubEnv("AUTH_MODE", "basic"));
  it("redirects browsers to login without triggering a native password prompt", () => {
    const r = middleware(
      new NextRequest("https://glass.example/account-management?view=work"),
    );
    expect(r.status).toBe(307);
    expect(r.headers.get("www-authenticate")).toBeNull();
    const url = new URL(r.headers.get("location")!);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/account-management?view=work");
  });
  it("accepts a signed session and rejects a forged session", () => {
    const cookie = createDemoSession("owner", "test-only-primary");
    const req = (v: string) =>
      new NextRequest("https://glass.example/account-management", {
        headers: { cookie: `${DEMO_SESSION_COOKIE}=${v}` },
      });
    expect(middleware(req(cookie)).headers.get("x-middleware-next")).toBe("1");
    expect(middleware(req(cookie + "x")).status).toBe(307);
  });
  it("keeps APIs protected and supports existing Basic clients", () => {
    expect(
      middleware(
        new NextRequest("https://glass.example/api/account-management"),
      ).status,
    ).toBe(401);
    const r = middleware(
      new NextRequest("https://glass.example/api/account-management", {
        headers: {
          authorization:
            "Basic " +
            Buffer.from("owner:test-only-primary").toString("base64"),
        },
      }),
    );
    expect(r.headers.get("x-middleware-next")).toBe("1");
  });
  it("does not accept a demo session in session-auth mode", () => {
    const cookie = createDemoSession("owner", "test-only-primary");
    vi.stubEnv("AUTH_MODE", "session");
    expect(
      middleware(
        new NextRequest("https://glass.example/account-management", {
          headers: { cookie: `${DEMO_SESSION_COOKIE}=${cookie}` },
        }),
      ).status,
    ).toBe(307);
  });
});
