/** Screenshots edit mode with a sentence open for rewriting. */

import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  httpCredentials: { username: "josh", password: "glass2026" },
});

await page.goto("http://localhost:3000/walkthrough", {
  waitUntil: "networkidle",
});
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Edit text/i }).click();
await page.waitForTimeout(400);

// Open the intro paragraph for editing, and leave the cursor in it.
const para = page.locator("p", { hasText: /A pharmacy benefit manager sits/ }).first();
await para.click();
await page.waitForTimeout(600);

await page.screenshot({ path: "/tmp/copy-edit.png" });
await browser.close();
console.log("/tmp/copy-edit.png");
