/**
 * Asks the member service agent a question in the browser and screenshots the
 * answer, so the tool trace and the handoff panel are checked as rendered
 * rather than as JSON.
 */

import { chromium } from "playwright";

const question = process.argv[2] ?? "is Skyrizi covered";
const out = process.argv[3] ?? "assistant.png";

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

await page.goto("http://localhost:3000/assistant", {
  waitUntil: "networkidle",
  timeout: 60_000,
});

const box = page.getByRole("textbox").first();
await box.fill(question);
await box.press("Enter");
// The footer is written only once an answer has come back, so it is the one
// thing on the page that distinguishes "answered" from "still thinking".
await page.waitForSelector("text=/Routed as/i", { timeout: 60_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(out);
if (errors.length > 0) {
  console.log("CONSOLE ERRORS:");
  for (const e of errors.slice(0, 10)) console.log("  " + e);
  process.exitCode = 1;
}
