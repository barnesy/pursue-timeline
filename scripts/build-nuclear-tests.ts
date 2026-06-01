// Builds data/nuclear-tests.json from the SIPRI Nuclear Explosions dataset
// (1945-1998, republished by TidyTuesday on GitHub) plus a small hand-curated
// supplement for post-1998 North Korean tests.
//
// Provenance:
//   Underlying source: Stockholm International Peace Research Institute (SIPRI)
//   Republished CSV:   github.com/rfordatascience/tidytuesday (CC0 / public domain
//                      republishing of US/USSR government test records)
//   Post-1998 NK tests sourced from Wikipedia (CC-BY-SA) and CTBTO press releases.
//
// Output: data/nuclear-tests.json — array of Case objects ready to merge into
// the same array as the existing UAP cases.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CSV_URL =
  "https://raw.githubusercontent.com/rfordatascience/tidytuesday/master/data/2019/2019-08-20/nuclear_explosions.csv";
const OUT = resolve(import.meta.dirname, "..", "data", "nuclear-tests.json");

const COUNTRY_NAMES: Record<string, string> = {
  USA: "United States",
  USSR: "Soviet Union",
  UK: "United Kingdom",
  FRANCE: "France",
  CHINA: "China",
  INDIA: "India",
  PAKIST: "Pakistan",
  "N.KOREA": "North Korea",
};

const PURPOSE_LABELS: Record<string, string> = {
  WR: "weapons R&D",
  WE: "weapons effects",
  PNE: "peaceful nuclear explosion",
  SE: "safety experiment",
  FMS: "fundamental materials science",
  SAM: "stockpile maintenance",
  COMBAT: "combat use",
  TRANSP: "transportation safety",
  SB: "stockpile / safety",
  ME: "military exercise",
};

const TYPE_LABELS: Record<string, string> = {
  SHAFT: "underground shaft",
  "SHAFT/GR": "underground shaft (gallery)",
  "SHAFT/LG": "underground shaft (large)",
  TUNNEL: "underground tunnel",
  ATMOSPH: "atmospheric",
  AIRDROP: "airdrop",
  TOWER: "tower",
  SURFACE: "surface",
  BALLOON: "balloon",
  BARGE: "barge on water",
  UG: "underground",
  CRATER: "cratering",
  ROCKET: "rocket-delivered",
  SHIP: "ship",
  UW: "underwater",
};

// Wikipedia per-country list pages — stable, public, the official-ish encyclopedia of record.
const COUNTRY_SOURCE_URL: Record<string, string> = {
  "United States": "https://en.wikipedia.org/wiki/List_of_nuclear_weapons_tests_of_the_United_States",
  "Soviet Union": "https://en.wikipedia.org/wiki/List_of_nuclear_weapons_tests_of_the_Soviet_Union",
  "United Kingdom": "https://en.wikipedia.org/wiki/List_of_nuclear_weapons_tests_of_the_United_Kingdom",
  France: "https://en.wikipedia.org/wiki/List_of_nuclear_weapons_tests_of_France",
  China: "https://en.wikipedia.org/wiki/List_of_nuclear_weapons_tests_of_China",
  India: "https://en.wikipedia.org/wiki/List_of_nuclear_weapons_tests_of_India",
  Pakistan: "https://en.wikipedia.org/wiki/List_of_nuclear_weapons_tests_of_Pakistan",
  "North Korea": "https://en.wikipedia.org/wiki/List_of_North_Korean_nuclear_tests",
};

type Case = {
  dataset: "nuclear-test";
  id: string;
  title: string;
  agency: string;
  incidentDate: string | null;
  incidentDateRaw: string;
  incidentLocation: string;
  lat?: number;
  lng?: number;
  yieldKt?: number;
  yieldKtUpper?: number;
  altitudeM?: number;
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
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function formatDateLong(dateLong: string): { iso: string | null; raw: string } {
  if (!/^\d{8}$/.test(dateLong)) return { iso: null, raw: dateLong };
  const y = dateLong.slice(0, 4);
  const m = dateLong.slice(4, 6);
  const d = dateLong.slice(6, 8);
  return { iso: `${y}-${m}-${d}`, raw: `${m}/${d}/${y}` };
}

function describeYield(low: string, high: string): string {
  const lo = parseFloat(low);
  const hi = parseFloat(high);
  if (!isFinite(lo) && !isFinite(hi)) return "yield unknown";
  if (lo === hi || !isFinite(hi)) return formatKt(lo);
  return `${formatKt(lo)}–${formatKt(hi)}`;
}

function formatKt(kt: number): string {
  if (kt === 0) return "<1 kt";
  if (kt >= 1000) return `${(kt / 1000).toFixed(kt >= 10_000 ? 0 : 1)} Mt`;
  return `${kt < 1 ? kt.toFixed(2) : kt} kt`;
}

// Hand-curated post-1998 North Korean tests (SIPRI dataset ends 1998).
// Coordinates: Punggye-ri test site, the only site NK has used.
const POST_1998_TESTS: Case[] = [
  {
    dataset: "nuclear-test",
    id: "nt-nk-2006",
    title: "2006 North Korean nuclear test",
    agency: "North Korea",
    incidentDate: "2006-10-09",
    incidentDateRaw: "10/09/2006",
    incidentLocation: "Punggye-ri, North Korea",
    lat: 41.294,
    lng: 129.094,
    releaseDate: "",
    type: "underground shaft",
    altitudeM: -700,
    redacted: false,
    description:
      "North Korea's first nuclear weapons test, conducted at the Punggye-ri site. Estimated yield <1 kt — widely considered a partial fizzle.",
    sourceUrl: COUNTRY_SOURCE_URL["North Korea"],
    yieldKt: 0.5,
    videoTitle: "", dvidsVideoId: "", imageUrl: "", imageAlt: "",
  },
  {
    dataset: "nuclear-test",
    id: "nt-nk-2009",
    title: "2009 North Korean nuclear test",
    agency: "North Korea",
    incidentDate: "2009-05-25",
    incidentDateRaw: "05/25/2009",
    incidentLocation: "Punggye-ri, North Korea",
    lat: 41.294,
    lng: 129.094,
    releaseDate: "",
    type: "underground shaft",
    altitudeM: -700,
    redacted: false,
    description:
      "Second North Korean test. Estimated yield ~2–6 kt. Confirmed by USGS seismic detection (4.7 mb).",
    sourceUrl: COUNTRY_SOURCE_URL["North Korea"],
    yieldKt: 2,
    yieldKtUpper: 6,
    videoTitle: "", dvidsVideoId: "", imageUrl: "", imageAlt: "",
  },
  {
    dataset: "nuclear-test",
    id: "nt-nk-2013",
    title: "2013 North Korean nuclear test",
    agency: "North Korea",
    incidentDate: "2013-02-12",
    incidentDateRaw: "02/12/2013",
    incidentLocation: "Punggye-ri, North Korea",
    lat: 41.294,
    lng: 129.094,
    releaseDate: "",
    type: "underground shaft",
    altitudeM: -700,
    redacted: false,
    description:
      "Third North Korean test. Estimated yield ~6–9 kt, possibly using highly enriched uranium for the first time.",
    sourceUrl: COUNTRY_SOURCE_URL["North Korea"],
    yieldKt: 6,
    yieldKtUpper: 9,
    videoTitle: "", dvidsVideoId: "", imageUrl: "", imageAlt: "",
  },
  {
    dataset: "nuclear-test",
    id: "nt-nk-2016a",
    title: "January 2016 North Korean nuclear test",
    agency: "North Korea",
    incidentDate: "2016-01-06",
    incidentDateRaw: "01/06/2016",
    incidentLocation: "Punggye-ri, North Korea",
    lat: 41.294,
    lng: 129.094,
    releaseDate: "",
    type: "underground shaft",
    altitudeM: -700,
    redacted: false,
    description:
      'North Korea claimed this was a hydrogen bomb test. Yield ~7–10 kt — too small for a true H-bomb; analysts believe it may have been a boosted fission device.',
    sourceUrl: COUNTRY_SOURCE_URL["North Korea"],
    yieldKt: 7,
    yieldKtUpper: 10,
    videoTitle: "", dvidsVideoId: "", imageUrl: "", imageAlt: "",
  },
  {
    dataset: "nuclear-test",
    id: "nt-nk-2016b",
    title: "September 2016 North Korean nuclear test",
    agency: "North Korea",
    incidentDate: "2016-09-09",
    incidentDateRaw: "09/09/2016",
    incidentLocation: "Punggye-ri, North Korea",
    lat: 41.294,
    lng: 129.094,
    releaseDate: "",
    type: "underground shaft",
    altitudeM: -700,
    redacted: false,
    description:
      "Fifth North Korean test. Estimated yield ~10–25 kt — largest yield up to that point.",
    sourceUrl: COUNTRY_SOURCE_URL["North Korea"],
    yieldKt: 10,
    yieldKtUpper: 25,
    videoTitle: "", dvidsVideoId: "", imageUrl: "", imageAlt: "",
  },
  {
    dataset: "nuclear-test",
    id: "nt-nk-2017",
    title: "2017 North Korean nuclear test",
    agency: "North Korea",
    incidentDate: "2017-09-03",
    incidentDateRaw: "09/03/2017",
    incidentLocation: "Punggye-ri, North Korea",
    lat: 41.332,
    lng: 129.030,
    releaseDate: "",
    type: "underground shaft",
    altitudeM: -700,
    redacted: false,
    description:
      "Sixth and most powerful North Korean nuclear test. Estimated yield ~100–250 kt, consistent with a thermonuclear (H-bomb) device. Caused observable surface deformation at Mount Mantap.",
    sourceUrl: COUNTRY_SOURCE_URL["North Korea"],
    yieldKt: 100,
    yieldKtUpper: 250,
    videoTitle: "", dvidsVideoId: "", imageUrl: "", imageAlt: "",
  },
];

async function main() {
  console.log(`[build] fetching ${CSV_URL}`);
  const resp = await fetch(CSV_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  const rows = parseCSV(text);
  console.log(`[build] parsed ${rows.length} rows (incl. header)`);

  const header = rows[0];
  const col = (name: string) => header.findIndex((h) => h.trim() === name);
  const idx = {
    date_long: col("date_long"),
    year: col("year"),
    id_no: col("id_no"),
    country: col("country"),
    region: col("region"),
    source: col("source"),
    latitude: col("latitude"),
    longitude: col("longitude"),
    depth: col("depth"),
    yield_lower: col("yield_lower"),
    yield_upper: col("yield_upper"),
    purpose: col("purpose"),
    name: col("name"),
    type: col("type"),
  };

  const cases: Case[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c || !c.trim())) continue;

    const country = (row[idx.country] || "").trim();
    const countryName = COUNTRY_NAMES[country] ?? country;
    const name = (row[idx.name] || "").trim() || `Test ${row[idx.id_no]}`;
    const region = (row[idx.region] || "").trim();
    const rawType = (row[idx.type] || "").trim();
    const typeLabel = TYPE_LABELS[rawType] ?? rawType.toLowerCase();
    const purpose = (row[idx.purpose] || "").trim();
    const purposeLabel = PURPOSE_LABELS[purpose] ?? purpose;
    const lat = parseFloat(row[idx.latitude]);
    const lng = parseFloat(row[idx.longitude]);
    const { iso, raw } = formatDateLong(row[idx.date_long]);

    const yieldStr = describeYield(row[idx.yield_lower], row[idx.yield_upper]);
    const depthKm = parseFloat(row[idx.depth]);
    let depthStr = "";
    let altitudeM: number | undefined;
    if (isFinite(depthKm)) {
      // SIPRI convention: positive depth = below ground (m), negative = above
      // ground. Our altitudeM uses the opposite sign so positive = up.
      altitudeM = Math.round(-depthKm * 1000);
      if (depthKm < 0) depthStr = `${Math.abs(depthKm * 1000).toFixed(0)} m above ground`;
      else if (depthKm > 0) depthStr = `${(depthKm * 1000).toFixed(0)} m underground`;
    }

    const description = [
      `${countryName} nuclear test "${name}" at ${region || "an undisclosed site"}.`,
      `Yield: ${yieldStr}.`,
      `Method: ${typeLabel}${depthStr ? ` (${depthStr})` : ""}.`,
      `Purpose: ${purposeLabel}.`,
    ].join(" ");

    // Hiroshima + Nagasaki special-case — these are weapons-used-in-anger, not "tests".
    const isCombat = purpose === "COMBAT";
    const title = isCombat
      ? `${name} — atomic bombing of ${region}`
      : `${name} — ${countryName} ${purposeLabel}`;

    const yieldLower = parseFloat(row[idx.yield_lower]);
    const yieldUpper = parseFloat(row[idx.yield_upper]);
    cases.push({
      dataset: "nuclear-test",
      id: `nt-${row[idx.id_no]}`,
      title,
      agency: countryName,
      incidentDate: iso,
      incidentDateRaw: raw || row[idx.date_long],
      incidentLocation: region,
      lat: isFinite(lat) && lat !== 0 ? lat : undefined,
      lng: isFinite(lng) && lng !== 0 ? lng : undefined,
      yieldKt: isFinite(yieldLower) && yieldLower > 0 ? yieldLower : undefined,
      yieldKtUpper:
        isFinite(yieldUpper) && yieldUpper > 0 && yieldUpper !== yieldLower
          ? yieldUpper
          : undefined,
      altitudeM,
      releaseDate: "",
      type: typeLabel.toUpperCase(),
      redacted: false,
      description,
      sourceUrl: COUNTRY_SOURCE_URL[countryName] ?? "",
      videoTitle: "",
      dvidsVideoId: "",
      imageUrl: "",
      imageAlt: "",
    });
  }

  const all = [...cases, ...POST_1998_TESTS];
  console.log(`[build] transformed ${cases.length} (1945-1998) + ${POST_1998_TESTS.length} (post-1998 NK) = ${all.length} total`);

  // Sanity stats
  const byCountry = new Map<string, number>();
  let withLatLng = 0;
  for (const c of all) {
    byCountry.set(c.agency, (byCountry.get(c.agency) || 0) + 1);
    if (c.lat !== undefined && c.lng !== undefined) withLatLng++;
  }
  console.log(`[build] with lat/lng: ${withLatLng}/${all.length}`);
  console.log("[build] by country:");
  [...byCountry.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));

  // Guarantee unique ids. The SIPRI source numbers tests per-program, so two
  // different tests can collide on `id_no` (e.g. US PINEDROPS and France
  // TAUREAU both → 74044). React keys + case selection rely on a unique id, so
  // suffix any later collision deterministically: first keeps the id, the nth
  // duplicate becomes `${id}-${n}`.
  const seen = new Map<string, number>();
  let collisions = 0;
  for (const c of all) {
    const n = (seen.get(c.id) ?? 0) + 1;
    seen.set(c.id, n);
    if (n > 1) {
      c.id = `${c.id}-${n}`;
      collisions++;
    }
  }
  if (collisions) console.log(`[build] de-duplicated ${collisions} colliding id(s)`);

  await mkdir(resolve(import.meta.dirname, "..", "data"), { recursive: true });
  await writeFile(OUT, JSON.stringify(all, null, 2));
  console.log(`[build] wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
