// Inspect cross-dataset hotspots: load all data, run the same scoring the
// app uses, dump the top-20 with enough detail to decide what's interesting.
//
// Run: npx tsx scripts/inspect-hotspots.ts
//
// Goal: stop speculating about what the algorithm SHOULD surface and look at
// what it actually does. Then iterate.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Case = {
  id: string;
  dataset: string;
  agency: string;
  title: string;
  incidentDate: string | null;
  incidentLocation: string;
  lat?: number;
  lng?: number;
  yieldKt?: number;
};

const ROOT = resolve(import.meta.dirname, "..");

// ---------------------------------------------------------------
// Mirror the app's geocoder + proximity logic so the scoring stays
// faithful to what users see in the Hotspots panel.
// ---------------------------------------------------------------

type GeoEntry = { lat: number; lng: number; display: string; offWorld?: boolean };

// Mirror src/locations.ts
const LOCATIONS: Record<string, GeoEntry> = {
  CENTCOM: { lat: 29.0, lng: 47.0, display: "CENTCOM (Middle East AOR)" },
  NORTHCOM: { lat: 39.0, lng: -100.0, display: "NORTHCOM (N. America AOR)" },
  AFRICOM: { lat: 5.0, lng: 22.0, display: "AFRICOM (Africa AOR)" },
  EUCOM: { lat: 50.0, lng: 15.0, display: "EUCOM (Europe AOR)" },
  "Indo-PACOM": { lat: 0.0, lng: 130.0, display: "INDOPACOM (Indo-Pacific AOR)" },
  INDOPACOM: { lat: 0.0, lng: 130.0, display: "INDOPACOM (Indo-Pacific AOR)" },
  "Western United States": { lat: 37.0, lng: -115.0, display: "Western US" },
  "United States": { lat: 38.0, lng: -97.0, display: "United States" },
  "Southeastern United States": { lat: 33.0, lng: -85.0, display: "Southeastern US" },
  "Southern United States": { lat: 32.0, lng: -90.0, display: "Southern US" },
  "Midwestern United States": { lat: 40.0, lng: -90.0, display: "Midwestern US" },
  "North America": { lat: 48.0, lng: -100.0, display: "North America" },
  "Pacific Time Zone": { lat: 37.0, lng: -120.0, display: "US Pacific Time Zone" },
  "New Mexico": { lat: 34.5, lng: -106.0, display: "New Mexico" },
  Texas: { lat: 31.0, lng: -100.0, display: "Texas" },
  "Detroit, MI": { lat: 42.33, lng: -83.05, display: "Detroit, MI" },
  Georgia: { lat: 32.8, lng: -83.5, display: "Georgia (US)" },
  "Arabian Gulf": { lat: 26.5, lng: 51.5, display: "Arabian (Persian) Gulf" },
  "Arabian Sea": { lat: 15.0, lng: 65.0, display: "Arabian Sea" },
  "Gulf of Oman": { lat: 24.5, lng: 58.0, display: "Gulf of Oman" },
  "Gulf of Aden": { lat: 12.0, lng: 48.0, display: "Gulf of Aden" },
  "Strait of Hormuz": { lat: 26.5, lng: 56.25, display: "Strait of Hormuz" },
  "Middle East": { lat: 30.0, lng: 45.0, display: "Middle East" },
  Syria: { lat: 35.0, lng: 38.0, display: "Syria" },
  Iraq: { lat: 33.0, lng: 44.0, display: "Iraq" },
  Iran: { lat: 32.0, lng: 53.0, display: "Iran" },
  "United Arab Emirates": { lat: 23.5, lng: 54.0, display: "United Arab Emirates" },
  Djibouti: { lat: 11.5, lng: 43.0, display: "Djibouti" },
  Germany: { lat: 51.0, lng: 10.0, display: "Germany" },
  Greece: { lat: 39.0, lng: 22.0, display: "Greece" },
  Netherlands: { lat: 52.0, lng: 5.0, display: "Netherlands" },
  "Mediterranean Sea": { lat: 35.0, lng: 18.0, display: "Mediterranean Sea" },
  "Aegean Sea": { lat: 39.0, lng: 25.0, display: "Aegean Sea" },
  USSR: { lat: 60.0, lng: 80.0, display: "USSR" },
  Kazakhstan: { lat: 48.0, lng: 68.0, display: "Kazakhstan" },
  Azerbaijan: { lat: 40.0, lng: 47.5, display: "Azerbaijan" },
  Turkmenistan: { lat: 39.0, lng: 59.0, display: "Turkmenistan" },
  Japan: { lat: 36.0, lng: 138.0, display: "Japan" },
  "East China Sea": { lat: 30.0, lng: 125.0, display: "East China Sea" },
  "Yellow Sea": { lat: 36.0, lng: 123.5, display: "Yellow Sea" },
  "Pacific Ocean": { lat: 0.0, lng: -150.0, display: "Pacific Ocean" },
  "North Atlantic Ocean": { lat: 40.0, lng: -40.0, display: "North Atlantic" },
  Mexico: { lat: 23.0, lng: -102.0, display: "Mexico" },
  "Papua New Guinea": { lat: -6.0, lng: 145.0, display: "Papua New Guinea" },
  Moon: { lat: 0, lng: 0, display: "Moon", offWorld: true },
  "Low Earth Orbit": { lat: 0, lng: 0, display: "Low Earth Orbit", offWorld: true },
  "Cislunar Space": { lat: 0, lng: 0, display: "Cislunar Space", offWorld: true },
};

function geocode(loc: string): GeoEntry | null {
  if (!loc) return null;
  const trimmed = loc.trim();
  if (!trimmed || trimmed === "N/A") return null;
  return LOCATIONS[trimmed] ?? null;
}

function getLatLng(c: Case): { lat: number; lng: number } | null {
  if (typeof c.lat === "number" && typeof c.lng === "number") return { lat: c.lat, lng: c.lng };
  const g = geocode(c.incidentLocation);
  if (!g || g.offWorld) return null;
  return { lat: g.lat, lng: g.lng };
}

const EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Nearby = { case: Case; km: number; daysDelta: number };
function findNearby(focus: Case, all: Case[], maxKm = 500, maxYears = 5): Nearby[] {
  const fp = getLatLng(focus);
  if (!fp || !focus.incidentDate) return [];
  const focusMs = new Date(focus.incidentDate).getTime();
  const maxDays = maxYears * 365.25;
  const out: Nearby[] = [];
  for (const c of all) {
    if (c.id === focus.id) continue;
    if (c.dataset === focus.dataset) continue; // CROSS-dataset only
    if (!c.incidentDate) continue;
    const p = getLatLng(c);
    if (!p) continue;
    const km = haversineKm(fp, p);
    if (km > maxKm) continue;
    const days = Math.round((new Date(c.incidentDate).getTime() - focusMs) / 86_400_000);
    if (Math.abs(days) > maxDays) continue;
    out.push({ case: c, km, daysDelta: days });
  }
  return out;
}

// ---------------------------------------------------------------
// Group cases by location key (same logic as MapView)
// ---------------------------------------------------------------
function groupKey(c: Case): string | null {
  if (typeof c.lat === "number" && typeof c.lng === "number") {
    const rlat = Math.round(c.lat * 2) / 2;
    const rlng = Math.round(c.lng * 2) / 2;
    return `geo:${rlat.toFixed(1)},${rlng.toFixed(1)}`;
  }
  if (c.incidentLocation && c.incidentLocation.trim() !== "N/A") {
    const g = geocode(c.incidentLocation);
    if (!g || g.offWorld) return null;
    return `str:${c.incidentLocation.trim()}`;
  }
  return null;
}

function displayForKey(key: string, sampleCase: Case): string {
  if (key.startsWith("str:")) {
    const loc = key.slice(4);
    return geocode(loc)?.display || loc;
  }
  return sampleCase.incidentLocation || key;
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function loadAll(): Promise<Case[]> {
  const files = ["data/cases.json", "data/nuclear-tests.json", "data/nuclear-incidents.json"];
  const all: Case[] = [];
  for (const f of files) {
    const raw = await readFile(resolve(ROOT, f), "utf8");
    const arr: Case[] = JSON.parse(raw);
    // Tag dataset — App.tsx does this on load
    const dsId = f.includes("cases") ? "uap" : f.includes("nuclear-tests") ? "nuclear-test" : "nuclear-incident";
    for (const c of arr) c.dataset = c.dataset || dsId;
    all.push(...arr);
  }
  return all;
}

async function main() {
  const all = await loadAll();
  console.log(`Loaded ${all.length} cases across ${new Set(all.map((c) => c.dataset)).size} datasets`);

  // Group by location key
  const byKey = new Map<string, Case[]>();
  for (const c of all) {
    const k = groupKey(c);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(c);
  }

  console.log(`${byKey.size} unique location groups`);

  // For each group, compute the current hotspot score (max cross-dataset count
  // across any case at this location).
  type HotspotData = {
    key: string;
    display: string;
    localCount: number;
    localDatasets: Set<string>;
    crossScore: number;
    nearby: Nearby[];
    byDataset: Map<string, number>;
    avgKm: number;
    avgYears: number;
  };

  const hotspots: HotspotData[] = [];
  for (const [key, cases] of byKey.entries()) {
    let maxScore = 0;
    let bestNearby: Nearby[] = [];
    for (const c of cases) {
      const nb = findNearby(c, all, 500, 5);
      if (nb.length > maxScore) {
        maxScore = nb.length;
        bestNearby = nb;
      }
    }
    if (maxScore === 0) continue;
    const localDatasets = new Set(cases.map((c) => c.dataset));
    const byDataset = new Map<string, number>();
    for (const n of bestNearby) byDataset.set(n.case.dataset, (byDataset.get(n.case.dataset) || 0) + 1);
    const avgKm = bestNearby.reduce((s, n) => s + n.km, 0) / bestNearby.length;
    const avgYears = bestNearby.reduce((s, n) => s + Math.abs(n.daysDelta) / 365.25, 0) / bestNearby.length;
    hotspots.push({
      key,
      display: displayForKey(key, cases[0]),
      localCount: cases.length,
      localDatasets,
      crossScore: maxScore,
      nearby: bestNearby,
      byDataset,
      avgKm,
      avgYears,
    });
  }

  // Sort by current scoring (just cross-dataset count) and show top 20
  hotspots.sort((a, b) => b.crossScore - a.crossScore);

  console.log(`\n${"=".repeat(80)}`);
  console.log("CURRENT ALGORITHM — top 20 by raw cross-dataset count");
  console.log("=".repeat(80));

  for (const h of hotspots.slice(0, 20)) {
    const localDs = [...h.localDatasets].join("+");
    const nearbyDs = [...h.byDataset.entries()]
      .map(([d, n]) => `${d}:${n}`)
      .join(", ");
    console.log(
      `\n${h.display.padEnd(40)}  score=${h.crossScore}  local=${h.localCount}[${localDs}]`,
    );
    console.log(`  Cross-dataset nearby: ${nearbyDs}`);
    console.log(`  Avg distance: ${h.avgKm.toFixed(0)} km · Avg time gap: ${h.avgYears.toFixed(1)} y`);
    // Show top 3 most-significant nearby cases (closest in space+time)
    const top3 = [...h.nearby]
      .sort((a, b) => a.km / 500 + Math.abs(a.daysDelta) / 1826 - (b.km / 500 + Math.abs(b.daysDelta) / 1826))
      .slice(0, 3);
    for (const n of top3) {
      const sign = n.daysDelta < 0 ? "before" : "after";
      const yrs = Math.abs(n.daysDelta) / 365.25;
      console.log(
        `    • ${n.case.incidentDate} · ${n.case.dataset.padEnd(17)} · ${Math.round(n.km)} km · ${yrs.toFixed(1)}y ${sign} · ${n.case.title.slice(0, 60)}`,
      );
    }
  }

  console.log(`\n\n${"=".repeat(80)}`);
  console.log("ALTERNATIVE SCORING — by NARRATIVE STRENGTH");
  console.log("=".repeat(80));
  console.log("Score = (cross-dataset count) × (dataset diversity) × (avg proximity bonus)");
  console.log("Idea: reward locations where small numbers of CLOSE cases from MULTIPLE datasets overlap");

  // Alternative scoring: emphasize dataset diversity + close proximity over raw count.
  const alt = hotspots.map((h) => {
    // Dataset diversity = how many DISTINCT datasets are in scope (local + nearby)
    const datasetsInPlay = new Set<string>(h.localDatasets);
    for (const ds of h.byDataset.keys()) datasetsInPlay.add(ds);
    const diversity = datasetsInPlay.size; // 1 to 4
    // Proximity bonus = 1 + (closer = more reward). Avg km of 100 → 5x, 500 → 1x
    const proxBonus = 1 + (500 - h.avgKm) / 100;
    // Time bonus = closer in time → more reward
    const timeBonus = 1 + (5 - h.avgYears) / 2;
    // Combined narrative score
    const narrative = h.crossScore * diversity * proxBonus * timeBonus;
    return { ...h, diversity, narrative };
  });
  alt.sort((a, b) => b.narrative - a.narrative);

  for (const h of alt.slice(0, 15)) {
    const localDs = [...h.localDatasets].join("+");
    const nearbyDs = [...h.byDataset.entries()].map(([d, n]) => `${d}:${n}`).join(", ");
    console.log(
      `\n${h.display.padEnd(40)}  narrative=${h.narrative.toFixed(1)}  diversity=${h.diversity}  cross=${h.crossScore}`,
    );
    console.log(`  Local: ${h.localCount} cases [${localDs}]`);
    console.log(`  Nearby cross-dataset: ${nearbyDs}`);
    console.log(`  Avg distance: ${h.avgKm.toFixed(0)} km · Avg time gap: ${h.avgYears.toFixed(1)} y`);
    const top3 = [...h.nearby]
      .sort((a, b) => a.km / 500 + Math.abs(a.daysDelta) / 1826 - (b.km / 500 + Math.abs(b.daysDelta) / 1826))
      .slice(0, 3);
    for (const n of top3) {
      const sign = n.daysDelta < 0 ? "before" : "after";
      const yrs = Math.abs(n.daysDelta) / 365.25;
      console.log(
        `    • ${n.case.incidentDate} · ${n.case.dataset.padEnd(17)} · ${Math.round(n.km)} km · ${yrs.toFixed(1)}y ${sign} · ${n.case.title.slice(0, 60)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
