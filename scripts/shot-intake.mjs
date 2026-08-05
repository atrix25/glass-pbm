/**
 * Drives the prior authorisation intake demo and screenshots the result, so
 * the interactive path is checked rather than only the page that hosts it.
 */

import { chromium } from "playwright";

const out = process.argv[2] ?? "intake.png";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  deviceScaleFactor: 2,
  httpCredentials: { username: "josh", password: "glass2026" },
});

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto("http://localhost:3000/agents/pa-intake", {
  waitUntil: "networkidle",
  timeout: 60_000,
});

await page.getByRole("button", { name: /run intake/i }).click();
await page.waitForSelector("text=/answer set|escalat/i", { timeout: 60_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(out);
if (errors.length > 0) {
  console.log("CONSOLE ERRORS:");
  for (const e of errors.slice(0, 10)) console.log("  " + e);
  process.exitCode = 1;
}
