// Lazy-loaded MiniSearch over the build-time index (public/search-index.json,
// ~211KB gzipped). Fetched on first use only — the app works without it
// (substring fallback in App.tsx). Gives field-boosted, prefix, typo-tolerant
// ranking and powers the Investigation seed-picker autocomplete.

import MiniSearch from "minisearch";

let mini: MiniSearch | null = null;
let inflight: Promise<MiniSearch | null> | null = null;

const OPTS = {
  fields: ["title", "entities", "abstract", "agency", "year"],
  storeFields: [] as string[],
};

export function loadSearch(baseUrl: string): Promise<MiniSearch | null> {
  if (mini) return Promise.resolve(mini);
  if (inflight) return inflight;
  inflight = fetch(`${baseUrl}search-index.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      if (!json) return null;
      mini = MiniSearch.loadJS(json, OPTS);
      return mini;
    })
    .catch(() => null);
  return inflight;
}

export function searchReady(): MiniSearch | null {
  return mini;
}

/** Ranked id list for a query (best-first). Empty if index not loaded. */
export function rankedIds(query: string): string[] {
  if (!mini || !query.trim()) return [];
  return mini
    .search(query, { boost: { title: 3, entities: 2.5, abstract: 1 }, prefix: true, fuzzy: 0.2 })
    .map((r) => r.id as string);
}

/** Autocomplete suggestions (titles/entities) for the seed picker. */
export function suggest(query: string, limit = 8): { id: string; score: number }[] {
  if (!mini || !query.trim()) return [];
  return mini
    .search(query, { boost: { title: 3, entities: 2.5 }, prefix: true, fuzzy: 0.2 })
    .slice(0, limit)
    .map((r) => ({ id: r.id as string, score: r.score }));
}
