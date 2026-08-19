/**
 * Drives the in-browser copy editor the way a person would, and checks that
 * the change survives a reload, follows the words wherever else they appear,
 * refuses to freeze a live figure, and can be undone.
 *
 *   node scripts/test-copy-edit.mjs
 */

import { chromium } from "playwright";
import { demoCredentials } from "./demo-credentials.mjs";

const BASE = "http://localhost:3000";
const TARGET = "Guided walkthrough";
const REPLACEMENT = "Platform tour";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
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

async function go(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(700);
}

/** The toggle remembers itself across loads, so drive it to a known state. */
async function setEditMode(on) {
  const done = page.getByRole("button", { name: /Done editing/i });
  const start = page.getByRole("button", { name: /Edit text/i });
  const isOn = (await done.count()) > 0;
  if (isOn !== on) {
    await (isOn ? done : start).click();
    await page.waitForTimeout(400);
  }
}

async function rewrite(locator, text) {
  await locator.click();
  await page.waitForTimeout(350);
  const opened = (await page.locator("[data-copy-editing]").count()) === 1;
  if (!opened) return false;
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
  return true;
}

// ---------------------------------------------------------------------------

await go("/walkthrough");
await setEditMode(true);

const opened = await rewrite(
  page.locator("h1", { hasText: TARGET }).first(),
  REPLACEMENT,
);
check("clicking a heading opens an editor", opened);
check(
  "the heading shows the new wording immediately",
  (await page.locator("h1").first().innerText()).trim() === REPLACEMENT,
);

await go("/walkthrough");
check(
  "the change survives a reload",
  (await page.locator("h1").first().innerText()).trim() === REPLACEMENT,
);
check(
  "the same words changed in the sidebar too",
  (await page.locator("nav a", { hasText: REPLACEMENT }).count()) > 0,
);

// A live figure must stay live.
await setEditMode(true);
const figure = page.locator(".tnum").filter({ hasText: /^[\d,]+$/ }).first();
if ((await figure.count()) > 0) {
  await figure.click({ force: true });
  await page.waitForTimeout(350);
  check(
    "a computed number refuses to be edited",
    (await page.locator("[data-copy-editing]").count()) === 0,
  );
} else {
  check("a computed number refuses to be edited", false);
}

// Put it back the way it was.
await go("/walkthrough");
await setEditMode(true);
await rewrite(page.locator("h1", { hasText: REPLACEMENT }).first(), TARGET);
await go("/walkthrough");
check(
  "restoring the original wording clears the override",
  (await page.locator("h1").first().innerText()).trim() === TARGET,
);

check("no console errors", problems.length === 0);
if (problems.length) console.log(problems.slice(0, 5));

await browser.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
