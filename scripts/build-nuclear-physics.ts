// Builds data/nuclear-physics.json from data/raw/nuclear-physics-raw.json
// (extracted from nuclear_physics_milestones-6.xlsx). A geographic timeline of
// nuclear/particle-physics milestones, 1896–present: discoveries, inventions,
// and milestones, each placed at the city where it happened.
//
// Provenance: hand-curated "Nuclear Physics Milestones" — landmark events in
// the history of nuclear and particle physics with key figures and locations.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RAW = resolve(import.meta.dirname, "..", "data", "raw", "nuclear-physics-raw.json");
const OUT = resolve(import.meta.dirname, "..", "data", "nuclear-physics.json");

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

// City keyword → centroid + country. The source location strings contain a
// recognizable place keyword (often with a lab in parentheses); we match the
// first keyword that appears.
const CITY: Array<{ key: string; lat: number; lng: number; country: string }> = [
  { key: "Alamogordo", lat: 32.9, lng: -105.96, country: "United States" },
  { key: "Batavia", lat: 41.84, lng: -88.31, country: "United States" },
  { key: "Berkeley", lat: 37.87, lng: -122.27, country: "United States" },
  { key: "Brookhaven", lat: 40.87, lng: -72.88, country: "United States" },
  { key: "Chicago", lat: 41.79, lng: -87.6, country: "United States" },
  { key: "Idaho", lat: 43.52, lng: -113.0, country: "United States" },
  { key: "Livermore", lat: 37.69, lng: -121.71, country: "United States" },
  { key: "Pasadena", lat: 34.14, lng: -118.13, country: "United States" },
  { key: "Princeton", lat: 40.35, lng: -74.65, country: "United States" },
  { key: "Savannah River", lat: 33.35, lng: -81.65, country: "United States" },
  { key: "Stanford", lat: 37.42, lng: -122.2, country: "United States" },
  { key: "Geneva", lat: 46.23, lng: 6.05, country: "Switzerland" }, // CERN
  { key: "Bern", lat: 46.95, lng: 7.45, country: "Switzerland" },
  { key: "Zurich", lat: 47.37, lng: 8.54, country: "Switzerland" },
  { key: "Paris", lat: 48.85, lng: 2.35, country: "France" },
  { key: "Saint-Paul", lat: 43.7, lng: 5.76, country: "France" }, // ITER, Cadarache
  { key: "Berlin", lat: 52.52, lng: 13.4, country: "Germany" },
  { key: "Copenhagen", lat: 55.68, lng: 12.57, country: "Denmark" },
  { key: "Cambridge", lat: 52.2, lng: 0.12, country: "United Kingdom" },
  { key: "Manchester", lat: 53.48, lng: -2.24, country: "United Kingdom" },
  { key: "Bristol", lat: 51.45, lng: -2.59, country: "United Kingdom" },
  { key: "Culham", lat: 51.66, lng: -1.23, country: "United Kingdom" },
  { key: "Calder Hall", lat: 54.42, lng: -3.5, country: "United Kingdom" },
  { key: "Montreal", lat: 45.5, lng: -73.58, country: "Canada" },
  { key: "Sudbury", lat: 46.47, lng: -81.19, country: "Canada" },
  { key: "Moscow", lat: 55.8, lng: 37.47, country: "Russia" },
  { key: "Obninsk", lat: 55.1, lng: 36.61, country: "Russia" },
  { key: "Dubna", lat: 56.74, lng: 37.17, country: "Russia" },
  { key: "Kamioka", lat: 36.43, lng: 137.31, country: "Japan" },
  { key: "Osaka", lat: 34.69, lng: 135.5, country: "Japan" },
  { key: "Enewetak", lat: 11.5, lng: 162.33, country: "Marshall Islands" },
];

const s = (v: unknown) => (v == null ? "" : String(v).trim());
function geocode(loc: string): { lat: number; lng: number; country: string } | null {
  for (const c of CITY) if (loc.includes(c.key)) return { lat: c.lat, lng: c.lng, country: c.country };
  return null;
}

// Each milestone → its canonical English Wikipedia article (the project's
// citation convention). Keyed by the source Event string. All titles were
// validated against the MediaWiki API: every one resolves to a live article
// (no redirects, no missing pages).
const WIKI_TITLE: Record<string, string> = {
  "Discovery of radioactivity": "Henri Becquerel",
  "Discovery of polonium and radium": "Radium",
  "Identification of alpha and beta rays": "Alpha particle",
  "Discovery of gamma rays": "Paul Ulrich Villard",
  "Mass-energy equivalence (E=mc2)": "Mass–energy equivalence",
  "Discovery of the atomic nucleus": "Rutherford scattering experiments",
  "Bohr model of the atom": "Bohr model",
  "First artificial nuclear transmutation": "Nuclear transmutation",
  "Dirac equation predicts antimatter": "Dirac equation",
  "Invention of the Van de Graaff generator": "Van de Graaff generator",
  "Postulation of the neutrino": "Neutrino",
  "Discovery of the neutron": "Discovery of the neutron",
  "Cockcroft-Walton accelerator splits the atom": "Cockcroft–Walton generator",
  "Invention of the cyclotron": "Cyclotron",
  "Discovery of the positron": "Positron",
  "Discovery of artificial (induced) radioactivity": "Induced radioactivity",
  "Yukawa predicts the meson": "Hideki Yukawa",
  "Discovery of the muon": "Muon",
  "Discovery of nuclear fission": "Discovery of nuclear fission",
  "Synthesis of neptunium (first transuranium element)": "Neptunium",
  "Synthesis and identification of plutonium": "Plutonium",
  "Chicago Pile-1: first nuclear reactor": "Chicago Pile-1",
  "First nuclear weapon detonation (Trinity)": "Trinity (nuclear test)",
  "Discovery of the pion": "Pion",
  "Experimental Breeder Reactor I (EBR-I)": "Experimental Breeder Reactor I",
  "First stellarator fusion concept": "Stellarator",
  "First hydrogen (thermonuclear) bomb (Ivy Mike)": "Ivy Mike",
  "Invention of the tokamak": "Tokamak",
  "Obninsk: first grid-connected nuclear power plant": "Obninsk Nuclear Power Plant",
  "Discovery of the antiproton": "Antiproton",
  "Calder Hall: first commercial-scale nuclear power station": "Calder Hall nuclear power station",
  "Experimental detection of the neutrino": "Cowan–Reines neutrino experiment",
  "Quark model proposed": "Quark model",
  "Discovery of CP violation": "CP violation",
  "Discovery of quarks (deep inelastic scattering)": "Deep inelastic scattering",
  "Tokamak T-3 achieves breakthrough plasma temperatures": "Tokamak",
  "Discovery of W and Z bosons": "W and Z bosons",
  "Joint European Torus (JET) begins operation": "Joint European Torus",
  "Tevatron reaches full operation": "Tevatron",
  "First controlled fusion energy release (JET)": "Joint European Torus",
  "First creation of antihydrogen": "Antihydrogen",
  "Discovery of the top quark": "Top quark",
  "Discovery of neutrino oscillation (atmospheric)": "Neutrino oscillation",
  "Confirmation of solar neutrino oscillation": "Sudbury Neutrino Observatory",
  "Synthesis of oganesson (element 118)": "Oganesson",
  "Large Hadron Collider (LHC) commissioned": "Large Hadron Collider",
  "First trapping of antihydrogen atoms": "ALPHA experiment",
  "Antihydrogen confined for ~1000 seconds": "ALPHA experiment",
  "Discovery of the Higgs boson": "Higgs boson",
  "Discovery of pentaquarks": "Pentaquark",
  "ITER assembly begins": "ITER",
  "Discovery of a fully-charm tetraquark X(6900)": "Tetraquark",
  "First laser cooling of antihydrogen": "Antihydrogen",
  "Fusion ignition (net energy gain) at NIF": "National Ignition Facility",
  "New pentaquark and first tetraquark pair observed": "Tetraquark",
  "First measurement of gravity's effect on antimatter": "Gravitational interaction of antimatter",
  "First observation of CP violation in baryons": "CP violation",
};
function wikiUrl(event: string): string {
  const t = WIKI_TITLE[event];
  return t ? `https://en.wikipedia.org/wiki/${t.replace(/ /g, "_")}` : "";
}

async function main() {
  const rows = JSON.parse(await readFile(RAW, "utf8")) as Record<string, unknown>[];
  const cases: Case[] = [];
  let unmatched = 0;

  for (const r of rows) {
    const event = s(r["Event"]);
    const yearNum = parseInt(s(r["Year"]), 10);
    if (!event || !Number.isFinite(yearNum)) continue;
    const loc = s(r["Location"]);
    const geo = geocode(loc);
    if (!geo) unmatched++;
    const figures = s(r["Key Figure(s)"]);
    const kind = s(r["Type"]) || "Milestone";
    const description = [s(r["Significance"]), figures ? `Key figure(s): ${figures}.` : ""].filter(Boolean).join(" ");
    cases.push({
      dataset: "nuclear-physics",
      lat: geo?.lat,
      lng: geo?.lng,
      id: `np-${yearNum}-${cases.length + 1}`,
      title: event,
      // Group by kind (Discovery/Invention/Milestone), not country — the map
      // already conveys geography, so per-country agency chips just clutter.
      agency: kind,
      incidentDate: `${yearNum}-01-01`,
      incidentDateRaw: String(yearNum),
      incidentLocation: loc,
      releaseDate: "",
      type: "PDF",
      subtype: `${kind}${figures ? ` · ${figures}` : ""}`,
      redacted: false,
      description,
      sourceUrl: wikiUrl(event),
      videoTitle: "",
      dvidsVideoId: "",
      imageUrl: "",
      imageAlt: "",
    });
  }

  const withGeo = cases.filter((c) => c.lat !== undefined).length;
  console.log(`[build] nuclear-physics: ${cases.length} milestones (${withGeo} geolocated). ${unmatched} unmatched locations.`);
  await writeFile(OUT, JSON.stringify(cases, null, 2));
  console.log(`[build] wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
