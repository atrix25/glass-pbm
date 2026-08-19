/**
 * Checks that turning edit mode on does not take the site away from you:
 * links still navigate, and the point of sale terminal still transmits.
 */

import { chromium } from "playwright";
import { demoCredentials } from "./demo-credentials.mjs";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  httpCredentials: demoCredentials(),
});

const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(m.text());
});

const results = [];
const check = (name, ok) => {
  results.push({ name, ok });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
};

await page.goto(`${BASE}/walkthrough`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

// Turn editing on and try to move around.
await page.getByRole("button", { name: /Edit text/i }).click();
await page.waitForTimeout(400);

await page.locator("nav a", { hasText: "Live operations" }).first().click();
await page.waitForTimeout(2500);
check(
  "a sidebar link still navigates while editing",
  new URL(page.url()).pathname === "/operations",
);

check(
  "edit mode is still on after navigating",
  (await page.getByRole("button", { name: /Done editing/i }).count()) > 0,
);

// Body copy on the new page is still editable.
await page.locator("h1").first().click();
await page.waitForTimeout(400);
check(
  "body copy on the new page is editable",
  (await page.locator("[data-copy-editing]").count()) === 1,
);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// The interactive terminal still works with editing on.
await page.goto(`${BASE}/pos`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const transmit = page.getByRole("button", { name: /Transmit claim/i });
check("the POS transmit button is present", (await transmit.count()) > 0);

await transmit.click();
await page.waitForTimeout(3000);
const answered = await page
  .locator("h2")
  .filter({ hasText: /Paid|Rejected/ })
  .count();
check("the terminal still adjudicates while editing is on", answered > 0);

// And with editing off.
const done = page.getByRole("button", { name: /Done editing/i });
if ((await done.count()) > 0) await done.click();
await page.waitForTimeout(400);
await page.goto(`${BASE}/pos`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Transmit claim/i }).click();
await page.waitForTimeout(3000);
check(
  "the terminal works with editing off",
  (await page.locator("h2").filter({ hasText: /Paid|Rejected/ }).count()) > 0,
);

check("no console errors", problems.length === 0);
if (problems.length) console.log(problems.slice(0, 5));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
