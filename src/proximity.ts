// Cross-dataset proximity detection. Given a focus case, finds events from
// OTHER datasets within (km, years) thresholds — exposes the latent
// correlations the multi-dataset viz is supposed to surface (e.g. UAP cases
// near nuclear test sites; nuclear incidents near earlier weapons tests).
//
// Algorithm is O(n) per query (linear scan). At ~2.3K events this runs in
// single-digit ms; no spatial index needed.

import type { Case } from "./types";
import { geocode } from "./locations";

export type LatLng = { lat: number; lng: number };

export type Nearby = {
  case: Case;
  km: number;
  daysDelta: number; // signed: negative = before focus, positive = after
};

// Resolve a case's geographic point. Falls back to the string-based geocoder
// when the case doesn't carry a direct lat/lng. Returns null for ungeocodable
// or off-world cases.
export function getLatLng(c: Case): LatLng | null {
  if (typeof c.lat === "number" && typeof c.lng === "number") {
    return { lat: c.lat, lng: c.lng };
  }
  const g = geocode(c.incidentLocation);
  if (!g || g.offWorld) return null;
  return { lat: g.lat, lng: g.lng };
}

// Great-circle distance in km via the haversine formula.
const EARTH_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const MS_PER_DAY = 86_400_000;

export type ProximityOpts = {
  maxKm?: number;       // default 500
  maxYears?: number;    // default 5
  limit?: number;       // default 20
  crossDatasetOnly?: boolean; // default true
};

export function findNearby(focus: Case, all: Case[], opts: ProximityOpts = {}): Nearby[] {
  const maxKm = opts.maxKm ?? 500;
  const maxYears = opts.maxYears ?? 5;
  const limit = opts.limit ?? 20;
  const crossOnly = opts.crossDatasetOnly ?? true;
  const maxDays = maxYears * 365.25;

  const fp = getLatLng(focus);
  if (!fp) return [];
  if (!focus.incidentDate) return [];
  const focusMs = new Date(focus.incidentDate).getTime();

  const results: Nearby[] = [];
  for (const c of all) {
    if (c.id === focus.id) continue;
    if (crossOnly && c.dataset === focus.dataset) continue;
    if (!c.incidentDate) continue;
    const p = getLatLng(c);
    if (!p) continue;
    const km = haversineKm(fp, p);
    if (km > maxKm) continue;
    const daysDelta = Math.round((new Date(c.incidentDate).getTime() - focusMs) / MS_PER_DAY);
    if (Math.abs(daysDelta) > maxDays) continue;
    results.push({ case: c, km, daysDelta });
  }

  // Score by combined normalized distance + time, surface closest first.
  results.sort((a, b) => {
    const aScore = a.km / maxKm + Math.abs(a.daysDelta) / maxDays;
    const bScore = b.km / maxKm + Math.abs(b.daysDelta) / maxDays;
    return aScore - bScore;
  });

  return results.slice(0, limit);
}

export function formatDaysDelta(days: number): string {
  if (days === 0) return "same day";
  const abs = Math.abs(days);
  const sign = days < 0 ? "before" : "after";
  if (abs < 30) return `${abs}d ${sign}`;
  if (abs < 365) return `${Math.round(abs / 30)}mo ${sign}`;
  const yrs = abs / 365.25;
  return `${yrs.toFixed(yrs >= 10 ? 0 : 1)}y ${sign}`;
}

// Number of cross-dataset events within the proximity envelope of `focus`.
// Cheap wrapper around findNearby used for map cluster highlighting; uses a
// high `limit` so the count isn't truncated.
export function clusterScore(focus: Case, all: Case[], opts: ProximityOpts = {}): number {
  return findNearby(focus, all, { ...opts, limit: 10_000 }).length;
}

// Per-dataset breakdown of cross-dataset events near a focus case. Useful
// for the Hotspots sidebar: "1 UAP + 12 Nuclear Tests + 0 Stargate".
export function clusterBreakdown(
  focus: Case,
  all: Case[],
  opts: ProximityOpts = {},
): Map<string, number> {
  const nearby = findNearby(focus, all, { ...opts, limit: 10_000 });
  const byDataset = new Map<string, number>();
  for (const n of nearby) {
    byDataset.set(n.case.dataset, (byDataset.get(n.case.dataset) || 0) + 1);
  }
  return byDataset;
}

export function formatKm(km: number): string {
  if (km < 1) return "<1 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  if (km < 1000) return `${Math.round(km)} km`;
  return `${(km / 1000).toFixed(1)}k km`;
}
