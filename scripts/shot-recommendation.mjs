/**
 * Follows a recommendation from the member-experience page into the change
 * console and waits for the projection to land, which is the whole path a
 * reader takes and the only way to see that the deep link, the draft patch and
 * the sampled run actually meet.
 *
 *   node scripts/shot-recommendation.mjs
 */

import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 2,
  httpCredentials: { username: "josh", password: "stock200" },
});

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:3000/experience", {
  waitUntil: "domcontentloaded",
  timeout: 90_000,
});
await page.getByText("What members would say").first().waitFor({ timeout: 60_000 });
await page.screenshot({ path: "exp-feedback.png", fullPage: true });
console.log("wrote exp-feedback.png");

// The first recommendation's "Model it" link.
const link = page.getByRole("link", { name: /Model it/ }).first();
const href = await link.getAttribute("href");
console.log("following", href);
await link.click();

await page.waitForURL(/\/changes\?recommend=/, { timeout: 30_000 });
console.log("landed on", page.url());

// The console applies the recommendation and projects it on arrival.
await page.getByText(/Projecting from/).waitFor({ timeout: 20_000 });
console.log("projection started");

await page.getByText("Projected", { exact: true }).waitFor({ timeout: 120_000 });
console.log("projection landed");

const staged = await page
  .locator("li")
  .filter({ hasText: /removed from drugs matching|lifted on drugs matching/ })
  .allInnerTexts();
console.log("staged change:", staged.join(" | ") || "(none found)");

const metrics = await page
  .locator("text=Member experience")
  .first()
  .locator("xpath=..")
  .innerText();
console.log("projected panel:\n" + metrics);

await page.screenshot({ path: "changes-projection.png", fullPage: true });
console.log("wrote changes-projection.png");

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
