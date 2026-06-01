#!/usr/bin/env node
// Off Nominal MCP server (local, stdio). Exposes the declassified-anomaly
// corpus + its honesty-layer analytics as tools any MCP client (Claude
// Desktop/Code) can call. Runs entirely on the user's machine over the shipped
// static JSON — zero hosting cost, no network, read-only.
//
// DESIGN NON-NEGOTIABLE (from the research synthesis): every tool that reports
// a connection LEADS with the adversarial verdict / significance label, so an
// agent cannot quietly narrate a p≈1 coincidence as a finding. The server's
// whole value is that it carries the anti-pareidolia thesis into agent
// workflows — it must not become a connection-hallucination machine.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadCorpus, judgePair, pvalOf, findNearby, significanceLabel, type Corpus } from "./corpus.js";
import type { Case } from "../src/types.js";

const briefCase = (c: Case) => ({
  id: c.id,
  title: c.title,
  dataset: c.dataset,
  date: c.incidentDateRaw || c.incidentDate || null,
  location: c.incidentLocation || null,
});

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function notFound(id: string) {
  return { content: [{ type: "text" as const, text: `No document with id "${id}". Use search_documents to find ids.` }], isError: true };
}

async function main() {
  const corpus: Corpus = await loadCorpus();

  const server = new McpServer({ name: "off-nominal", version: "1.0.0" });

  // ── search_documents ──────────────────────────────────────────────────────
  server.registerTool(
    "search_documents",
    {
      title: "Search documents",
      description:
        "Full-text ranked search over 2,737 declassified-anomaly documents (UAP cases, nuclear tests/incidents, nuclear-physics milestones, CIA Stargate, published works). Fuzzy + prefix matching across title, named entities, and synopsis. Returns ranked {id, title, dataset, date, location}. Use the ids with the other tools.",
      inputSchema: {
        query: z.string().describe("search terms, e.g. 'remote viewing soviet' or a person/place name"),
        limit: z.number().int().min(1).max(50).optional().describe("max results (default 15)"),
      },
    },
    async ({ query, limit }) => {
      const hits = corpus.search.search(query).slice(0, limit ?? 15);
      return json({
        query,
        count: hits.length,
        results: hits.map((h) => ({ score: +h.score.toFixed(2), ...briefCase(corpus.byId.get(h.id as string)!) })),
      });
    },
  );

  // ── get_document ──────────────────────────────────────────────────────────
  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description:
        "Full record for one document id: title, dataset, date, location, synopsis, source URL, named figures, and (for UAP cases) its Monte Carlo significance vs. the nuclear-test calendar.",
      inputSchema: { id: z.string().describe("document id from search_documents") },
    },
    async ({ id }) => {
      const c = corpus.byId.get(id);
      if (!c) return notFound(id);
      const pv = pvalOf(corpus, c);
      return json({
        ...briefCase(c),
        synopsis: c.description || null,
        sourceUrl: c.sourceUrl || null,
        figures: c.people || [],
        significance: pv ? { ...significanceLabel(pv.p), p: pv.p, nearestTestDays: pv.nearestTestDays } : null,
      });
    },
  );

  // ── test_hypothesis ───────────────────────────────────────────────────────
  server.registerTool(
    "test_hypothesis",
    {
      title: "Test a connection (adversarial)",
      description:
        "THE HONESTY TOOL. Given two document ids, returns the adversarial verdict FIRST — 'Survives scrutiny' / 'Plausible, unproven' / 'Likely coincidence' with a 0-100 strength — then the case FOR, the skeptic's rebuttal (grounded in shared entities, distance, dates, and the Monte Carlo p-value), and the raw evidence. Deterministic, not an opinion. ALWAYS report the verdict before describing any connection; do not narrate a 'Likely coincidence' as a meaningful link.",
      inputSchema: { a: z.string().describe("first document id"), b: z.string().describe("second document id") },
    },
    async ({ a, b }) => {
      const ca = corpus.byId.get(a), cb = corpus.byId.get(b);
      if (!ca) return notFound(a);
      if (!cb) return notFound(b);
      const { evidence, hyp } = judgePair(corpus, ca, cb);
      return json({
        verdict: hyp.verdict.label,
        strength: hyp.strength,
        a: briefCase(ca), b: briefCase(cb),
        caseFor: hyp.forPoints,
        skepticRebuttal: hyp.against,
        evidence: evidence.map((e) => ({ kind: e.kind, detail: e.detail, strength: +e.strength.toFixed(2) })),
        note: "Verdict is computed deterministically; it weights shared people/places above timing/wording that coincidence can fake.",
      });
    },
  );

  // ── find_correlations ─────────────────────────────────────────────────────
  server.registerTool(
    "find_correlations",
    {
      title: "Find cross-dataset correlations for a document",
      description:
        "For a document id, returns its strongest cross-dataset connections, EACH LED BY its adversarial verdict so coincidences are flagged. Combines shared entities, geographic/temporal proximity, and content similarity. Most connections are 'Likely coincidence' by design — treat 'Survives scrutiny' as the signal.",
      inputSchema: {
        id: z.string().describe("document id"),
        limit: z.number().int().min(1).max(25).optional().describe("max connections (default 8)"),
      },
    },
    async ({ id, limit }) => {
      const c = corpus.byId.get(id);
      if (!c) return notFound(id);
      const near = findNearby(c, corpus.cases, { maxKm: 500, maxYears: 5, limit: limit ?? 8 });
      const results = near.map((n) => {
        const { hyp } = judgePair(corpus, c, n.case);
        return {
          verdict: hyp.verdict.label, strength: hyp.strength,
          ...briefCase(n.case),
          km: Math.round(n.km), daysApart: Math.abs(n.daysDelta),
        };
      }).sort((x, y) => y.strength - x.strength);
      return json({ document: briefCase(c), connections: results });
    },
  );

  // ── nearest_in_time ───────────────────────────────────────────────────────
  server.registerTool(
    "nearest_in_time",
    {
      title: "Nearest nuclear test in time",
      description:
        "For a UAP/anomaly document, how close (in days) is the nearest nuclear test, AND the Monte Carlo p-value: how often a random date in the testing era lands at least this close. High p means the proximity is EXPECTED given how often tests fired — not a signal. Reports the significance tier first.",
      inputSchema: { id: z.string().describe("document id (best for UAP cases)") },
    },
    async ({ id }) => {
      const c = corpus.byId.get(id);
      if (!c) return notFound(id);
      const pv = pvalOf(corpus, c);
      if (!pv) return json({ document: briefCase(c), significance: null, note: "No nuclear-test proximity p-value for this document (only UAP-dataset cases are tested)." });
      const sig = significanceLabel(pv.p);
      return json({
        significanceTier: sig.label,
        p: pv.p,
        nearestTestDays: pv.nearestTestDays,
        interpretation: pv.p >= 0.2
          ? `Coincidental: ${Math.round(pv.p * 100)}% of random dates land at least this close to a test. Proximity is the default here, not a finding.`
          : `Unusual: only ${Math.round(pv.p * 100)}% of random dates land this close — tighter than chance.`,
        document: briefCase(c),
      });
    },
  );

  // ── entity_dossier ────────────────────────────────────────────────────────
  server.registerTool(
    "entity_dossier",
    {
      title: "Entity dossier (person or place)",
      description:
        "Everywhere a person or place appears across the datasets — the cross-dataset reach that makes the network valuable (e.g. Harold Puthoff spans Stargate files + the papers he authored; New Mexico spans UAP, nuclear tests, and physics). Pass a name; returns the documents grouped by dataset.",
      inputSchema: { name: z.string().describe("a person or place name, e.g. 'Harold Puthoff' or 'New Mexico'") },
    },
    async ({ name }) => {
      const q = name.trim().toLowerCase();
      const matches = [...corpus.entityIndex.byId.values()].filter((e) => e.name.toLowerCase().includes(q));
      if (!matches.length) return json({ name, found: false, hint: "No entity by that name. Try a surname, or a place like 'Trinity' / 'Nevada Test Site'." });
      const out = matches.slice(0, 3).map((e) => {
        const byDataset: Record<string, ReturnType<typeof briefCase>[]> = {};
        for (const id of e.caseIds) { const c = corpus.byId.get(id); if (c) (byDataset[c.dataset] ||= []).push(briefCase(c)); }
        return { entity: e.name, type: e.type, totalDocs: e.caseIds.length, datasets: Object.keys(byDataset).length, byDataset };
      });
      return json({ query: name, entities: out });
    },
  );

  // ── corpus_overview ───────────────────────────────────────────────────────
  server.registerTool(
    "corpus_overview",
    {
      title: "Corpus overview & methodology",
      description:
        "The corpus shape and the honesty headline: dataset counts, and the Monte Carlo result that MOST UAP↔nuclear-test proximities are statistically expected (coincidental), with only a couple significant. Read this first to calibrate expectations before investigating — it is the anti-pareidolia baseline.",
      inputSchema: {},
    },
    async () => {
      const s = corpus.stats?.summary;
      return json({
        totalDocuments: corpus.cases.length,
        perDataset: s?.perDataset ?? null,
        yearRange: s?.yearRange ?? null,
        uapNuclearProximity: s
          ? { tested: s.pval.n, coincidental: s.pval.coincidental, weak: s.pval.weak, significant: s.pval.significant, medianP: s.pval.median,
              takeaway: `${s.pval.coincidental} of ${s.pval.n} UAP cases are coincidental, only ${s.pval.significant} significant — proximity to a test is usually the default, not a signal.` }
          : null,
        topConnectors: s?.topEntities ?? null,
      });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe to log on (stdout is the protocol channel).
  console.error(`[off-nominal-mcp] ready · ${corpus.cases.length} documents · ${corpus.stats ? "analytics loaded" : "analytics MISSING (run npm run build-corpus-stats)"}`);
}

main().catch((e) => { console.error("[off-nominal-mcp] fatal:", e); process.exit(1); });
