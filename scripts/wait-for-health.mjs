/**
 * Block until the deployed app is actually serving.
 *
 * A single-machine Fly app is stopped while its config is updated and is only
 * started again by an incoming request, so `flyctl deploy` reports success
 * against a machine that is not running. The first visitor then absorbs the
 * cold start, which for this app means waiting for a ~900 MB image to
 * materialise. Paying that here, once, is the whole point.
 */

const URL = process.env.HEALTH_URL ?? "https://glass-pbm-demo.fly.dev/api/health";
const DEADLINE_MS = 5 * 60 * 1000;

const started = Date.now();
let attempt = 0;

while (Date.now() - started < DEADLINE_MS) {
  attempt++;
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(60_000) });
    const body = await res.json();
    if (res.ok && body.ok) {
      console.log(`healthy after ${elapsed}s: ${body.bookDays} days in the book`);
      process.exit(0);
    }
    console.log(`  ${elapsed}s  attempt ${attempt}: ${res.status} ${JSON.stringify(body)}`);
  } catch (e) {
    console.log(`  ${elapsed}s  attempt ${attempt}: ${e instanceof Error ? e.message : e}`);
  }
  await new Promise((r) => setTimeout(r, 5000));
}

console.error(`still not healthy after ${DEADLINE_MS / 1000}s`);
process.exit(1);
