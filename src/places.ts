// Curated place gazetteer — the "places" layer of the entity network. Per the
// curated-not-NER principle, ~30 significant locations (test sites, labs,
// incident sites, UAP hotspots) with a center, a match radius, and string
// aliases. A geo-bearing record is assigned to a place when it falls inside the
// radius OR its location text contains an alias. Clean place NAMES (not raw
// coords) make the network legible and connect records across datasets — e.g.
// "Nevada Test Site" ties 900+ tests together; "New Mexico" links Trinity,
// the Sandia UAP series, and Los Alamos physics.

import type { Case } from "./types";
import { haversineKm } from "./proximity";

export type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  aliases?: string[];
};

export const PLACES: Place[] = [
  // ── Nuclear test sites ──────────────────────────────────────────────
  { id: "nevada-test-site", name: "Nevada Test Site", lat: 37.1, lng: -116.05, radiusKm: 200, aliases: ["NTS", "NEVADA TEST", "MERCURY NV"] },
  { id: "semipalatinsk", name: "Semipalatinsk (Kazakhstan)", lat: 50.0, lng: 78.5, radiusKm: 250, aliases: ["SEMI ", "SEMIPALAT", "KAZAKH"] },
  { id: "novaya-zemlya", name: "Novaya Zemlya", lat: 73.0, lng: 54.5, radiusKm: 450, aliases: ["NZ RUSS", "NOVAYA"] },
  { id: "mururoa-fangataufa", name: "Mururoa / Fangataufa", lat: -21.85, lng: -139.0, radiusKm: 220, aliases: ["MURUHOA", "MURUROA", "FANGAT"] },
  { id: "marshall-islands", name: "Marshall Islands (Bikini/Enewetak)", lat: 11.5, lng: 163.9, radiusKm: 280, aliases: ["BIKINI", "ENEWETAK", "ENIWETOK"] },
  { id: "christmas-island", name: "Christmas Island (Kiritimati)", lat: 1.9, lng: -157.4, radiusKm: 160, aliases: ["CHRISTMAS IS", "KIRITIMATI"] },
  { id: "johnston-island", name: "Johnston Island", lat: 16.73, lng: -169.5, radiusKm: 150, aliases: ["JOHNSTON"] },
  { id: "lop-nor", name: "Lop Nor (China)", lat: 41.5, lng: 88.5, radiusKm: 220, aliases: ["LOP NOR", "LOP NUR"] },
  { id: "azgir-astrakhan", name: "Azgir / Astrakhan (Russia)", lat: 47.8, lng: 47.9, radiusKm: 220, aliases: ["AZGIR", "ASTRAK", "MTR RUSS"] },
  { id: "algeria-sahara", name: "Reggane / In Ecker (Algeria)", lat: 25.4, lng: 2.6, radiusKm: 400, aliases: ["IN ECKER", "REGGANE"] },
  { id: "maralinga", name: "Maralinga / Emu (Australia)", lat: -30.1, lng: 131.6, radiusKm: 250, aliases: ["MARALI", "MONTE BELLO", "EMU "] },
  { id: "pokhran", name: "Pokhran (India)", lat: 27.1, lng: 71.75, radiusKm: 110, aliases: ["POKHRAN"] },
  { id: "chagai", name: "Chagai (Pakistan)", lat: 28.8, lng: 64.9, radiusKm: 130, aliases: ["CHAGAI", "RAS KOH"] },
  { id: "punggye-ri", name: "Punggye-ri (North Korea)", lat: 41.28, lng: 129.1, radiusKm: 110, aliases: ["PUNGGYE", "DPRK"] },
  // ── New Mexico (cross-dataset hotspot) ──────────────────────────────
  { id: "trinity", name: "Trinity / White Sands", lat: 33.68, lng: -106.48, radiusKm: 70, aliases: ["ALAMOGORDO", "TRINITY", "WHITE SANDS"] },
  { id: "sandia-albuquerque", name: "Sandia / Albuquerque", lat: 35.05, lng: -106.5, radiusKm: 60, aliases: ["SANDIA", "ALBUQUERQUE", "KIRTLAND"] },
  { id: "los-alamos", name: "Los Alamos", lat: 35.88, lng: -106.3, radiusKm: 40, aliases: ["LOS ALAMOS", "LANL"] },
  { id: "roswell", name: "Roswell, NM", lat: 33.39, lng: -104.52, radiusKm: 60, aliases: ["ROSWELL"] },
  // ── Nuclear incidents ───────────────────────────────────────────────
  { id: "hiroshima", name: "Hiroshima", lat: 34.39, lng: 132.45, radiusKm: 30, aliases: ["HIROSHIMA"] },
  { id: "nagasaki", name: "Nagasaki", lat: 32.77, lng: 129.87, radiusKm: 30, aliases: ["NAGASAKI"] },
  { id: "chernobyl", name: "Chernobyl", lat: 51.39, lng: 30.1, radiusKm: 60, aliases: ["CHERNOBYL", "PRIPYAT"] },
  { id: "fukushima", name: "Fukushima", lat: 37.42, lng: 141.03, radiusKm: 60, aliases: ["FUKUSHIMA"] },
  { id: "three-mile-island", name: "Three Mile Island", lat: 40.15, lng: -76.72, radiusKm: 40, aliases: ["THREE MILE", "HARRISBURG"] },
  // ── Physics labs ────────────────────────────────────────────────────
  { id: "cern-geneva", name: "CERN / Geneva", lat: 46.23, lng: 6.05, radiusKm: 40, aliases: ["CERN", "GENEVA"] },
  { id: "berkeley", name: "Berkeley, CA", lat: 37.87, lng: -122.27, radiusKm: 30, aliases: ["BERKELEY"] },
  { id: "chicago", name: "Chicago", lat: 41.79, lng: -87.6, radiusKm: 40, aliases: ["CHICAGO"] },
  { id: "cambridge-uk", name: "Cambridge (Cavendish)", lat: 52.2, lng: 0.12, radiusKm: 30, aliases: ["CAMBRIDGE", "CAVENDISH"] },
  // ── Other ───────────────────────────────────────────────────────────
  { id: "washington-dc", name: "Washington, D.C.", lat: 38.9, lng: -77.03, radiusKm: 30, aliases: ["WASHINGTON", "CAPITOL", "CONGRESS", "PENTAGON"] },
];

/** Places a record belongs to (by coordinate radius or location-text alias). */
export function placesFor(c: Case): Place[] {
  const loc = (c.incidentLocation || "").toUpperCase();
  const out: Place[] = [];
  for (const p of PLACES) {
    const byGeo =
      typeof c.lat === "number" &&
      typeof c.lng === "number" &&
      haversineKm({ lat: c.lat, lng: c.lng }, { lat: p.lat, lng: p.lng }) <= p.radiusKm;
    const byAlias = !!p.aliases && p.aliases.some((a) => loc.includes(a));
    if (byGeo || byAlias) out.push(p);
  }
  return out;
}
