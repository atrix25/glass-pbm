import { createHmac, timingSafeEqual } from "node:crypto";

export const DEMO_SESSION_COOKIE = "glass_demo_session";
export const DEMO_SESSION_SECONDS = 8 * 60 * 60;

function accounts() {
  if (!process.env.DEMO_PASSWORD) return [];
  return [
    {
      username: process.env.DEMO_USERNAME ?? "josh",
      password: process.env.DEMO_PASSWORD,
    },
    {
      username: process.env.DEMO_USERNAME_2 ?? "test",
      password: process.env.DEMO_PASSWORD_2 ?? "glasspba",
    },
  ];
}
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function validDemoCredentials(username: string, password: string) {
  return accounts().some(
    (account) =>
      equal(username, account.username) && equal(password, account.password),
  );
}
export function validBasicHeader(header: string | null) {
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const split = decoded.indexOf(":");
  return (
    split >= 0 &&
    validDemoCredentials(decoded.slice(0, split), decoded.slice(split + 1))
  );
}
function signature(payload: string, password: string) {
  return createHmac("sha256", password)
    .update(`glass-demo-session:v1:${payload}`)
    .digest("base64url");
}
/** Same existing demo credentials, bounded browser session; password changes revoke it. */
export function createDemoSession(
  username: string,
  password: string,
  now = Date.now(),
) {
  if (!validDemoCredentials(username, password))
    throw Error("Invalid credentials.");
  const payload = Buffer.from(
    JSON.stringify({ username, expires: now + DEMO_SESSION_SECONDS * 1000 }),
  ).toString("base64url");
  return `${payload}.${signature(payload, password)}`;
}
export function validDemoSession(token: string | undefined, now = Date.now()) {
  if (!token || token.length > 2048) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const { username, expires } = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    if (
      typeof username !== "string" ||
      !Number.isSafeInteger(expires) ||
      expires <= now ||
      expires > now + DEMO_SESSION_SECONDS * 1000
    )
      return false;
    const account = accounts().find((a) => a.username === username);
    return Boolean(
      account && equal(parts[1], signature(parts[0], account.password)),
    );
  } catch {
    return false;
  }
}
