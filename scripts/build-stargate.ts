// Builds data/stargate.json from the GotThatData/STARGATE-Processed Hugging
// Face dataset (a publicly-hosted, OCR-extracted, entity-annotated index of
// CIA Stargate Project documents declassified in 1995).
//
// Data quality caveats — important:
//   * The dataset's `dates` field is OCR noise (the declassification stamp
//     "Approved For Release 2014/01/09" appears on every page). We ignore it.
//   * The dataset's `entities.dates` is a noisy list extracted from OCR text.
//     We scan for a 4-digit year in [1950, 2005] as the document's approximate
//     creation year. ~337 of 485 docs in the Processed set yield a year.
//   * Date precision is therefore YEAR ONLY. We place each doc at Jan 1.
//   * 148 docs (~30%) without a parseable year are skipped — they wouldn't
//     plot on the timeline anyway.
//
// What we get: a 337-doc thin swimlane that puts the dense 1972-1977 SRI
// Stanford remote-viewing program right next to the Cold War nuclear-test
// peak — exactly the visual juxtaposition Off Nominal v2 was made for.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const META_JSON_URL =
  "https://huggingface.co/datasets/GotThatData/STARGATE-Processed/resolve/main/metadata.json";

const OUT = resolve(import.meta.dirname, "..", "data", "stargate.json");

type StargateDoc = {
  filename: string;
  category: string | null;
  classification: string | null;
  page_count: number;
  word_count: number;
  document_id: string | null;
  project_names: string[];
  entities: {
    dates: string[];
    persons: string[];
    organizations: string[];
    locations: string[];
  };
};

type Case = {
  dataset: "stargate";
  id: string;
  title: string;
  agency: string;
  incidentDate: string | null;
  incidentDateRaw: string;
  incidentLocation: string;
  releaseDate: string;
  type: string;
  subtype?: string;
  redacted: boolean;
  description: string;
  sourceUrl: string;
  videoTitle: string;
  dvidsVideoId: string;
  imageUrl: string;
  imageAlt: string;
};

// Filename → CIA reading room URL.
// e.g. "CIA-RDP79-00999A000200010001-4.txt" →
//      "https://www.cia.gov/readingroom/document/cia-rdp79-00999a000200010001-4"
function filenameToSourceUrl(fn: string): string {
  const id = fn.replace(/\.(txt|pdf)$/i, "").toLowerCase();
  return `https://www.cia.gov/readingroom/document/${id}`;
}

const YEAR_RE = /\b(19[5-9]\d|20[0-1]\d)\b/;

function extractYear(dates: string[]): number | null {
  for (const s of dates) {
    const m = YEAR_RE.exec(String(s));
    if (m) {
      const y = parseInt(m[1], 10);
      if (y >= 1950 && y <= 2005) return y;
    }
  }
  return null;
}

// Pretty noun-phrase title built from the filename and any extracted entities.
function buildTitle(d: StargateDoc, year: number | null): string {
  const id = d.filename.replace(/\.txt$/i, "");
  // Try to use the dominant project name if present, else just the doc ID.
  const proj = (d.project_names || []).find((p) => p.length > 2);
  const cat = (d.category || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  if (proj && cat) return `${id} — ${cat} (${proj}${year ? `, ${year}` : ""})`;
  if (cat) return `${id} — ${cat}${year ? `, ${year}` : ""}`;
  return id;
}

function buildDescription(d: StargateDoc, year: number | null): string {
  const parts: string[] = [];
  parts.push(
    `CIA Stargate Project document${year ? ` (~${year})` : ""}, declassified 1995 and released to the public via the CIA FOIA Reading Room.`,
  );
  if (d.category) parts.push(`Category: ${d.category.replace(/_/g, " ")}.`);
  if (d.classification) parts.push(`Original classification: ${d.classification}.`);
  if (d.page_count) parts.push(`Pages: ${d.page_count}.`);
  const persons = (d.entities?.persons || []).filter((p) => p.length > 2 && p.length < 40).slice(0, 5);
  if (persons.length) parts.push(`Key persons mentioned: ${persons.join(", ")}.`);
  const orgs = (d.entities?.organizations || []).filter((o) => o.length > 2 && o.length < 40).slice(0, 5);
  if (orgs.length) parts.push(`Organizations: ${orgs.join(", ")}.`);
  const locs = (d.entities?.locations || []).filter((l) => l.length > 1 && l.length < 40).slice(0, 5);
  if (locs.length) parts.push(`Mentioned locations: ${locs.join(", ")}.`);
  return parts.join(" ");
}

async function main() {
  console.log(`[build] fetching ${META_JSON_URL}`);
  const resp = await fetch(META_JSON_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const docs: StargateDoc[] = await resp.json();
  console.log(`[build] received ${docs.length} doc records`);

  const cases: Case[] = [];
  let skipped = 0;
  for (const d of docs) {
    const year = extractYear(d.entities?.dates || []);
    if (!year) {
      skipped++;
      continue;
    }
    cases.push({
      dataset: "stargate",
      id: `sg-${d.filename.replace(/\W/g, "_")}`,
      title: buildTitle(d, year),
      agency: "Central Intelligence Agency",
      incidentDate: `${year}-01-01`,
      incidentDateRaw: `${year} (approx)`,
      incidentLocation: "",
      releaseDate: "",
      type: "PDF",
      subtype: d.category || undefined,
      redacted: false,
      description: buildDescription(d, year),
      sourceUrl: filenameToSourceUrl(d.filename),
      videoTitle: "",
      dvidsVideoId: "",
      imageUrl: "",
      imageAlt: "",
    });
  }

  console.log(`[build] kept ${cases.length}, skipped ${skipped} (no parseable year)`);

  // Year distribution sanity check
  const counts = new Map<number, number>();
  for (const c of cases) {
    const y = parseInt(c.incidentDate!.slice(0, 4), 10);
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  console.log("[build] year distribution:");
  [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([y, n]) => console.log(`  ${y}: ${n}`));

  await mkdir(resolve(import.meta.dirname, "..", "data"), { recursive: true });
  await writeFile(OUT, JSON.stringify(cases, null, 2));
  console.log(`[build] wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
