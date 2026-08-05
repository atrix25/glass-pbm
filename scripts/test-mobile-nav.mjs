/**
 * The navigation drawer, on a phone.
 *
 * The rail is the only way around the application, so if the drawer fails to
 * open, or opens and then will not close, the whole thing is unusable on the
 * device most of the audience will read it on.
 *
 *   node scripts/test-mobile-nav.mjs
 */

import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  httpCredentials: { username: "josh", password: "glass2026" },
});

let failures = 0;
const check = (what, ok) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
};

const drawerShowing = async () => {
  const box = await page.locator("aside").boundingBox();
  return box !== null && box.x > -10;
};

await page.goto("http://localhost:3000/walkthrough", {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await page.waitForTimeout(600);

check("the drawer starts closed", !(await drawerShowing()));
check(
  "the page gets the full width with the rail away",
  (await page.evaluate(() => document.documentElement.scrollWidth)) === 390,
);

const hamburger = page.getByRole("button", { name: "Open navigation" });
check("there is a way to open it", (await hamburger.count()) === 1);

await hamburger.click();
await page.waitForTimeout(400);
check("tapping the hamburger opens it", await drawerShowing());

await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("escape closes it", !(await drawerShowing()));

await hamburger.click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Close navigation" }).click();
await page.waitForTimeout(400);
check("the close button closes it", !(await drawerShowing()));

// Beside the drawer rather than on it, which is where a thumb lands.
await hamburger.click();
await page.waitForTimeout(400);
await page.mouse.click(350, 500);
await page.waitForTimeout(400);
check("tapping the page beside it closes it", !(await drawerShowing()));

// The point of the drawer: navigating from it, and having it get out of the
// way once you have.
await hamburger.click();
await page.waitForTimeout(400);
await page.locator("aside nav a", { hasText: "Live operations" }).first().click();
await page.waitForTimeout(2500);
check(
  "a link inside it navigates",
  new URL(page.url()).pathname === "/operations",
);
check("and the drawer closes behind it", !(await drawerShowing()));
check(
  "the new page still has the full width",
  (await page.evaluate(() => document.documentElement.scrollWidth)) === 390,
);

// Desktop must be exactly as it was: rail always visible, no hamburger.
const wide = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  httpCredentials: { username: "josh", password: "glass2026" },
});
await wide.goto("http://localhost:3000/sponsor", {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await wide.waitForTimeout(600);

const rail = await wide.locator("aside").boundingBox();
check("the rail is still pinned open on a laptop", rail.x === 0);
check("and still 236px wide", Math.round(rail.width) === 236);
check(
  "with no hamburger in sight",
  !(await wide
    .getByRole("button", { name: "Open navigation" })
    .first()
    .isVisible()),
);
check(
  "and no sideways scroll",
  (await wide.evaluate(() => document.documentElement.scrollWidth)) === 1440,
);

await browser.close();
console.log(failures === 0 ? "\nall good" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
