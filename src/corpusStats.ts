// Loads the build-time corpus analytics (public/corpus-stats.json) and exposes
// typed lookups for the discovery features: TF-IDF similar docs, scored
// cross-document links, and Monte Carlo p-values. Fetched once and shared via a
// tiny async store; absent file → graceful empty (features just don't show).

export type SimilarDoc = { id: string; score: number; cross: boolean };
export type CorpusLink = {
  a: string; b: string; score: number;
  sharedPeople: string[]; sharedPlaces: string[];
  km: number | null; days: number | null; sim: number;
};
export type UapPval = { nearestTestDays: number; p: number };

export type CorpusStats = {
  generatedFrom: number;
  similar: Record<string, SimilarDoc[]>;
  links: CorpusLink[];
  uapPval: Record<string, UapPval>;
};

const EMPTY: CorpusStats = { generatedFrom: 0, similar: {}, links: [], uapPval: {} };

let cache: CorpusStats | null = null;
let inflight: Promise<CorpusStats> | null = null;

export function loadCorpusStats(baseUrl: string): Promise<CorpusStats> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch(`${baseUrl}corpus-stats.json`)
    .then((r) => (r.ok ? r.json() : EMPTY))
    .then((j: CorpusStats) => {
      cache = { ...EMPTY, ...j };
      return cache;
    })
    .catch(() => {
      cache = EMPTY;
      return cache;
    });
  return inflight;
}

/** Significance label for a Monte Carlo p-value (lower = more surprising). */
export function significanceLabel(p: number): { label: string; color: string; tier: "high" | "notable" | "expected" } {
  if (p < 0.01) return { label: "Highly significant", color: "#e8413a", tier: "high" };
  if (p < 0.05) return { label: "Significant", color: "#f0a13a", tier: "notable" };
  if (p < 0.2) return { label: "Weak", color: "#c9b03a", tier: "notable" };
  return { label: "Coincidental", color: "#7a8595", tier: "expected" };
}
