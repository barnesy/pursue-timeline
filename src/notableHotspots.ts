// Hand-curated cross-dataset co-occurrences worth surfacing in the Hotspots
// panel. Replaces algorithmic top-N ranking, which was misleading on this
// dataset (the PURSUE files skew heavily toward 2017-2025, when US nuclear
// testing had already ended — so few era-matched UAP↔nuclear pairings exist).
//
// Each entry tells a SPECIFIC story the released data actually contains.
// The matcher function identifies seed cases; the focus filter then expands
// to include cross-dataset neighbors within proximity.

import type { Case } from "./types";

export type NotableHotspot = {
  id: string;
  title: string;
  /** Short tagline shown under the title — what makes this notable. */
  subtitle: string;
  /** 1-2 sentence narrative shown when expanded. */
  narrative: string;
  /** Predicate identifying seed cases. The filter expands to seeds +
   *  cross-dataset neighbors within 500 km / ±5y. */
  matches: (c: Case) => boolean;
  /** Map center for the fly-to. */
  center: { lat: number; lng: number };
  /** Suggested zoom level when flying. */
  zoom?: number;
};

export const NOTABLE_HOTSPOTS: NotableHotspot[] = [
  {
    id: "trinity-sandia",
    title: "Trinity → Sandia",
    subtitle: "UAP ↔ Nuclear Test · 222 km · 2.5 years apart",
    narrative:
      "The cleanest era-matched UAP↔nuclear pairing in the released PURSUE files: 209 documented sightings of \"green orbs, discs and fireballs\" at Sandia Base 1948–50, two and a half years after Trinity — the first atomic detonation — went off 222 km south.",
    matches: (c) =>
      c.id === "nt-45001" || // TRINITY
      /UAP Reported at Sandia Base/i.test(c.title),
    center: { lat: 34.5, lng: -106.0 },
    zoom: 6,
  },
  {
    id: "new-mexico-triangle",
    title: "The New Mexico triangle",
    subtitle: "3 datasets converge · 1945–1980",
    narrative:
      "Within 200 km of each other in New Mexico: Trinity (first nuclear test, 1945), the Sandia Base UAP series (1948–50), the Mk-17 hydrogen-bomb drop near Albuquerque (1957), and the underground PNE tests at Carlsbad (1961). The geographic cradle of the US nuclear program and three of its strangest declassified files.",
    matches: (c) => {
      const loc = (c.incidentLocation || "").toLowerCase();
      // UAP in New Mexico
      if (c.dataset === "uap" && /new mexico/i.test(loc)) return true;
      // Nuclear tests near NM (lat 32-37, lng -107 to -103)
      if (
        c.dataset === "nuclear-test" &&
        typeof c.lat === "number" &&
        typeof c.lng === "number" &&
        c.lat >= 32 &&
        c.lat <= 37 &&
        c.lng >= -107 &&
        c.lng <= -103
      )
        return true;
      // Nuclear incidents in NM (Albuquerque, Kirtland)
      if (c.dataset === "nuclear-incident" && /new mexico|albuquerque|kirtland/i.test(loc))
        return true;
      return false;
    },
    center: { lat: 34.0, lng: -106.0 },
    zoom: 5,
  },
  {
    id: "nevada-corridor",
    title: "Nevada test-and-accident corridor",
    subtitle: "Nuclear Tests ↔ Nuclear Incidents · 1951–1980",
    narrative:
      "The Nevada Test Site hosted 928 nuclear detonations between 1951 and 1992. The Broken Arrow accidents weren't far away — the 1961 Yuba City B-52 crash (a bomber carrying two nuclear weapons), the 1980 Damascus Titan-II silo explosion. Test infrastructure and weapon-handling failures lived next to each other.",
    matches: (c) => {
      if (c.id === "ni-broken-arrow-yuba-1961") return true;
      if (c.id === "ni-broken-arrow-damascus-1980") return true;
      // US nuclear tests in Nevada area
      if (
        c.dataset === "nuclear-test" &&
        c.agency === "United States" &&
        typeof c.lat === "number" &&
        typeof c.lng === "number" &&
        c.lat >= 36 &&
        c.lat <= 39 &&
        c.lng >= -118 &&
        c.lng <= -114
      )
        return true;
      return false;
    },
    center: { lat: 37.5, lng: -116.0 },
    zoom: 6,
  },
  {
    id: "soviet-northern-fleet",
    title: "The Soviet submarine graveyard",
    subtitle: "Nuclear Incidents at sea · 1961–1989",
    narrative:
      "Four nuclear-armed Soviet submarines lost or crippled in the North Atlantic and Norwegian Sea: K-19 (1961), K-129 (1968), K-219 (1986), and K-278 Komsomolets (1989). Combined with the Novaya Zemlya test ranges to the north, this is the hidden ocean theatre of Cold-War nuclear deterrence.",
    matches: (c) => {
      const subIds = ["ni-k19-1961", "ni-k129-1968", "ni-k219-1986", "ni-k278-1989"];
      if (subIds.includes(c.id)) return true;
      // Soviet tests in the high Arctic (Novaya Zemlya is ~73-75°N, 53-58°E)
      if (
        c.dataset === "nuclear-test" &&
        c.agency === "Soviet Union" &&
        typeof c.lat === "number" &&
        c.lat >= 70
      )
        return true;
      return false;
    },
    center: { lat: 70.0, lng: 30.0 },
    zoom: 4,
  },
];

/** Find the seed cases for a notable hotspot in a given case list. */
export function getSeedCases(hotspot: NotableHotspot, cases: Case[]): Case[] {
  return cases.filter(hotspot.matches);
}
