// Build-time MiniSearch index → public/search-index.json. Replaces the app's
// naive substring search with field-boosted, typo-tolerant, prefix ranking.
//
// SIZE DISCIPLINE (per research): index titles + entities + a TRUNCATED
// abstract only — never full bodies (Stargate bodies alone are ~366KB and
// would balloon the index to multiple MB). The abstract is the first ~280
// chars of the synopsis, enough for ranking without shipping the corpus twice.
// The runtime lazy-loads this file on first search, and Pages gzip keeps the
// wire size small.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import MiniSearch from "minisearch";
import type { Case } from "../src/types";
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

async function main() {
  const people: Record<string, string[]> = JSON.parse(
    await readFile(resolve(PUB, "stargate-people.json"), "utf8").catch(() => "{}"),
  );

  type Doc = {
    id: string;
    title: string;
    agency: string;
    dataset: string;
    entities: string; // people + places, space-joined, for the entity field
    abstract: string; // truncated synopsis
    year: string;
  };
  const docs: Doc[] = [];

  for (const src of SOURCES) {
    const raw: Case[] = JSON.parse(await readFile(resolve(PUB, src.file), "utf8"));
    for (const c0 of raw) {
      const c: Case =
        src.id !== "uap"
          ? { ...c0, dataset: src.id as Case["dataset"], subtype: c0.subtype ?? c0.type, type: "PDF" }
          : { ...c0, dataset: src.id as Case["dataset"] };
      if (c.dataset === "stargate" && people[c.id]) c.people = people[c.id];

      // Entity field: canonical people (stargate figures, authors, prose
      // figures) + place names. This is what makes "find docs about Puthoff"
      // or "anything near Trinity" work as ranked search.
      const ent = new Set<string>();
      if (c.dataset === "stargate") for (const p of c.people || []) ent.add(canonPerson(p));
      if (c.dataset === "publication" && c.author)
        for (const a of c.author.split(/\s*[&,/]\s*/)) { const n = canonPerson(a.trim()); if (n.length > 2) ent.add(n); }
      for (const f of figuresIn(`${c.title || ""} ${c.description || ""}`)) ent.add(f);
      for (const p of placesFor(c)) ent.add(p.name);
      if (c.incidentLocation) ent.add(c.incidentLocation);

      docs.push({
        id: c.id,
        title: c.title || "",
        agency: c.agency || "",
        dataset: c.dataset,
        entities: [...ent].join(" · "),
        abstract: (c.description || "").slice(0, 280),
        year: c.incidentDate ? c.incidentDate.slice(0, 4) : "",
      });
    }
  }

  const mini = new MiniSearch<Doc>({
    fields: ["title", "entities", "abstract", "agency", "year"],
    storeFields: [], // store nothing — the app already has the full cases by id
    searchOptions: {
      boost: { title: 3, entities: 2.5, abstract: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });
  mini.addAll(docs);

  const json = JSON.stringify(mini.toJSON());
  await writeFile(resolve(PUB, "search-index.json"), json);
  await writeFile(resolve(ROOT, "data", "search-index.json"), json);
  console.log(`[build] search-index: ${docs.length} docs indexed → ${(json.length / 1024).toFixed(0)}KB (pre-gzip)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
