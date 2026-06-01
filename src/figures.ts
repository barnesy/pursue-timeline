// Curated notable-figure registry — the allow-list that extends the people
// network into the prose datasets (physics milestones, UAP, incidents) without
// NER. Each figure has a canonical name and a set of SAFE prose aliases
// (distinctive surnames, or full names where the surname is a common word).
// The same registry also canonicalizes structured names (Stargate figures,
// publication authors) so a mention and an authorship resolve to one entity —
// e.g. J. Allen Hynek the author and "Hynek" cited in a catalog case.
//
// IMPORTANT: the psi principals' canonical strings must match the output of
// scripts/build-stargate-people.mjs (the c.people values) exactly, so a tagged
// figure and a prose mention/author merge.

export type Figure = { name: string; aliases: string[] };

export const FIGURES: Figure[] = [
  // ── Psi / Stargate principals (canon must match build-stargate-people.mjs)
  { name: "Harold Puthoff", aliases: ["Puthoff"] },
  { name: "Russell Targ", aliases: ["Targ"] },
  { name: "Ingo Swann", aliases: ["Swann"] },
  { name: "Uri Geller", aliases: ["Geller"] },
  { name: "Pat Price", aliases: ["Pat Price"] },
  { name: "J. B. Rhine", aliases: ["Rhine"] },
  { name: "Hella Hammid", aliases: ["Hammid"] },
  { name: "Edgar Mitchell", aliases: ["Edgar Mitchell"] },
  { name: "Arthur Koestler", aliases: ["Koestler"] },
  { name: "Charles Tart", aliases: ["Charles Tart"] },
  { name: "Ken Kress", aliases: ["Ken Kress"] },
  { name: "Gerald Feinberg", aliases: ["Feinberg"] },
  { name: "Evan Harris Walker", aliases: ["Evan Harris Walker"] },
  { name: "John Mihalasky", aliases: ["Mihalasky"] },
  { name: "Ray Hyman", aliases: ["Ray Hyman"] },
  { name: "Upton Sinclair", aliases: ["Upton Sinclair"] },
  { name: "Sheila Ostrander", aliases: ["Ostrander"] },
  { name: "Lynn Schroeder", aliases: ["Schroeder"] },
  // ── Nuclear / particle physics
  { name: "Albert Einstein", aliases: ["Einstein"] },
  { name: "Enrico Fermi", aliases: ["Fermi"] },
  { name: "J. Robert Oppenheimer", aliases: ["Oppenheimer"] },
  { name: "Niels Bohr", aliases: ["Bohr"] },
  { name: "Ernest Rutherford", aliases: ["Rutherford"] },
  { name: "Marie Curie", aliases: ["Marie Curie", "Curie"] },
  { name: "Werner Heisenberg", aliases: ["Heisenberg"] },
  { name: "Edward Teller", aliases: ["Teller"] },
  { name: "Leó Szilárd", aliases: ["Szilard", "Szilárd"] },
  { name: "Hans Bethe", aliases: ["Bethe"] },
  { name: "Richard Feynman", aliases: ["Feynman"] },
  { name: "Ernest Lawrence", aliases: ["Ernest Lawrence"] },
  { name: "James Chadwick", aliases: ["Chadwick"] },
  { name: "Lise Meitner", aliases: ["Meitner"] },
  { name: "Otto Hahn", aliases: ["Hahn"] },
  { name: "Otto Frisch", aliases: ["Frisch"] },
  { name: "Fritz Strassmann", aliases: ["Strassmann"] },
  { name: "Andrei Sakharov", aliases: ["Sakharov"] },
  { name: "Igor Kurchatov", aliases: ["Kurchatov"] },
  { name: "Max Planck", aliases: ["Planck"] },
  { name: "Wilhelm Röntgen", aliases: ["Roentgen", "Röntgen"] },
  { name: "Henri Becquerel", aliases: ["Becquerel"] },
  { name: "J. J. Thomson", aliases: ["J. J. Thomson"] },
  { name: "Paul Dirac", aliases: ["Dirac"] },
  { name: "Wolfgang Pauli", aliases: ["Pauli"] },
  { name: "Eugene Wigner", aliases: ["Wigner"] },
  { name: "Glenn Seaborg", aliases: ["Seaborg"] },
  { name: "Hideki Yukawa", aliases: ["Yukawa"] },
  { name: "Stanislaw Ulam", aliases: ["Ulam"] },
  // ── UAP research / disclosure
  { name: "J. Allen Hynek", aliases: ["Hynek"] },
  { name: "Jacques Vallée", aliases: ["Vallée", "Vallee"] },
  { name: "Edward Condon", aliases: ["Condon"] },
  { name: "Peter Sturrock", aliases: ["Sturrock"] },
  { name: "Leslie Kean", aliases: ["Leslie Kean"] },
  { name: "Luis Elizondo", aliases: ["Elizondo"] },
  { name: "David Grusch", aliases: ["Grusch"] },
  { name: "Christopher Mellon", aliases: ["Christopher Mellon"] },
  { name: "David Fravor", aliases: ["Fravor"] },
  { name: "Mick West", aliases: ["Mick West"] },
  { name: "James M. McCampbell", aliases: ["McCampbell"] },
];

// Token → canonical name, for resolving structured person strings (authors,
// Stargate figures). Indexes each alias plus the canonical surname.
const tokenToCanon = new Map<string, string>();
for (const f of FIGURES) {
  const surname = (f.name.split(/\s+/).pop() || "").toLowerCase().replace(/[^a-z]/g, "");
  if (surname) tokenToCanon.set(surname, f.name);
  for (const a of f.aliases) tokenToCanon.set(a.toLowerCase(), f.name);
}

/** Resolve a person name string to its canonical form (or a tidied passthrough). */
export function canonPerson(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, " ");
  // Whole-string alias hit (e.g. "Mick West", "Pat Price").
  const whole = tokenToCanon.get(clean.toLowerCase());
  if (whole) return whole;
  // Otherwise scan tokens for a known surname/alias (handles "Edward U. Condon
  // / Univ. of Colorado" → "Edward Condon").
  for (const tok of clean.toLowerCase().split(/[^a-zà-ÿ]+/)) {
    const hit = tokenToCanon.get(tok);
    if (hit) return hit;
  }
  return clean;
}

// Precompiled prose matchers (word-boundary, case-insensitive).
const MATCHERS = FIGURES.map((f) => ({
  name: f.name,
  res: f.aliases.map((a) => new RegExp(`(?:^|[^\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^\\p{L}]|$)`, "iu")),
}));

/** Canonical names of figures explicitly named in a record's title/description. */
export function figuresIn(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of MATCHERS) {
    if (m.res.some((re) => re.test(text)) && !out.includes(m.name)) out.push(m.name);
  }
  return out;
}
