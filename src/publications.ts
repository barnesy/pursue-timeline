// Cross-references between the curated "published works" and the CIA STARGATE
// documents that cite them — the "call out" linkage.
//
// We don't hold the documents' full OCR text, only the AI-written synopses, so
// matching keys off a hand-tuned pattern per work (author surname and/or a
// distinctive title fragment) run against each document's title + synopsis.
// Each pattern was checked against the corpus when the work was added, so the
// match counts are real rather than aspirational. This is a heuristic, not a
// citation index: it surfaces references the synopsis happens to mention.

import type { Case } from "./types";

type PubRef = { id: string; match: RegExp };

// Keyed by the generated published-work record id (uc-pub-N).
const PUBLICATION_REFS: PubRef[] = [
  { id: "uc-pub-10", match: /sensory shielding|information transmission under conditions/i },
  { id: "uc-pub-11", match: /perceptual channel|kilometer distances/i },
  { id: "uc-pub-12", match: /iron curtain|ostrander|schroeder/i },
  // Rhine's 1934 monograph rarely appears by title; his name is the proxy.
  { id: "uc-pub-13", match: /extra[- ]sensory perception|\bRhine\b/i },
  { id: "uc-pub-14", match: /mental radio/i },
  { id: "uc-pub-15", match: /mind[- ]reach/i },
];

const refById = new Map(PUBLICATION_REFS.map((r) => [r.id, r.match]));

function textOf(c: Case): string {
  return `${c.title || ""} ${c.description || ""}`;
}

/** Is this case one of the works we track citations for? */
export function isTrackedPublication(id: string): boolean {
  return refById.has(id);
}

/** Documents (in practice the STARGATE files) whose synopsis references `workId`. */
export function findReferencingDocs(workId: string, all: Case[]): Case[] {
  const re = refById.get(workId);
  if (!re) return [];
  return all
    .filter((c) => c.id !== workId && c.agency !== "Published work" && re.test(textOf(c)))
    .sort((a, b) => (a.incidentDate || "9999").localeCompare(b.incidentDate || "9999"));
}

/** Tracked published works that the given document appears to reference. */
export function findReferencedPublications(doc: Case, all: Case[]): Case[] {
  if (doc.agency === "Published work") return [];
  const text = textOf(doc);
  const ids = PUBLICATION_REFS.filter((r) => r.match.test(text)).map((r) => r.id);
  if (!ids.length) return [];
  const byId = new Map(all.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is Case => !!c);
}
