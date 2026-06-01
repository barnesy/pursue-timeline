// Cross-dataset entity registry — the foundation of the people/place/
// publication network. v1 covers PEOPLE, derived from the two structured
// signals we already have:
//   • STARGATE documents' extracted key figures (c.people)
//   • Published works' authors (parsed from the "By …" description)
// A person becomes one entity keyed by a canonical name, so e.g. "Harold
// Puthoff" collects both his STARGATE files and the papers he authored —
// that cross-dataset join is the whole point. Places, organizations, and
// prose-derived people are later layers that plug into the same registry.

import type { Case } from "./types";

export type EntityType = "person";

export type Entity = {
  id: string;
  type: EntityType;
  name: string;
  caseIds: string[];
};

// Keep this surname→canonical map in sync with build-stargate-people.mjs so a
// figure tagged in a STARGATE doc and the same person credited as an author
// resolve to one entity.
const CANON: Record<string, string> = {
  puthoff: "Harold Puthoff", targ: "Russell Targ", swann: "Ingo Swann",
  geller: "Uri Geller", price: "Pat Price", rhine: "J. B. Rhine",
  hammid: "Hella Hammid", mitchell: "Edgar Mitchell", koestler: "Arthur Koestler",
  tart: "Charles Tart", kress: "Ken Kress", feinberg: "Gerald Feinberg",
  walker: "Evan Harris Walker", mihalasky: "John Mihalasky", hyman: "Ray Hyman",
  sinclair: "Upton Sinclair", ostrander: "Sheila Ostrander", schroeder: "Lynn Schroeder",
};

function canon(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  const surname = (clean.split(" ").pop() || "").toLowerCase().replace(/[^a-z]/g, "");
  return CANON[surname] || clean;
}

const slug = (name: string) =>
  "person:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function authorsOf(c: Case): string[] {
  if (c.dataset !== "publication" || !c.author) return [];
  return c.author.split(/\s*&\s*|\s*,\s*/).map((s) => s.trim()).filter(Boolean);
}

// The raw person names a given record contributes to the registry.
function namesIn(c: Case): string[] {
  if (c.dataset === "stargate") return c.people || [];
  if (c.dataset === "publication") return authorsOf(c);
  return [];
}

export type EntityIndex = {
  byId: Map<string, Entity>;
  /** Entities this record mentions (people figures / authors). */
  forCase: (c: Case) => Entity[];
};

export function buildEntityIndex(cases: Case[]): EntityIndex {
  const byId = new Map<string, Entity>();
  const caseEntityIds = new Map<string, string[]>();
  for (const c of cases) {
    const ids: string[] = [];
    for (const raw of namesIn(c)) {
      const name = canon(raw);
      if (name.length < 3) continue;
      const id = slug(name);
      let e = byId.get(id);
      if (!e) { e = { id, type: "person", name, caseIds: [] }; byId.set(id, e); }
      if (!e.caseIds.includes(c.id)) e.caseIds.push(c.id);
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length) caseEntityIds.set(c.id, ids);
  }
  return {
    byId,
    forCase: (c) => (caseEntityIds.get(c.id) || []).map((id) => byId.get(id)).filter((e): e is Entity => !!e),
  };
}
