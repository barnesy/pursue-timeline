// Investigation Brief assembler — the deterministic report engine. Given a set
// of collected cases, it composes a structured briefing entirely from the
// app's existing PURE analytics: pairwise evidence (explainPair), adversarial
// verdicts (buildHypothesis), Monte Carlo significance (uapPval), shared
// entities, and the corpus baseline (summary). No LLM — every sentence is a
// template assembled from a computed fact, so the brief is reproducible and
// the honesty layer travels into the exported artifact.

import type { Case } from "./types";
import type { CorpusStats } from "./corpusStats";
import { explainPair } from "./evidence";
import { buildHypothesis, type Hypothesis } from "./hypothesis";
import { DATASETS } from "./datasets";

export type BriefPair = {
  a: Case;
  b: Case;
  hyp: Hypothesis;
  evidence: ReturnType<typeof explainPair>;
};

export type Brief = {
  title: string;
  cases: Case[];
  yearSpan: [number, number] | null;
  datasets: { id: string; name: string; count: number }[];
  pairs: BriefPair[];                 // all cross-dataset pairs, ranked by verdict strength
  surviving: BriefPair[];             // verdict tier survives/plausible
  dismissed: BriefPair[];             // likely-coincidence
  significant: { c: Case; p: number; days: number }[]; // statistically notable UAP cases
  summaryLine: string;                // one-paragraph plain-language synopsis
};

const tier = (s: number) => (s >= 0.6 ? "survives" : s >= 0.35 ? "plausible" : "coincidence");

export function buildBrief(title: string, cases: Case[], stats: CorpusStats | null): Brief {
  const pvalOf = (c: Case) => stats?.uapPval[c.id];

  // Year span
  const years = cases.map((c) => (c.incidentDate ? +c.incidentDate.slice(0, 4) : null)).filter((y): y is number => !!y);
  const yearSpan: [number, number] | null = years.length ? [Math.min(...years), Math.max(...years)] : null;

  // Dataset breakdown
  const dsCount = new Map<string, number>();
  for (const c of cases) dsCount.set(c.dataset, (dsCount.get(c.dataset) || 0) + 1);
  const datasets = [...dsCount.entries()].map(([id, count]) => ({ id, name: DATASETS[id as Case["dataset"]]?.name || id, count }));

  // All cross-dataset pairs among the collected cases (within-dataset pairs are
  // usually trivial), each scored through the same skeptic the UI uses.
  const pairs: BriefPair[] = [];
  for (let i = 0; i < cases.length; i++)
    for (let j = i + 1; j < cases.length; j++) {
      const a = cases[i], b = cases[j];
      if (a.dataset === b.dataset) continue;
      const pval = pvalOf(a) || pvalOf(b);
      const evidence = explainPair(a, b, pval);
      if (!evidence.length) continue;
      const hyp = buildHypothesis(a, b, evidence, pval);
      pairs.push({ a, b, hyp, evidence });
    }
  pairs.sort((x, y) => y.hyp.strength - x.hyp.strength);

  const surviving = pairs.filter((p) => tier(p.hyp.strength) !== "coincidence");
  const dismissed = pairs.filter((p) => tier(p.hyp.strength) === "coincidence");

  // Statistically significant UAP cases in the set (p < 0.2).
  const significant = cases
    .map((c) => ({ c, pv: pvalOf(c) }))
    .filter((x) => x.pv && x.pv.p < 0.2)
    .map((x) => ({ c: x.c, p: x.pv!.p, days: x.pv!.nearestTestDays }))
    .sort((a, b) => a.p - b.p);

  // One-paragraph synopsis — assembled, not generated.
  const summaryLine = composeSummary(cases.length, datasets.length, yearSpan, surviving.length, dismissed.length, significant.length);

  return { title, cases, yearSpan, datasets, pairs, surviving, dismissed, significant, summaryLine };
}

function composeSummary(
  n: number, dsN: number, span: [number, number] | null,
  surviving: number, dismissed: number, significant: number,
): string {
  const parts: string[] = [];
  parts.push(`This investigation collects ${n} document${n === 1 ? "" : "s"} across ${dsN} dataset${dsN === 1 ? "" : "s"}${span ? `, spanning ${span[0]}–${span[1]}` : ""}.`);
  if (surviving + dismissed > 0) {
    parts.push(`Of ${surviving + dismissed} cross-dataset connection${surviving + dismissed === 1 ? "" : "s"} examined, ${surviving} survive${surviving === 1 ? "s" : ""} adversarial scrutiny and ${dismissed} ${dismissed === 1 ? "is" : "are"} likely coincidental.`);
  } else {
    parts.push(`No cross-dataset connections were found among these documents — they may belong to the same dataset or share no measurable signal.`);
  }
  if (significant > 0) parts.push(`${significant} case${significant === 1 ? "" : "s"} show${significant === 1 ? "s" : ""} a statistically notable proximity to nuclear testing (p < 0.2).`);
  else parts.push(`No case in this set is unusually close in time to a nuclear test beyond what the dense test calendar already predicts.`);
  return parts.join(" ");
}
