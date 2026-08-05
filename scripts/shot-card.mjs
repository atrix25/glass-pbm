/**
 * Screenshots a single card on a page, matched by its heading text.
 *
 *   node scripts/shot-card.mjs /eligibility "One instruction" out.png
 */

import { chromium } from "playwright";

const [, , path = "/", heading = "", out = "card.png"] = process.argv;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  httpCredentials: { username: "josh", password: "glass2026" },
});
await page.goto(`http://localhost:3000${path}`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await page.waitForTimeout(600);
const title = page.getByText(heading, { exact: false }).first();
await title.waitFor({ timeout: 30_000 });
await page.locator("div.rounded-xl", { has: title }).first().screenshot({ path: out });
await browser.close();
console.log(out);
