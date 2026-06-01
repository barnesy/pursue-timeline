// Build-time corpus analytics — the quantitative engine behind Off Nominal's
// correlation-discovery features. Computes, ships as public/corpus-stats.json:
//
//   1. TF-IDF semantic neighbors  — content-based "more like this" per doc (#13)
//   2. Unified cross-doc links    — strongest correlations corpus-wide, scored
//                                    on time + geo + shared-entity + semantics
//   3. Monte Carlo p-values       — how often a UAP↔nuclear pairing as tight as
//                                    each observed one arises under a null model
//                                    that shuffles dates (#2). The honesty layer.
//
// Heavy compute runs here, offline; the browser just renders static JSON — the
// same pattern as build-stargate-people. Uses the SAME src/ entity, place, and
// geocoding logic as the runtime app, so analytics never drift from the UI.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Case } from "../src/types";
import { haversineKm, getLatLng } from "../src/proximity";
import { figuresIn, canonPerson } from "../src/figures";
import { placesFor } from "../src/places";

const ROOT = resolve(import.meta.dirname, "..");
const PUB = resolve(ROOT, "public");
const SOURCES: { id: string; file: string }[] = [
  { id: "uap", file: "cases.json" },
  { id: "uap-catalog", file: "uap-catalog.json" },
  { id: "nuclear-test", file: "nuclear-tests.json" },
  { id: "nuclear-incident", file: "nuclear-incidents.json" },
  { id: "nuclear-physics", file: "nuclear-physics.json" },
  { id: "stargate", file: "stargate.json" },
  { id: "publication", file: "publications.json" },
];

// ── Load + normalize exactly as the app does at runtime ─────────────────────
async function loadCorpus(): Promise<Case[]> {
  const people: Record<string, string[]> = JSON.parse(
    await readFile(resolve(PUB, "stargate-people.json"), "utf8").catch(() => "{}"),
  );
  const out: Case[] = [];
  for (const src of SOURCES) {
    const raw: Case[] = JSON.parse(await readFile(resolve(PUB, src.file), "utf8"));
    for (const c0 of raw) {
      let c: Case =
        src.id !== "uap"
          ? { ...c0, dataset: src.id as Case["dataset"], subtype: c0.subtype ?? c0.type, type: "PDF" }
          : { ...c0, dataset: src.id as Case["dataset"] };
      if (c.dataset === "stargate" && people[c.id]) c = { ...c, people: people[c.id] };
      if (typeof c.lat !== "number") {
        const ll = getLatLng(c);
        if (ll) c = { ...c, lat: ll.lat, lng: ll.lng, approxGeo: true };
      }
      out.push(c);
    }
  }
  return out;
}

// ── 1. TF-IDF over synopses ─────────────────────────────────────────────────
const STOP = new Set(
  ("the of and to in a is for on with as by at from this that was were are be an it its their his her they "
    + "or which has have had not but also more most been will would can may about into over under between during "
    + "document report record file page pages classification approved release date united states u s national "
    + "et al circa") .split(/\s+/),
);
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((t) => !STOP.has(t) && t.length <= 24);
}
type Vec = Map<number, number>;
function buildTfidf(cases: Case[]): { vecs: Vec[] } {
  const vocab = new Map<string, number>();
  const df = new Map<number, number>();
  const docTokens: number[][] = [];
  for (const c of cases) {
    const toks = tokenize(`${c.title || ""} ${c.description || ""}`);
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const t of toks) {
      let id = vocab.get(t);
      if (id === undefined) { id = vocab.size; vocab.set(t, id); }
      ids.push(id);
      if (!seen.has(id)) { seen.add(id); df.set(id, (df.get(id) || 0) + 1); }
    }
    docTokens.push(ids);
  }
  const N = cases.length;
  const vecs: Vec[] = docTokens.map((ids) => {
    const tf = new Map<number, number>();
    for (const id of ids) tf.set(id, (tf.get(id) || 0) + 1);
    const v: Vec = new Map();
    let norm = 0;
    for (const [id, f] of tf) {
      const idf = Math.log(N / (df.get(id) || 1));
      const w = (1 + Math.log(f)) * idf;
      if (w > 0) { v.set(id, w); norm += w * w; }
    }
    norm = Math.sqrt(norm) || 1;
    for (const [id, w] of v) v.set(id, w / norm);
    return v;
  });
  return { vecs };
}
function cosine(a: Vec, b: Vec): number {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [id, w] of small) { const w2 = big.get(id); if (w2) dot += w * w2; }
  return dot;
}

// ── shared keywords between two docs (for the evidence panel) ───────────────
function topSharedTerms(a: Case, b: Case, limit = 4): string[] {
  const ta = new Set(tokenize(`${a.title || ""} ${a.description || ""}`));
  const counts = new Map<string, number>();
  for (const t of tokenize(`${b.title || ""} ${b.description || ""}`)) if (ta.has(t)) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, limit).map((x) => x[0]);
}

// ── entity sets per doc (people + places), canonical ────────────────────────
function entitiesOf(c: Case): { people: Set<string>; places: Set<string> } {
  const ppl = new Set<string>();
  if (c.dataset === "stargate") for (const p of c.people || []) ppl.add(canonPerson(p));
  if (c.dataset === "publication" && c.author)
    for (const a of c.author.split(/\s*[&,/]\s*/)) { const n = canonPerson(a.trim()); if (n.length > 2) ppl.add(n); }
  for (const f of figuresIn(`${c.title || ""} ${c.description || ""}`)) ppl.add(f);
  const places = new Set(placesFor(c).map((p) => p.id));
  return { people: ppl, places };
}

const yearOf = (c: Case) => (c.incidentDate ? new Date(c.incidentDate).getTime() : null);

function main() {
  return (async () => {
    const cases = await loadCorpus();
    const N = cases.length;
    const idToIdx = new Map(cases.map((c, i) => [c.id, i]));
    const { vecs } = buildTfidf(cases);
    const ent = cases.map(entitiesOf);
    const t = cases.map(yearOf);

    // 1) TF-IDF neighbors — top 6 per doc, cosine ≥ 0.10, cross-dataset
    //    preferred (a UAP doc similar to a physics doc is a *discovery*; two
    //    boilerplate nuclear tests being similar is not). We keep all but tag.
    const SIM_MIN = 0.12, SIM_TOP = 6;
    const similar: Record<string, { id: string; score: number; cross: boolean }[]> = {};
    for (let i = 0; i < N; i++) {
      const scored: { j: number; s: number }[] = [];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const s = cosine(vecs[i], vecs[j]);
        if (s >= SIM_MIN) scored.push({ j, s });
      }
      scored.sort((a, b) => b.s - a.s);
      const picks = scored.slice(0, SIM_TOP);
      if (picks.length)
        similar[cases[i].id] = picks.map((p) => ({
          id: cases[p.j].id,
          score: +p.s.toFixed(3),
          cross: cases[p.j].dataset !== cases[i].dataset,
        }));
    }

    // 2) Monte Carlo null model for UAP↔nuclear-test date-proximity.
    //    Observed: for each UAP case, days to the nearest nuclear test in time.
    //    Null model: keep the REAL test calendar fixed (preserving how many
    //    tests there were and their clustering), drop this UAP event at a
    //    uniformly random time in the testing era, and find its nearest test.
    //    p = P(random-placement nearest ≤ observed). Small p ⇒ this UAP case is
    //    unusually close in time to a test, beyond what the dense test calendar
    //    already makes likely. This is the honesty layer: most UAP cases sit in
    //    the 1950s–60s when tests fired weekly, so "near a test" is EXPECTED and
    //    earns a high (unremarkable) p — exactly the spurious-pattern guard.
    const isUap = (c: Case) => c.dataset === "uap" || c.dataset === "uap-catalog";
    const isTest = (c: Case) => c.dataset === "nuclear-test";
    const testTimes = cases.filter((c, i) => isTest(c) && t[i] != null).map((c) => yearOf(c)!).sort((a, b) => a - b);
    const nearestDays = (time: number) => {
      let lo = 0, hi = testTimes.length - 1, best = Infinity;
      while (lo <= hi) { const m = (lo + hi) >> 1; const d = Math.abs(testTimes[m] - time); if (d < best) best = d; if (testTimes[m] < time) lo = m + 1; else hi = m - 1; }
      return best / 86400000;
    };
    // Deterministic PRNG (mulberry32) — reproducible builds, no Math.random.
    let seed = 0x9e3779b9 >>> 0;
    const rng = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const SPAN_LO = testTimes[0], SPAN_HI = testTimes[testTimes.length - 1];
    const TRIALS = 3000;
    const uapPval: Record<string, { nearestTestDays: number; p: number }> = {};
    for (const u of cases.filter((c, i) => isUap(c) && t[i] != null)) {
      const ut = yearOf(u)!;
      const obsMs = nearestDays(ut) * 86400000;
      let tighter = 0;
      for (let trial = 0; trial < TRIALS; trial++) {
        const randT = SPAN_LO + rng() * (SPAN_HI - SPAN_LO);
        if (nearestDays(randT) * 86400000 <= obsMs) tighter++;
      }
      uapPval[u.id] = { nearestTestDays: Math.round(obsMs / 86400000), p: +(tighter / TRIALS).toFixed(4) };
    }

    // 3) Unified cross-document links — strongest correlations corpus-wide.
    //    Only cross-dataset pairs (within-dataset "links" are usually trivial),
    //    scored on shared entities (strongest signal), time proximity, geo
    //    proximity, and semantic similarity. Capped to a sane top-N for the feed.
    type Link = {
      a: string; b: string; score: number;
      sharedPeople: string[]; sharedPlaces: string[];
      km: number | null; days: number | null; sim: number;
    };
    const links: Link[] = [];
    // Candidate generation: only pairs that share ≥1 entity OR are TF-IDF
    // neighbors — avoids the O(N^2) full scan blowing up and keeps links real.
    const seenPair = new Set<string>();
    const placeIndex = new Map<string, number[]>();
    const personIndex = new Map<string, number[]>();
    cases.forEach((_, i) => {
      for (const p of ent[i].places) (placeIndex.get(p) || placeIndex.set(p, []).get(p)!).push(i);
      for (const p of ent[i].people) (personIndex.get(p) || personIndex.set(p, []).get(p)!).push(i);
    });
    const consider = (i: number, j: number) => {
      if (i === j) return;
      const a = cases[i], b = cases[j];
      if (a.dataset === b.dataset) return; // cross-dataset only
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seenPair.has(key)) return;
      seenPair.add(key);
      const sp = [...ent[i].people].filter((x) => ent[j].people.has(x));
      const spl = [...ent[i].places].filter((x) => ent[j].places.has(x));
      const sim = cosine(vecs[i], vecs[j]);
      const ti = t[i], tj = t[j];
      const days = ti != null && tj != null ? Math.abs(ti - tj) / 86400000 : null;
      const km =
        typeof a.lat === "number" && typeof b.lat === "number" && !a.approxGeo && !b.approxGeo
          ? haversineKm({ lat: a.lat, lng: a.lng! }, { lat: b.lat, lng: b.lng! })
          : null;
      // Weighted score in [0,1]-ish. Entities dominate; semantics/time/geo add.
      let score = 0;
      score += sp.length * 0.4 + spl.length * 0.25;
      score += sim * 0.6;
      if (days != null) score += Math.max(0, 0.3 * (1 - days / (5 * 365)));
      if (km != null) score += Math.max(0, 0.25 * (1 - km / 500));
      if (score < 0.35) return;
      links.push({
        a: a.id, b: b.id, score: +score.toFixed(3),
        sharedPeople: sp, sharedPlaces: spl,
        km: km != null ? Math.round(km) : null,
        days: days != null ? Math.round(days) : null,
        sim: +sim.toFixed(3),
      });
    };
    for (const idxs of [...placeIndex.values(), ...personIndex.values()])
      for (let x = 0; x < idxs.length; x++) for (let y = x + 1; y < idxs.length; y++) consider(idxs[x], idxs[y]);
    // also semantic-neighbor cross pairs
    for (let i = 0; i < N; i++) for (const nb of similar[cases[i].id] || []) if (nb.cross) { const j = idToIdx.get(nb.id); if (j != null) consider(i, j); }
    links.sort((a, b) => b.score - a.score);
    const topLinks = links.slice(0, 200);

    // ── Aggregate summary for the corpus dashboard (a few KB) ───────────────
    // The honesty headline + the shape of the corpus, computed once here.
    const perDataset: Record<string, number> = {};
    for (const c of cases) perDataset[c.dataset] = (perDataset[c.dataset] || 0) + 1;

    // p-value distribution — the anti-pareidolia headline. We want it to SHOW
    // that most UAP↔test proximities are expected (high p), few are surprising.
    const pvals = Object.values(uapPval).map((x) => x.p).sort((a, b) => a - b);
    const pctile = (q: number) => (pvals.length ? pvals[Math.min(pvals.length - 1, Math.floor(q * pvals.length))] : 0);
    const pvalSummary = {
      n: pvals.length,
      median: +pctile(0.5).toFixed(3),
      // histogram over 10 bins [0,1]
      histogram: Array.from({ length: 10 }, (_, b) => pvals.filter((p) => p >= b / 10 && p < (b + 1) / 10 || (b === 9 && p === 1)).length),
      significant: pvals.filter((p) => p < 0.05).length,
      weak: pvals.filter((p) => p >= 0.05 && p < 0.2).length,
      coincidental: pvals.filter((p) => p >= 0.2).length,
    };

    // Link composition (people / places / content) + per-dataset-pair counts.
    const linkByKind = { people: 0, places: 0, content: 0 };
    const pairCounts: Record<string, number> = {};
    for (const l of topLinks) {
      const kind = l.sharedPeople.length ? "people" : l.sharedPlaces.length ? "places" : "content";
      linkByKind[kind]++;
      const A = idToIdx.get(l.a), B = idToIdx.get(l.b);
      if (A != null && B != null) {
        const k = [cases[A].dataset, cases[B].dataset].sort().join(" ↔ ");
        pairCounts[k] = (pairCounts[k] || 0) + 1;
      }
    }

    // Top entities by cross-dataset reach (people + places that span datasets).
    const entityReach = new Map<string, { name: string; type: string; cases: Set<string>; datasets: Set<string> }>();
    cases.forEach((c, i) => {
      const add = (key: string, name: string, type: string) => {
        const e = entityReach.get(key) || { name, type, cases: new Set(), datasets: new Set() };
        e.cases.add(c.id); e.datasets.add(c.dataset); entityReach.set(key, e);
      };
      for (const p of ent[i].people) add(`person:${p}`, p, "person");
      for (const p of ent[i].places) add(`place:${p}`, p, "place");
    });
    const topEntities = [...entityReach.values()]
      .map((e) => ({ name: e.name, type: e.type, docs: e.cases.size, datasets: e.datasets.size }))
      .filter((e) => e.datasets >= 2)
      .sort((a, b) => b.datasets - a.datasets || b.docs - a.docs)
      .slice(0, 12);

    const summary = {
      totalDocs: N,
      perDataset,
      datedDocs: t.filter((x) => x != null).length,
      yearRange: (() => { const ys = cases.map((c) => (c.incidentDate ? +c.incidentDate.slice(0, 4) : null)).filter((y): y is number => !!y); return [Math.min(...ys), Math.max(...ys)]; })(),
      pval: pvalSummary,
      linkByKind,
      pairCounts,
      topEntities,
    };

    const stats = {
      generatedFrom: N,
      similar,
      links: topLinks,
      uapPval,
      summary,
      sharedTermsHint: "computed on demand client-side",
    };
    await writeFile(resolve(PUB, "corpus-stats.json"), JSON.stringify(stats));
    // also copy to data/ for provenance parity
    await writeFile(resolve(ROOT, "data", "corpus-stats.json"), JSON.stringify(stats, null, 0));
    console.log(
      `[build] corpus-stats: ${N} docs · ${Object.keys(similar).length} with similar · ` +
      `${topLinks.length} top links · ${Object.keys(uapPval).length} UAP p-values`,
    );
    // expose helper for unit-style sanity in CI logs
    void topSharedTerms;
  })();
}

main().catch((e) => { console.error(e); process.exit(1); });
