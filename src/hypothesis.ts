// Adversarial hypothesis engine — the antidote to pareidolia. Given a pair of
// correlated documents, it states the connection as a claim, then a SKEPTIC
// argues against it using the actual statistics (Monte Carlo p-value, base
// rates, the nature of each shared signal), and renders a verdict.
//
// Deliberately deterministic and rule-based — NOT a live LLM. Every clause is
// grounded in a number we computed, so the skeptic can't hand-wave and the
// output is reproducible. The goal isn't to debunk every link; it's to make
// the user reason about *why* a connection might be real or spurious.

import type { Case } from "./types";
import type { EvidenceItem } from "./evidence";
import type { UapPval } from "./corpusStats";

export type Hypothesis = {
  claim: string;
  forPoints: string[];     // the case that they're connected
  against: string[];       // the skeptic's rebuttal
  verdict: { label: string; color: string; rationale: string };
  strength: number;        // 0–1, drives the verdict
};

const ds = (c: Case) =>
  ({ uap: "UAP", "uap-catalog": "UAP-catalog", "nuclear-test": "nuclear-test", "nuclear-incident": "nuclear-incident", "nuclear-physics": "physics", stargate: "Stargate", publication: "publication" }[c.dataset] || c.dataset);

const shortTitle = (c: Case) => (c.title.length > 60 ? c.title.slice(0, 60) + "…" : c.title);

export function buildHypothesis(a: Case, b: Case, evidence: EvidenceItem[], pval?: UapPval): Hypothesis {
  const forPoints: string[] = [];
  const against: string[] = [];

  const ev = (k: EvidenceItem["kind"]) => evidence.find((e) => e.kind === k);
  const people = ev("people");
  const places = ev("places");
  const time = ev("time");
  const distance = ev("distance");
  const keywords = ev("keywords");

  // ── The case FOR a connection ───────────────────────────────────────────
  if (people) forPoints.push(`Both name ${people.detail} — a direct documentary link, not an inference.`);
  if (places) forPoints.push(`Both are anchored to ${places.detail}.`);
  if (distance && distance.strength > 0.5) forPoints.push(`They occurred ${distance.detail}, well within a shared locale.`);
  if (time && time.strength > 0.6) forPoints.push(`They are close in time (${time.detail}).`);
  if (keywords) forPoints.push(`Their synopses share distinctive language: ${keywords.detail}.`);

  // ── The SKEPTIC's rebuttal — grounded in stats & base rates ─────────────
  if (pval) {
    if (pval.p >= 0.2)
      against.push(
        `The nearest nuclear test is ${pval.nearestTestDays === 0 ? "the same day" : `${pval.nearestTestDays.toLocaleString()} days away`}, ` +
        `but a Monte Carlo test says ${Math.round(pval.p * 100)}% of random dates land at least this close — given how often tests fired, "near a test" is the default, not a signal.`,
      );
    else if (pval.p >= 0.05)
      against.push(`Time proximity to a test is only weakly unusual (p=${pval.p.toFixed(2)}); it would happen by chance roughly 1 in ${Math.round(1 / pval.p)} times.`);
    else
      against.push(`Time proximity IS statistically unusual (p=${pval.p.toFixed(3)}) — the skeptic concedes this one is hard to dismiss as coincidence.`);
  }
  if (!people && !places)
    against.push(`No shared person or place ties these documents — the link rests on softer signals (timing, wording) that two unrelated documents can share.`);
  if (time && time.strength < 0.4 && !people && !places)
    against.push(`They are ${time.detail} — a gap wide enough that almost any pair of Cold-War-era documents would "co-occur" at this resolution.`);
  if (distance && distance.strength < 0.3)
    against.push(`At ${distance.detail} they are not meaningfully co-located.`);
  if (keywords && !people && !places && evidence.length <= 2)
    against.push(`Shared terms (${keywords.detail}) are common to the era's vocabulary and don't establish a specific link.`);
  if (a.approxGeo || b.approxGeo)
    against.push(`At least one location is an approximate region centroid, so any distance/place overlap is coarse.`);

  // ── Verdict — weight hard signals (entities) over soft (time/words) ──────
  let strength = 0;
  if (people) strength += 0.5;
  if (places) strength += 0.3;
  if (distance) strength += 0.15 * distance.strength;
  if (time) strength += 0.15 * time.strength;
  if (keywords) strength += 0.1 * keywords.strength;
  // p-value can rescue or sink a timing-only claim
  if (pval) { if (pval.p < 0.05) strength += 0.25; else if (pval.p >= 0.5) strength -= 0.2; }
  strength = Math.max(0, Math.min(1, strength));

  let verdict: Hypothesis["verdict"];
  if (strength >= 0.6)
    verdict = { label: "Survives scrutiny", color: "#34d399", rationale: "Anchored by hard documentary links (shared people/places) the skeptic can't explain away." };
  else if (strength >= 0.35)
    verdict = { label: "Plausible, unproven", color: "#f0a13a", rationale: "Real overlap, but the connection leans on signals that coincidence can also produce." };
  else
    verdict = { label: "Likely coincidence", color: "#7a8595", rationale: "The shared signals are the kind any two era-matched documents would have. Treat as a lead, not a link." };

  const claim = `${shortTitle(a)} (${ds(a)}) and ${shortTitle(b)} (${ds(b)}) are connected.`;

  return { claim, forPoints, against, verdict, strength: +strength.toFixed(2) };
}
