/**
 * Screenshots a page at phone width and reports anything that overflows it.
 *
 *   node scripts/shot-mobile.mjs / /tmp/landing-mobile.png 390
 */

import { chromium } from "playwright";

const [, , path = "/", out = "/tmp/mobile.png", width = "390"] = process.argv;
const w = Number(width);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: w, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  httpCredentials: { username: "josh", password: "glass2026" },
});

await page.goto(`http://localhost:3000${path}`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await page.waitForTimeout(900);

// Anything wider than the viewport is a horizontal scroll bug.
const overflow = await page.evaluate((vw) => {
  // An element inside something that scrolls sideways on purpose, or inside a
  // closed off-canvas drawer, is not a layout bug. Both were drowning the real
  // offenders in noise.
  const excused = (el) => {
    let p = el;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (/auto|scroll/.test(s.overflowX)) return true;
      if (s.position === "fixed" && p.getBoundingClientRect().right <= 1)
        return true;
      p = p.parentElement;
    }
    return false;
  };

  const bad = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1) continue;
    if (excused(el)) continue;
    bad.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 60),
      text: (el.textContent || "").trim().slice(0, 45),
      left: Math.round(r.left),
      right: Math.round(r.right),
    });
  }

  // Widest first: the element that sets the document width is the one to fix,
  // and its children are only repeating its mistake.
  bad.sort((a, b) => b.right - a.right);

  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    worst: bad.slice(0, 8),
    count: bad.length,
  };
}, w);

console.log(
  `viewport ${w}  scrollWidth ${overflow.scrollWidth}  ${
    overflow.scrollWidth > overflow.clientWidth
      ? "HORIZONTAL SCROLL"
      : "no horizontal scroll"
  }`,
);
console.log(`elements past the edge: ${overflow.count}`);
for (const b of overflow.worst) {
  console.log(`  <${b.tag}> ${b.left}..${b.right}  "${b.text}"  ${b.cls}`);
}

// Tap targets that are too small to hit reliably.
const small = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll("a, button")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 32) {
      bad.push({
        text: (el.textContent || "").trim().slice(0, 40),
        cls: (el.className || "").toString().slice(0, 55),
        h: Math.round(r.height),
      });
    }
  }
  return bad.slice(0, 8);
});
if (small.length) {
  console.log("tap targets under 32px tall:");
  for (const s of small) console.log(`  ${s.h}px  "${s.text}"  ${s.cls}`);
}

await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
