// "Cases" — a single user-curated working set of case ids, persisted to
// localStorage and shared app-wide via an external store (useSyncExternalStore),
// so any component (rows, drawer, header, overlay) can read/toggle it without
// prop drilling. Add a case from anywhere → the header counter ticks up → open
// the combined "Your Cases" view to see them together with their correlations.

import { useSyncExternalStore } from "react";

const KEY = "offnominal.cases.v1";

function load(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let ids: string[] = load();
const subs = new Set<() => void>();

function commit(next: string[]) {
  ids = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota / private mode */
  }
  subs.forEach((f) => f());
}

export const casesStore = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  // Stable reference between mutations — required by useSyncExternalStore.
  snapshot(): string[] {
    return ids;
  },
  has(id: string) {
    return ids.includes(id);
  },
  add(id: string) {
    if (!ids.includes(id)) commit([...ids, id]);
  },
  remove(id: string) {
    if (ids.includes(id)) commit(ids.filter((x) => x !== id));
  },
  toggle(id: string) {
    if (ids.includes(id)) this.remove(id);
    else this.add(id);
  },
  clear() {
    if (ids.length) commit([]);
  },
};

export function useCaseIds(): string[] {
  return useSyncExternalStore(casesStore.subscribe, casesStore.snapshot, casesStore.snapshot);
}

export function useInCases(id: string): boolean {
  return useCaseIds().includes(id);
}
