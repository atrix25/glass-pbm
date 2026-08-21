/**
 * Block until the deployed app is ready (Postgres + BookDay rollup).
 */

const URL = process.env.HEALTH_URL ?? "https://glass-pbm-demo.fly.dev/api/health";
const DEADLINE_MS = 10 * 60 * 1000;

const started = Date.now();
let attempt = 0;

while (Date.now() - started < DEADLINE_MS) {
  attempt++;
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(120_000) });
    const body = await res.json();
    if (res.ok && body.ok) {
      console.log(`healthy after ${elapsed}s: ${body.bookDays} days in the book`);
      process.exit(0);
    }
    console.log(`  ${elapsed}s  attempt ${attempt}: ${res.status} ${JSON.stringify(body)}`);
  } catch (e) {
    console.log(`  ${elapsed}s  attempt ${attempt}: ${e instanceof Error ? e.message : e}`);
  }
  await new Promise((r) => setTimeout(r, 5_000));
}

console.error(`not healthy after ${DEADLINE_MS / 1000}s`);
process.exit(1);
