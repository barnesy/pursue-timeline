// Builds data/uap-catalog.json from data/raw/uap-catalog-raw.json (extracted
// from UAP_Verification_Catalog-3.xlsx). One curated dataset combining the
// workbook's three data sheets into Case records distinguished by `subtype`:
//   • "case"        — the scored Case Catalog (geographic, verification scores)
//   • "testimony"   — sworn Congressional testimony (placed at the US Capitol)
//   • "publication" — key published works / reports (timeline-only, no geo)
//
// Provenance: hand-curated "UAP Imagery & Video Verification Catalog" — a
// framework for cataloging publicly available, not-widely-debunked UAP
// imagery/video plus key published works and sworn testimony.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RAW = resolve(import.meta.dirname, "..", "data", "raw", "uap-catalog-raw.json");
const OUT = resolve(import.meta.dirname, "..", "data", "uap-catalog.json");

type Case = {
  dataset: string;
  lat?: number;
  lng?: number;
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

// Approximate centroids for the catalog's free-text locations, keyed by the
// exact location string in the source. `country` drives the agency lane/filter.
const UAP_GEO: Record<string, { lat: number; lng: number; country: string }> = {
  "Pacific Ocean, ~100 mi off San Diego, CA, USA": { lat: 32.4, lng: -118.5, country: "United States" },
  "Atlantic Ocean, off the US East Coast (Florida/Jacksonville area)": { lat: 30.2, lng: -79.8, country: "United States" },
  "McMinnville, Oregon, USA (Trent farm, Yamhill County)": { lat: 45.21, lng: -123.2, country: "United States" },
  "Lubbock, Texas, USA": { lat: 33.58, lng: -101.86, country: "United States" },
  "Trindade Island, South Atlantic (off Brazil)": { lat: -20.5, lng: -29.32, country: "Brazil" },
  "Chesapeake Bay area, near Norfolk, Virginia, USA": { lat: 36.95, lng: -76.3, country: "United States" },
  "Phoenix / Prescott area, Arizona, USA (also Sonora, Mexico)": { lat: 33.8, lng: -112.2, country: "United States" },
  "Belgium (Eupen/Wallonia region; photo from Petit-Rechain)": { lat: 50.63, lng: 6.04, country: "Belgium" },
  "Off Aguadilla / Rafael Hernandez Airport, Puerto Rico": { lat: 18.5, lng: -67.18, country: "United States" },
  "Pacific Ocean, off San Diego, CA, USA": { lat: 32.6, lng: -117.5, country: "United States" },
  "Near Calvine, Perthshire, Scotland, UK": { lat: 56.75, lng: -3.95, country: "United Kingdom" },
  "Off the coast near Santiago, Chile (Chilean coast)": { lat: -33.5, lng: -72.0, country: "Chile" },
  "Nazca / Palpa desert region, Peru (presented in Mexico City)": { lat: -14.7, lng: -75.1, country: "Peru" },
  "Buga, Valle del Cauca, Colombia": { lat: 3.9, lng: -76.3, country: "Colombia" },
  "Fayetteville, North Carolina, USA": { lat: 35.05, lng: -78.88, country: "United States" },
  // "Unknown / unverified (claimed USSR; no real location)" → intentionally no geo
};
const CAPITOL = { lat: 38.8899, lng: -77.0091 }; // US Capitol — testimony anchor

// Credible reference link per published work (keyed by exact Title). Wikipedia
// author/topic pages where no standalone work article exists; primary gov
// sources for the official records. All verified to resolve.
const PUB_SOURCE: Record<string, string> = {
  "UFOs: Generals, Pilots, and Government Officials Go on the Record": "https://en.wikipedia.org/wiki/Leslie_Kean",
  "The UFO Experience: A Scientific Inquiry": "https://en.wikipedia.org/wiki/J._Allen_Hynek",
  "Final Report of the Scientific Study of UFOs (Condon Report)": "https://en.wikipedia.org/wiki/Condon_Committee",
  "Project Blue Book (declassified files)": "https://www.archives.gov/research/military/air-force/ufos",
  "Scientific Coalition for UAP Studies (SCU) reports": "https://www.explorescu.org/",
  "The Sturrock Panel Report": "https://en.wikipedia.org/wiki/Peter_A._Sturrock",
  "AARO Historical Record Report Vol. 1": "https://www.aaro.mil/Portals/136/PDFs/AARO_Historical_Record_Report_Vol_1_2024.pdf",
  Imminent: "https://en.wikipedia.org/wiki/Luis_Elizondo",
};

const s = (v: unknown) => (v == null ? "" : String(v).trim());
// First 4-digit year in a string like "2017-2025" / "2007-present" / "1989-90".
function firstYear(v: unknown): number | null {
  const m = s(v).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}
function isoFromYear(y: number | null): string | null {
  return y ? `${y}-01-01` : null;
}
// Parse a hearing string like "House Oversight subcmte (Jul 26, 2023)".
function parseHearingDate(hearing: string): string | null {
  const paren = hearing.match(/\(([^)]*)\)/);
  const inner = paren ? paren[1] : hearing;
  const md = inner.match(/([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (md) {
    const d = new Date(`${md[1]} ${md[2]}, ${md[3]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const my = inner.match(/([A-Za-z]{3,})\s+(\d{4})/);
  if (my) {
    const d = new Date(`${my[1]} 1, ${my[2]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return isoFromYear(firstYear(hearing));
}
// Media chip from the catalog's free-text Type.
function mediaType(t: string): string {
  const u = t.toUpperCase();
  if (u.includes("VIDEO")) return "VID";
  if (u.includes("PHOTO") || u.includes("PHYSICAL") || u.includes("X-RAY") || u.includes("CT")) return "IMG";
  return "PDF";
}

async function main() {
  const raw = JSON.parse(await readFile(RAW, "utf8")) as {
    caseCatalog: Record<string, unknown>[];
    testimony: Record<string, unknown>[];
    publishedWorks: Record<string, unknown>[];
  };

  const cases: Case[] = [];

  // 1) Scored case catalog ---------------------------------------------------
  let unmatched = 0;
  for (const r of raw.caseCatalog) {
    const num = s(r["#"]);
    const title = s(r["Case / Title"]);
    if (!title) continue;
    const loc = s(r["Location"]);
    const geo = UAP_GEO[loc];
    if (!geo && !/unknown|unverified/i.test(loc)) unmatched++;
    const y = firstYear(r["Year"]);
    const scoreLine = [
      ["Provenance", r["Provenance (source ID) (1-5)"]],
      ["Custody", r["Chain of Custody (1-5)"]],
      ["Corroboration", r["Corroboration (1-5)"]],
      ["Tech", r["Scan/Tech Quality (1-5)"]],
      ["Debunk-resist", r["Debunk Resist (1-5)"]],
      ["Proximity", r["Proximity (1-5)"]],
    ]
      .filter(([, v]) => s(v))
      .map(([k, v]) => `${k} ${s(v)}`)
      .join(" · ");
    const total = s(r["Total (max 30)"]);
    const tier = s(r["Tier"]);
    const description = [
      total ? `Verification score ${total}/30${tier ? ` (${tier} tier)` : ""}.` : "",
      scoreLine ? `Dimensions — ${scoreLine}.` : "",
      s(r["Source / Origin"]) ? `Source: ${s(r["Source / Origin"])}.` : "",
      s(r["Notes / Verification Status"]),
    ]
      .filter(Boolean)
      .join(" ");
    cases.push({
      dataset: "uap-catalog",
      lat: geo?.lat,
      lng: geo?.lng,
      id: `uc-case-${num || cases.length + 1}`,
      title,
      // Group by record kind, not country — the map shows geography already.
      agency: "Catalog case",
      incidentDate: isoFromYear(y),
      incidentDateRaw: s(r["Year"]),
      incidentLocation: loc,
      releaseDate: "",
      type: mediaType(s(r["Type"])),
      subtype: `Catalog case · ${s(r["Type"]) || "case"}`,
      redacted: false,
      description,
      sourceUrl: s(r["Source URL"]),
      videoTitle: "",
      dvidsVideoId: "",
      imageUrl: "",
      imageAlt: "",
    });
  }

  // 2) Congressional testimony (rows with a real witness only) ---------------
  for (const r of raw.testimony) {
    const witness = s(r["Witness"]);
    const hearing = s(r["Hearing (Date)"]);
    if (!witness || !hearing) continue; // skip the appendix/weighting rows
    const iso = parseHearingDate(hearing);
    const description = [
      s(r["Service / Role"]) ? `${s(r["Service / Role"])}.` : "",
      s(r["What They Testified"]),
      s(r["Credibility Notes / Caveats"]) ? `Caveats: ${s(r["Credibility Notes / Caveats"])}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    cases.push({
      dataset: "uap-catalog",
      lat: CAPITOL.lat,
      lng: CAPITOL.lng,
      id: `uc-test-${s(r["#"]) || cases.length + 1}`,
      title: `${witness}${s(r["Account Type"]) ? ` — ${s(r["Account Type"])}` : ""}`,
      agency: "Congressional testimony",
      incidentDate: iso,
      incidentDateRaw: hearing,
      incidentLocation: "U.S. Congress, Washington, DC",
      releaseDate: "",
      type: "VID",
      subtype: `Sworn testimony · ${hearing}`,
      redacted: false,
      description,
      sourceUrl: s(r["Source"]),
      videoTitle: "",
      dvidsVideoId: "",
      imageUrl: "",
      imageAlt: "",
    });
  }

  // 3) Published works / reports (timeline-only, no geo) ---------------------
  for (const r of raw.publishedWorks) {
    const title = s(r["Title"]);
    if (!title) continue;
    const y = firstYear(r["Year"]);
    cases.push({
      dataset: "uap-catalog",
      id: `uc-pub-${s(r["#"]) || cases.length + 1}`,
      title,
      agency: "Published work",
      incidentDate: isoFromYear(y),
      incidentDateRaw: s(r["Year"]),
      incidentLocation: "",
      releaseDate: "",
      type: "PDF",
      subtype: `Published work · ${s(r["Type"]) || "reference"}`,
      redacted: false,
      description: [s(r["Author"]) ? `By ${s(r["Author"])}.` : "", s(r["Why It Matters / Verification Value"])].filter(Boolean).join(" "),
      sourceUrl: PUB_SOURCE[title] ?? "",
      videoTitle: "",
      dvidsVideoId: "",
      imageUrl: "",
      imageAlt: "",
    });
  }

  const withGeo = cases.filter((c) => c.lat !== undefined).length;
  console.log(`[build] uap-catalog: ${cases.length} records (${withGeo} geolocated). ${unmatched} unmatched case locations.`);
  await writeFile(OUT, JSON.stringify(cases, null, 2));
  console.log(`[build] wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
