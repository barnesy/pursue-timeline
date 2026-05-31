import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CSV_PATH = resolve(import.meta.dirname, "..", "data", "raw", "uap-data.csv");
const OUT_PATH = resolve(import.meta.dirname, "..", "data", "cases.json");

// Minimal RFC-4180 CSV parser (handles quoted fields, escaped quotes, newlines in fields).
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type Case = {
  id: string;
  title: string;
  agency: string;
  incidentDate: string | null;
  incidentDateRaw: string;
  incidentLocation: string;
  releaseDate: string;
  type: string;
  redacted: boolean;
  description: string;
  sourceUrl: string;
  videoTitle: string;
  dvidsVideoId: string;
  imageUrl: string;
  imageAlt: string;
};

// PURSUE files contain incidents from ~1940s through 2026. No future dates exist.
// So a 2-digit year >= 27 means 19xx, otherwise 20xx.
function expandTwoDigitYear(y: number): number {
  return y >= 27 ? 1900 + y : 2000 + y;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^(unknown|n\/a|none|tbd|-+)$/i.test(trimmed) || trimmed === "") return null;
  // Year range: "1948-1950" or "1948 - 1950" — use start year.
  const range = trimmed.match(/^(\d{4})\s*[-–]\s*(\d{2,4})$/);
  if (range) return `${range[1]}-01-01`;
  // "1950s" — decade.
  const decade = trimmed.match(/^(\d{4})s$/);
  if (decade) return `${decade[1]}-01-01`;
  // M/D/YY or M/D/YYYY
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let [, m, d, y] = slash;
    let year = parseInt(y, 10);
    if (year < 100) year = expandTwoDigitYear(year);
    return `${year.toString().padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // YYYY-only
  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) return `${yearOnly[1]}-01-01`;
  // "Month D, YYYY" or "Month YYYY"
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    const dt = new Date(parsed);
    return `${dt.getUTCFullYear().toString().padStart(4, "0")}-${(dt.getUTCMonth() + 1).toString().padStart(2, "0")}-${dt.getUTCDate().toString().padStart(2, "0")}`;
  }
  return null;
}

async function main() {
  const text = await readFile(CSV_PATH, "utf8");
  const rows = parseCSV(text);
  console.log(`total rows: ${rows.length}`);
  const header = rows[0];
  console.log(`columns (${header.length}):`);
  header.forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`));

  // Build a name → index map.
  const idx = (name: string) => header.findIndex((h) => h.trim() === name);
  const col = {
    redaction: idx("Redaction"),
    releaseDate: idx("Release Date"),
    title: idx("Title"),
    type: idx("Type"),
    description: idx("Description Blurb"),
    dvidsVideoId: idx("DVIDS Video ID"),
    videoTitle: idx("Video Title"),
    agency: idx("Agency"),
    incidentDate: idx("Incident Date"),
    incidentLocation: idx("Incident Location"),
    pdfImageLink: idx("PDF | Image Link"),
    modalImage: idx("Modal Image"),
    imageAlt: idx("Image Alt Text"),
  };
  console.log("\ncolumn indices:", col);

  const cases: Case[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c || !c.trim())) continue;
    const title = (row[col.title] || "").trim();
    if (!title) continue;
    const rawDate = (row[col.incidentDate] || "").trim();
    cases.push({
      id: `case-${r}`,
      title,
      agency: (row[col.agency] || "").trim(),
      incidentDate: normalizeDate(rawDate),
      incidentDateRaw: rawDate,
      incidentLocation: (row[col.incidentLocation] || "").trim(),
      releaseDate: (row[col.releaseDate] || "").trim(),
      type: (row[col.type] || "").trim(),
      redacted: /true/i.test(row[col.redaction] || ""),
      description: (row[col.description] || "").trim(),
      sourceUrl: (row[col.pdfImageLink] || "").trim(),
      videoTitle: (row[col.videoTitle] || "").trim(),
      dvidsVideoId: (row[col.dvidsVideoId] || "").trim(),
      imageUrl: (row[col.modalImage] || "").trim(),
      imageAlt: (row[col.imageAlt] || "").trim(),
    });
  }

  console.log(`\nparsed cases: ${cases.length}`);

  // Stats.
  const byAgency = new Map<string, number>();
  const byType = new Map<string, number>();
  const byRelease = new Map<string, number>();
  let withDate = 0;
  let withLocation = 0;
  let withSourceUrl = 0;
  let earliest = "9999";
  let latest = "0000";
  for (const c of cases) {
    byAgency.set(c.agency || "(blank)", (byAgency.get(c.agency || "(blank)") || 0) + 1);
    byType.set(c.type || "(blank)", (byType.get(c.type || "(blank)") || 0) + 1);
    byRelease.set(c.releaseDate || "(blank)", (byRelease.get(c.releaseDate || "(blank)") || 0) + 1);
    if (c.incidentDate) {
      withDate++;
      if (c.incidentDate < earliest) earliest = c.incidentDate;
      if (c.incidentDate > latest) latest = c.incidentDate;
    }
    if (c.incidentLocation) withLocation++;
    if (c.sourceUrl) withSourceUrl++;
  }

  console.log(`\nwith parsed incident date: ${withDate}/${cases.length}`);
  console.log(`with location: ${withLocation}/${cases.length}`);
  console.log(`with source url: ${withSourceUrl}/${cases.length}`);
  console.log(`date range: ${earliest} → ${latest}`);

  console.log("\nby agency:");
  [...byAgency.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));

  console.log("\nby type:");
  [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));

  console.log("\nby release date:");
  [...byRelease.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));

  console.log("\nsample raw incident dates that did NOT parse:");
  const unparsed = cases.filter((c) => c.incidentDateRaw && !c.incidentDate);
  for (const c of unparsed.slice(0, 15)) {
    console.log(`  ${JSON.stringify(c.incidentDateRaw)} — ${c.title.slice(0, 60)}`);
  }
  console.log(`  (total unparsed: ${unparsed.length})`);

  console.log("\nsample locations:");
  for (const c of cases.slice(0, 8)) {
    console.log(`  ${c.incidentDate ?? "????"}  ${c.agency.padEnd(15)}  ${c.incidentLocation.padEnd(30)}  ${c.title.slice(0, 50)}`);
  }

  await writeFile(OUT_PATH, JSON.stringify(cases, null, 2));
  console.log(`\nwrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
