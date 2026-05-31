import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_DIR = resolve(import.meta.dirname, "..", "data", "raw");
const CSV_URL = "https://www.war.gov/Portals/1/Interactive/2026/UFO/uap-data.csv";
const LANDING = "https://www.war.gov/ufo/";

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    channel: "chrome",
    headless: process.env.HEADLESS !== "0",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  // Warm a session against the landing page so Akamai sees a real browse.
  await page.goto(LANDING, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Now fetch the CSV using the same session (same cookies, same fingerprint).
  const csv = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: "include" });
    return { status: r.status, text: await r.text() };
  }, CSV_URL);

  console.log(`[fetch-csv] status: ${csv.status}, length: ${csv.text.length}`);
  await writeFile(resolve(OUT_DIR, "uap-data.csv"), csv.text);

  // Print first 800 chars so we can eyeball columns + sample row.
  console.log("\n--- preview ---");
  console.log(csv.text.slice(0, 800));
  console.log("\n--- end preview ---");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
