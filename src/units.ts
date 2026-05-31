// Unit system (metric ↔ imperial), persisted and shared app-wide via an
// external store (useSyncExternalStore) — mirrors collection.ts. The navbar
// toggle drives every measurement in the app (blast-ring radii, cross-dataset
// distances, altitudes) without prop drilling, so the user's choice is global
// and sticky across sessions.

import { useSyncExternalStore } from "react";
import type { UnitSystem } from "./blastPhysics";

const KEY = "offnominal.units.v1";
// The setting used to live on the blast diagram alone under this key; migrate
// it so a returning user keeps their previous choice.
const LEGACY_KEY = "blast-units";

function load(): UnitSystem {
  if (typeof localStorage === "undefined") return "metric";
  const v = (localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY)) as
    | UnitSystem
    | null;
  return v === "imperial" || v === "metric" ? v : "metric";
}

let current: UnitSystem = load();
const subs = new Set<() => void>();

export const unitsStore = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  // Stable reference between mutations — required by useSyncExternalStore.
  snapshot(): UnitSystem {
    return current;
  },
  set(u: UnitSystem) {
    if (u === current) return;
    current = u;
    try {
      localStorage.setItem(KEY, u);
    } catch {
      /* ignore quota / private mode */
    }
    subs.forEach((f) => f());
  },
};

export function useUnits(): UnitSystem {
  return useSyncExternalStore(unitsStore.subscribe, unitsStore.snapshot, unitsStore.snapshot);
}
