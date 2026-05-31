// Records a scripted walkthrough of the PURSUE Timeline app and saves the
// resulting webm video into the barnesy-new portfolio post folder.
//
// Storyboard (~22 s):
//   0–2s   Hold on the "Both" view (full data)
//   2–5s   Cursor moves to the timeline zoom band
//   5–8s   Slow drag from ~1995 to ~2024 (modern UAP era)
//   8–11s  Pause: map filters, date chip appears in toolbar
//   11–14s Cursor moves to CENTCOM marker, click → popover
//   14–18s Cursor moves to first case, click → detail panel slides in
//   18–22s Hold on the populated panel
//
// Usage: ensure `npm run dev` is running on port 5191, then:
//   npx tsx scripts/record-demo.ts

import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, readdir, rename, rm } from "node:fs/promises";

const APP_URL = "http://localhost:5191/";
const OUT_DIR = resolve(
  "/Users/barnesy/Projects/barnesy-new/images/pursue-timeline",
);
const TMP = resolve(import.meta.dirname, "..", ".tmp-video");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: TMP,
      size: { width: 1440, height: 900 },
    },
  });

  // Inject a visible cursor + click feedback so the video shows what's happening.
  await ctx.addInitScript(() => {
    const install = () => {
      if (document.getElementById("__demo_cursor")) return;
      const cur = document.createElement("div");
      cur.id = "__demo_cursor";
      Object.assign(cur.style, {
        position: "fixed",
        width: "22px",
        height: "22px",
        borderRadius: "50%",
        background: "rgba(255,255,255,0.92)",
        border: "2px solid rgba(122,184,255,0.95)",
        boxShadow:
          "0 0 0 6px rgba(122,184,255,0.22), 0 4px 14px rgba(0,0,0,0.55)",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%) scale(1)",
        transition: "transform 0.08s ease, background 0.08s ease",
        left: "-100px",
        top: "-100px",
      });
      document.body.appendChild(cur);
      document.addEventListener(
        "mousemove",
        (e) => {
          cur.style.left = e.clientX + "px";
          cur.style.top = e.clientY + "px";
        },
        true,
      );
      document.addEventListener(
        "mousedown",
        () => {
          cur.style.transform = "translate(-50%, -50%) scale(0.7)";
          cur.style.background = "rgba(122,184,255,0.95)";
        },
        true,
      );
      document.addEventListener(
        "mouseup",
        () => {
          cur.style.transform = "translate(-50%, -50%) scale(1)";
          cur.style.background = "rgba(255,255,255,0.92)";
        },
        true,
      );
    };
    if (document.body) install();
    else document.addEventListener("DOMContentLoaded", install);
  });

  const page = await ctx.newPage();

  console.log("[demo] navigating");
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("svg circle", { timeout: 10_000 });
  await sleep(1200);

  // Position cursor offscreen at start so the move-in is dramatic
  await page.mouse.move(50, 850);
  await sleep(800);

  // 1) Locate the brush band
  console.log("[demo] locating brush band");
  const band = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll("svg")].sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    // Timeline SVG: in Both view, 45% map up top + 55% timeline below.
    // The timeline is the larger of the two main SVGs.
    for (const svg of svgs) {
      const r = [...svg.querySelectorAll("rect")].find((rr) =>
        (rr.getAttribute("fill") || "").includes("122,184,255"),
      );
      if (r) {
        const bb = r.getBoundingClientRect();
        return { x: bb.left, y: bb.top, w: bb.width, h: bb.height };
      }
    }
    return null;
  });
  if (!band) throw new Error("brush band not found");

  // 2) Cursor moves to the band — entry point at ~62% (~1995)
  const y = band.y + band.h / 2;
  const x1 = band.x + band.w * 0.62;
  const x2 = band.x + band.w * 0.96;

  console.log("[demo] approaching brush band");
  await page.mouse.move(band.x + band.w * 0.4, band.y - 80, { steps: 20 });
  await sleep(300);
  await page.mouse.move(x1, y, { steps: 22 });
  await sleep(600);

  // 3) Slow brush drag
  console.log("[demo] dragging brush");
  await page.mouse.down();
  await sleep(200);
  await page.mouse.move(x2, y, { steps: 40 });
  await sleep(300);
  await page.mouse.up();
  console.log("[demo] brushed; pausing for map to react");
  await sleep(2200);

  // 4) Find the biggest visible map marker (should be CENTCOM)
  console.log("[demo] locating biggest map marker");
  const marker = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll("svg")].sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    for (const svg of svgs) {
      const markers = [...svg.querySelectorAll("circle")]
        .filter((c) => c.getAttribute("fill-opacity") === "0.65")
        .sort(
          (a, b) =>
            parseFloat(b.getAttribute("r") || "0") -
            parseFloat(a.getAttribute("r") || "0"),
        );
      if (markers.length > 0) {
        const bb = markers[0].getBoundingClientRect();
        return { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2 };
      }
    }
    return null;
  });
  if (!marker) throw new Error("no map marker");

  // 5) Move cursor to map marker, click
  console.log("[demo] clicking map marker");
  await page.mouse.move(marker.x - 220, marker.y - 60, { steps: 22 });
  await sleep(250);
  await page.mouse.move(marker.x, marker.y, { steps: 20 });
  await sleep(450);
  await page.mouse.down();
  await sleep(120);
  await page.mouse.up();
  await sleep(1800);

  // 6) Click a case in the popover
  console.log("[demo] picking a case from popover");
  const caseBtn = await page.evaluate(() => {
    const popover = document.querySelector(".MuiPopover-paper");
    if (!popover) return null;
    // Skip past header text; grab the second button (first concrete case row).
    // Actually first button is the first case button. Use it but visually
    // hover its center.
    const btn = popover.querySelector("button");
    if (!btn) return null;
    const bb = btn.getBoundingClientRect();
    return { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2 };
  });
  if (caseBtn) {
    await page.mouse.move(caseBtn.x, caseBtn.y, { steps: 18 });
    await sleep(400);
    await page.mouse.down();
    await sleep(120);
    await page.mouse.up();
    await sleep(2800);
  }

  // 7) Hold on the detail panel so the viewer can read it
  console.log("[demo] holding on detail panel");
  await sleep(1200);

  // Close + flush
  console.log("[demo] flushing video");
  await page.close();
  await ctx.close();
  await browser.close();

  // Move the recorded .webm into the post images folder
  const files = await readdir(TMP);
  const webm = files.find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no webm saved by Playwright");
  const dest = resolve(OUT_DIR, "demo.webm");
  await rename(resolve(TMP, webm), dest);
  console.log(`[demo] saved ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
