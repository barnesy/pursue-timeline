// Cross-dataset entity registry — the people/place network. A PERSON becomes
// one entity keyed by a canonical name, so "Harold Puthoff" collects his
// STARGATE files, the papers he authored, AND any prose that names him; a
// PLACE collects every geo-bearing record in its radius. People come from
// three signals, all canonicalized through figures.ts so they merge:
//   • STARGATE documents' extracted key figures (c.people)
//   • published works' authors (c.author)
//   • the curated figure allow-list matched against any record's prose
// Places come from the curated gazetteer (places.ts).

import type { Case } from "./types";
import { placesFor } from "./places";
import { canonPerson, figuresIn } from "./figures";

export type EntityType = "person" | "place";

export type Entity = {
  id: string;
  type: EntityType;
  name: string;
  caseIds: string[];
};

const slug = (name: string) =>
  "person:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const ORG_AUTHOR = /\b(univ|university|air force|usaf|dod|aaro|scu|various|et al|colorado)\b/i;

function authorsOf(c: Case): string[] {
  if (c.dataset !== "publication" || !c.author) return [];
  return c.author
    .split(/\s*[&,/]\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !ORG_AUTHOR.test(s));
}

// Canonical person names a record contributes: structured signals (STARGATE
// figures, authors) plus curated figures named in its title/description.
function namesIn(c: Case): string[] {
  const set = new Set<string>();
  if (c.dataset === "stargate") for (const p of c.people || []) set.add(canonPerson(p));
  for (const a of authorsOf(c)) set.add(canonPerson(a));
  for (const f of figuresIn(`${c.title || ""} ${c.description || ""}`)) set.add(f);
  return [...set];
}

export type EntityIndex = {
  byId: Map<string, Entity>;
  /** Entities this record mentions (people figures / authors). */
  forCase: (c: Case) => Entity[];
};

export function buildEntityIndex(cases: Case[]): EntityIndex {
  const byId = new Map<string, Entity>();
  const caseEntityIds = new Map<string, string[]>();
  const link = (id: string, type: EntityType, name: string, caseId: string, ids: string[]) => {
    let e = byId.get(id);
    if (!e) { e = { id, type, name, caseIds: [] }; byId.set(id, e); }
    if (!e.caseIds.includes(caseId)) e.caseIds.push(caseId);
    if (!ids.includes(id)) ids.push(id);
  };
  for (const c of cases) {
    const ids: string[] = [];
    for (const name of namesIn(c)) {
      if (name.length < 3) continue;
      link(slug(name), "person", name, c.id, ids);
    }
    for (const p of placesFor(c)) {
      link(`place:${p.id}`, "place", p.name, c.id, ids);
    }
    if (ids.length) caseEntityIds.set(c.id, ids);
  }
  return {
    byId,
    forCase: (c) => (caseEntityIds.get(c.id) || []).map((id) => byId.get(id)).filter((e): e is Entity => !!e),
  };
}
