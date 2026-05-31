// Captures hero + detail-panel + zoomed screenshots of the running PURSUE app
// and saves them into the barnesy.me portfolio post folder.
//
// Usage: ensure `npm run dev` is running on port 5191, then `npx tsx scripts/capture-post-screenshots.ts`

import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const APP_URL = "http://localhost:5191/";
const OUT_DIR = resolve(
  "/Users/barnesy/Projects/barnesy-new/images/pursue-timeline",
);

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2, // retina for crisp PNGs
  });
  const page = await ctx.newPage();

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  // Wait for cases.json + first render
  await page.waitForSelector("svg circle", { timeout: 10_000 });
  await page.waitForTimeout(800);

  // 1. Hero — Both view, no panel, no date filter
  await page.screenshot({
    path: resolve(OUT_DIR, "hero.png"),
    fullPage: false,
  });
  console.log("wrote hero.png");

  // 2. Detail panel open
  await page.evaluate(() => {
    const svgs = [...document.querySelectorAll("svg")].sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    // Find an orange (CIA) dot — narrative-rich and uniquely identifiable
    for (const svg of svgs) {
      const orange = [...svg.querySelectorAll("circle")].find(
        (c) => (c.getAttribute("fill") || "").toLowerCase() === "#ff8a3d",
      );
      if (orange) {
        (orange as SVGElement).dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        break;
      }
    }
  });
  await page.waitForSelector('button[aria-label="Close panel"]', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: resolve(OUT_DIR, "detail-panel.png"),
    fullPage: false,
  });
  console.log("wrote detail-panel.png");

  // Close panel
  await page.click('button[aria-label="Close panel"]');
  await page.waitForTimeout(300);

  // 3. Map-only view with date filter active — show how filters propagate
  await page.click('button[aria-label="Timeline view"]');
  await page.waitForTimeout(400);
  // Brush a modern range
  await page.evaluate(async () => {
    const svgs = [...document.querySelectorAll("svg")].sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    const tl = svgs[0];
    const rects = [...tl.querySelectorAll("rect")];
    const band = rects.find((r) =>
      (r.getAttribute("fill") || "").includes("122,184,255"),
    );
    if (!band) return;
    const bb = band.getBoundingClientRect();
    const y = bb.top + bb.height / 2;
    const x1 = bb.left + bb.width * 0.55;
    const x2 = bb.left + bb.width * 0.95;
    const opts = (x: number, yy: number) => ({
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: yy,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      view: window,
    });
    band.dispatchEvent(new PointerEvent("pointerdown", opts(x1, y)));
    await new Promise((r) => setTimeout(r, 30));
    window.dispatchEvent(new PointerEvent("pointermove", opts(x2, y)));
    await new Promise((r) => setTimeout(r, 30));
    window.dispatchEvent(new PointerEvent("pointerup", opts(x2, y)));
  });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: resolve(OUT_DIR, "timeline-zoomed.png"),
    fullPage: false,
  });
  console.log("wrote timeline-zoomed.png");

  // 4. Map only with the filter still applied → shows date filter chip + reduced markers
  await page.click('button[aria-label="Map view"]');
  await page.waitForTimeout(500);
  await page.screenshot({
    path: resolve(OUT_DIR, "map-filtered.png"),
    fullPage: false,
  });
  console.log("wrote map-filtered.png");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
