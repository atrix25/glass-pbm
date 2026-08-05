/**
 * Screenshots a page of the running dev server.
 *
 *   node scripts/shot.mjs /integrity integrity.png
 */

import { chromium } from "playwright";

const [, , path = "/", out = "shot.png"] = process.argv;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  httpCredentials: { username: "josh", password: "stock200" },
});
await page.goto(`http://localhost:3000${path}`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await page.waitForTimeout(1200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
