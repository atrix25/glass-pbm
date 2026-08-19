/**
 * Basic-auth credentials for the gated demo host, from the environment.
 *
 * The scripts here drive a browser against a deployment that sits behind the
 * gate in `src/middleware.ts`. The password belongs in the environment beside
 * the one the server reads, not in the repository: a checked-in password is
 * published with the code and has to be rotated everywhere at once.
 *
 * Undefined when no password is set, which is the local case — the gate is off
 * and Playwright should not send an Authorization header at all.
 */
export function demoCredentials() {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return undefined;
  return { username: process.env.DEMO_USERNAME ?? "josh", password };
}
