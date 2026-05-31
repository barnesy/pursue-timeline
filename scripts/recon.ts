import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_DIR = resolve(import.meta.dirname, "..", "data", "raw");
const START_URL = "https://www.war.gov/ufo/?releaseDate=Release+02#records";

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const headless = process.env.HEADLESS !== "0";
  const browser = await chromium.launch({
    channel: "chrome",
    headless,
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
    extraHTTPHeaders: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  // Capture every network request.
  type Req = {
    url: string;
    method: string;
    resourceType: string;
    status?: number;
    contentType?: string;
    size?: number;
  };
  const requests: Req[] = [];
  page.on("response", async (resp) => {
    const req = resp.request();
    const url = req.url();
    if (
      /\.(png|jpg|jpeg|webp|gif|svg|woff2?|ttf|css|ico)(\?|$)/i.test(url) ||
      /google-analytics|googletagmanager|doubleclick/i.test(url)
    ) {
      return;
    }
    let size: number | undefined;
    try {
      const buf = await resp.body();
      size = buf.length;
    } catch {}
    requests.push({
      url,
      method: req.method(),
      resourceType: req.resourceType(),
      status: resp.status(),
      contentType: resp.headers()["content-type"],
      size,
    });
  });

  console.log(`[recon] navigating: ${START_URL}`);
  const resp = await page.goto(START_URL, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  console.log(`[recon] status: ${resp?.status()}`);

  // Extra settle for late XHR.
  await page.waitForTimeout(5000);

  // Try scrolling to trigger lazy loading.
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
  );
  await page.waitForTimeout(3000);

  const title = await page.title();
  console.log(`[recon] title: ${title}`);
  console.log(`[recon] captured requests: ${requests.length}`);

  const html = await page.content();
  await writeFile(resolve(OUT_DIR, "records.html"), html);

  await writeFile(
    resolve(OUT_DIR, "network.json"),
    JSON.stringify(requests, null, 2),
  );

  // Surface the most promising endpoints.
  const interesting = requests.filter(
    (r) =>
      r.resourceType === "xhr" ||
      r.resourceType === "fetch" ||
      /\.(json|xml)(\?|$)/i.test(r.url) ||
      /\.pdf(\?|$)/i.test(r.url) ||
      /api|data|records|release|case|uap|ufo|pursue/i.test(r.url),
  );
  console.log(`[recon] interesting requests: ${interesting.length}`);
  for (const r of interesting) {
    console.log(
      `  ${r.method} ${r.status} ${r.resourceType} ${(r.size ?? 0).toString().padStart(8)}b  ${r.url}`,
    );
  }

  // Also count any links/PDFs that appear after JS settles.
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      href: (a as HTMLAnchorElement).href,
      text: (a.textContent || "").trim().slice(0, 120),
    })),
  );
  const pdfs = links.filter((l) => /\.pdf(\?|$)/i.test(l.href));
  const medialinks = links.filter((l) =>
    /media\.(defense|war)\.gov|medialink/i.test(l.href),
  );
  console.log(`[recon] total links after JS: ${links.length}`);
  console.log(`[recon] pdf links: ${pdfs.length}`);
  console.log(`[recon] media.* links: ${medialinks.length}`);

  await writeFile(
    resolve(OUT_DIR, "records-links.json"),
    JSON.stringify({ all: links, pdfs, medialinks }, null, 2),
  );

  await page.screenshot({
    path: resolve(OUT_DIR, "records.png"),
    fullPage: true,
  });

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
