/**
 * Screenshots the point-of-sale terminal after loading a clinical scenario, so
 * the DUR segment is on screen rather than the empty response panel.
 *
 *   node scripts/shot-pos-dur.mjs 0 pos-dur.png [--segment]
 */

import { chromium } from "playwright";
import { demoCredentials } from "./demo-credentials.mjs";

const [, , index = "0", out = "pos-dur.png", mode] = process.argv;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  httpCredentials: demoCredentials(),
});
await page.goto("http://localhost:3000/pos", {
  waitUntil: "networkidle",
  timeout: 60_000,
});
const scenarios = page.locator("button", { hasText: "on 2026-" });
await scenarios.nth(Number(index)).click();
const segment = page.getByText("DUR/PPS response segment");
await segment.waitFor({ timeout: 30_000 });
await page.waitForTimeout(800);

if (mode === "--segment") {
  const card = page.locator("div.rounded-xl", { has: segment }).first();
  await card.screenshot({ path: out });
} else {
  await page.screenshot({ path: out, fullPage: true });
}
await browser.close();
console.log(out);
