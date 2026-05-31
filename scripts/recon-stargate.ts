// Reconnaissance: what does a single CIA Stargate collection listing page
// look like? We need to know the per-document HTML structure before we can
// build a full scraper.

import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_DIR = resolve(import.meta.dirname, "..", "data", "raw");
// Candidates tried in order — the actual listing URL is not obvious.
// The /collection/stargate URL returns the ERR landing page, not docs.
const CANDIDATES = [
  "https://www.cia.gov/readingroom/historical-collections/stargate",
  "https://www.cia.gov/readingroom/search/site/stargate",
  "https://www.cia.gov/readingroom/advanced-search-view?advanced=1&f%5B0%5D=ds_created%3A%5B*%20TO%20*%5D&collection%5B0%5D=stargate",
];
const URL = process.env.URL || CANDIDATES[0];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    channel: "chrome",
    headless: process.env.HEADLESS !== "0",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  const xhrs: { url: string; status: number; contentType: string; size: number }[] = [];
  page.on("response", async (resp) => {
    const req = resp.request();
    const rt = req.resourceType();
    if (rt !== "xhr" && rt !== "fetch") return;
    let size = 0;
    try { size = (await resp.body()).length; } catch {}
    xhrs.push({
      url: req.url(),
      status: resp.status(),
      contentType: resp.headers()["content-type"] || "",
      size,
    });
  });

  console.log(`[recon] navigating: ${URL}`);
  const resp = await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });
  console.log(`[recon] status: ${resp?.status()}`);
  console.log(`[recon] title: ${await page.title()}`);

  await page.waitForTimeout(4000);
  // Also scroll in case of lazy-load
  await page.evaluate(`window.scrollTo({top: document.body.scrollHeight, behavior: 'instant'})`);
  await page.waitForTimeout(2500);

  console.log("[recon] XHR/fetch requests captured:");
  for (const x of xhrs) console.log(`  ${x.status} ${x.size.toString().padStart(8)}b  ${x.url}`);

  // Dump the full page HTML for offline inspection.
  const html = await page.content();
  await writeFile(resolve(OUT_DIR, "stargate-listing.html"), html);
  console.log(`[recon] saved listing HTML (${html.length} bytes)`);

  // Page evaluate using only plain JS (no TS, no arrow-fn names — avoids tsx
  // transpile issue with __name).
  const summary = await page.evaluate(`(function() {
    var docLinks = [].slice.call(document.querySelectorAll("a[href*='/readingroom/document/']"));
    var sample = docLinks.slice(0, 3).map(function(a) {
      return { href: a.href, text: (a.textContent || '').trim().slice(0, 100) };
    });
    var rows = document.querySelectorAll('.views-row');
    var firstRow = rows[0] ? rows[0].outerHTML.slice(0, 1500) : null;
    var totalText = (document.body.innerText || '').match(/(\\\\d{1,3}(?:,\\\\d{3})*)\\\\s+(items?|results?|documents?|records?)/i);
    return {
      docLinkCount: docLinks.length,
      rowCount: rows.length,
      firstRow: firstRow,
      sampleDocs: sample,
      totalHint: totalText ? totalText[0] : null,
      pagerLinks: [].slice.call(document.querySelectorAll(".pager a, .pager-item a, nav.pager a")).map(function(a) { return a.href; }).slice(0, 6),
    };
  })()`);
  console.log("[recon] page summary:");
  console.log(JSON.stringify(summary, null, 2));

  // Screenshot the listing
  await page.screenshot({ path: resolve(OUT_DIR, "stargate-listing.png"), fullPage: false });

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
