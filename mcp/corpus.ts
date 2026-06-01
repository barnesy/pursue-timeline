// MCP corpus loader — reads the same shipped static JSON the web app ships
// (public/*.json + corpus-stats.json + stargate-people.json) from local disk
// and reuses the EXACT same pure src/ analytics (explainPair, buildHypothesis,
// findNearby, buildEntityIndex, figuresIn, placesFor). Zero recompute beyond
// those pure calls, zero network — everything runs on the user's machine, so
// hosting cost is structurally zero. This keeps the MCP server's findings
// identical to what the UI shows: no second source of truth.

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";
import type { Case } from "../src/types.js";
import { getLatLng, findNearby } from "../src/proximity.js";
import { explainPair } from "../src/evidence.js";
import { buildHypothesis } from "../src/hypothesis.js";
import { buildEntityIndex, type EntityIndex } from "../src/entities.js";
import { canonPerson, figuresIn } from "../src/figures.js";
import { placesFor } from "../src/places.js";
import { significanceLabel, type CorpusStats } from "../src/corpusStats.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// public/ relative to this file (mcp/ sits beside it after build). Resolve from
// the repo root so it works whether run from src or the built dist.
const PUB = resolve(HERE, "..", "public");

const SOURCES: { id: Case["dataset"]; file: string }[] = [
  { id: "uap", file: "cases.json" },
  { id: "uap-catalog", file: "uap-catalog.json" },
  { id: "nuclear-test", file: "nuclear-tests.json" },
  { id: "nuclear-incident", file: "nuclear-incidents.json" },
  { id: "nuclear-physics", file: "nuclear-physics.json" },
  { id: "stargate", file: "stargate.json" },
  { id: "publication", file: "publications.json" },
];

export type Corpus = {
  cases: Case[];
  byId: Map<string, Case>;
  stats: CorpusStats | null;
  entityIndex: EntityIndex;
  search: MiniSearch;
};

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(resolve(PUB, file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function loadCorpus(): Promise<Corpus> {
  const people = await readJson<Record<string, string[]>>("stargate-people.json", {});
  const cases: Case[] = [];
  for (const src of SOURCES) {
    const raw = await readJson<Case[]>(src.file, []);
    for (const c0 of raw) {
      let c: Case =
        src.id !== "uap"
          ? { ...c0, dataset: src.id, subtype: c0.subtype ?? c0.type, type: "PDF" }
          : { ...c0, dataset: src.id };
      if (c.dataset === "stargate" && people[c.id]) c = { ...c, people: people[c.id] };
      if (typeof c.lat !== "number") {
        const ll = getLatLng(c);
        if (ll) c = { ...c, lat: ll.lat, lng: ll.lng, approxGeo: true };
      }
      cases.push(c);
    }
  }

  const stats = await readJson<CorpusStats | null>("corpus-stats.json", null);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const entityIndex = buildEntityIndex(cases);

  // In-process MiniSearch over title + entities + abstract (mirrors the
  // build-time index fields, so ranking matches the app).
  const search = new MiniSearch<{ id: string; title: string; entities: string; abstract: string; agency: string }>({
    fields: ["title", "entities", "abstract", "agency"],
    storeFields: [],
    searchOptions: { boost: { title: 3, entities: 2.5, abstract: 1 }, prefix: true, fuzzy: 0.2 },
  });
  search.addAll(
    cases.map((c) => {
      const ent = new Set<string>();
      if (c.dataset === "stargate") for (const p of c.people || []) ent.add(canonPerson(p));
      if (c.dataset === "publication" && c.author)
        for (const a of c.author.split(/\s*[&,/]\s*/)) { const n = canonPerson(a.trim()); if (n.length > 2) ent.add(n); }
      for (const f of figuresIn(`${c.title || ""} ${c.description || ""}`)) ent.add(f);
      for (const p of placesFor(c)) ent.add(p.name);
      if (c.incidentLocation) ent.add(c.incidentLocation);
      return { id: c.id, title: c.title || "", entities: [...ent].join(" · "), abstract: (c.description || "").slice(0, 280), agency: c.agency || "" };
    }),
  );

  return { cases, byId, stats, entityIndex, search };
}

// ── shared helpers the tools use ────────────────────────────────────────────

export const pvalOf = (corpus: Corpus, c: Case) => corpus.stats?.uapPval[c.id];

/** A pair connection, fully explained + judged — the unit every tool returns. */
export function judgePair(corpus: Corpus, a: Case, b: Case) {
  const pval = pvalOf(corpus, a) || pvalOf(corpus, b);
  const evidence = explainPair(a, b, pval);
  const hyp = buildHypothesis(a, b, evidence, pval);
  return { evidence, hyp, pval };
}

export { findNearby, significanceLabel };
