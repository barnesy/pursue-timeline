// "Why are these connected?" — turns a pair of cases into a list of concrete,
// checkable evidence items (shared people/places, time gap, distance, shared
// keywords, statistical significance). Every correlation the app asserts must
// be explainable through this, so the user can judge it rather than trust it.

import type { Case } from "./types";
import { figuresIn, canonPerson } from "./figures";
import { placesFor } from "./places";
import { haversineKm } from "./proximity";
import type { UapPval } from "./corpusStats";

export type EvidenceItem = {
  kind: "people" | "places" | "time" | "distance" | "keywords" | "significance";
  label: string;
  detail: string;
  /** 0–1 strength, drives the bar; significance uses inverse p. */
  strength: number;
};

const STOP = new Set(
  ("the of and to in a is for on with as by at from this that document report record file page united states "
    + "nuclear test weapons program project research").split(/\s+/),
);
function terms(c: Case): Set<string> {
  return new Set((`${c.title || ""} ${c.description || ""}`.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []).filter((t) => !STOP.has(t)));
}

function peopleOf(c: Case): Set<string> {
  const s = new Set<string>();
  if (c.dataset === "stargate") for (const p of c.people || []) s.add(canonPerson(p));
  if (c.dataset === "publication" && c.author)
    for (const a of c.author.split(/\s*[&,/]\s*/)) { const n = canonPerson(a.trim()); if (n.length > 2) s.add(n); }
  for (const f of figuresIn(`${c.title || ""} ${c.description || ""}`)) s.add(f);
  return s;
}

export function explainPair(a: Case, b: Case, pval?: UapPval): EvidenceItem[] {
  const out: EvidenceItem[] = [];

  const pa = peopleOf(a), pb = peopleOf(b);
  const sharedPeople = [...pa].filter((x) => pb.has(x));
  if (sharedPeople.length)
    out.push({ kind: "people", label: "Shared people", detail: sharedPeople.join(", "), strength: Math.min(1, sharedPeople.length / 2) });

  const plA = new Set(placesFor(a).map((p) => p.name));
  const sharedPlaces = placesFor(b).map((p) => p.name).filter((n) => plA.has(n));
  if (sharedPlaces.length)
    out.push({ kind: "places", label: "Shared place", detail: [...new Set(sharedPlaces)].join(", "), strength: 0.8 });

  if (a.incidentDate && b.incidentDate) {
    const days = Math.abs(new Date(a.incidentDate).getTime() - new Date(b.incidentDate).getTime()) / 86400000;
    const yrs = days / 365.25;
    const detail = days < 1 ? "same day" : days < 90 ? `${Math.round(days)} days apart` : `${yrs.toFixed(1)} years apart`;
    out.push({ kind: "time", label: "Time proximity", detail, strength: Math.max(0, 1 - yrs / 5) });
  }

  if (typeof a.lat === "number" && typeof b.lat === "number" && !a.approxGeo && !b.approxGeo) {
    const km = haversineKm({ lat: a.lat, lng: a.lng! }, { lat: b.lat, lng: b.lng! });
    out.push({ kind: "distance", label: "Distance", detail: km < 1 ? "<1 km apart" : `${Math.round(km)} km apart`, strength: Math.max(0, 1 - km / 500) });
  }

  const ta = terms(a);
  const shared = [...terms(b)].filter((t) => ta.has(t));
  const counts = new Map<string, number>();
  for (const t of shared) counts.set(t, (counts.get(t) || 0) + 1);
  const topTerms = [...new Set(shared)].slice(0, 5);
  if (topTerms.length >= 2)
    out.push({ kind: "keywords", label: "Shared terms", detail: topTerms.join(", "), strength: Math.min(1, topTerms.length / 5) });

  if (pval) {
    const detail =
      pval.p < 0.05
        ? `Only ${(pval.p * 100).toFixed(pval.p < 0.01 ? 1 : 0)}% of random placements land this close to a test — unlikely to be chance.`
        : `${(pval.p * 100).toFixed(0)}% of random placements land at least this close — expected given the test calendar.`;
    out.push({ kind: "significance", label: "Statistical significance", detail, strength: Math.max(0, 1 - pval.p) });
  }

  return out.sort((x, y) => y.strength - x.strength);
}
