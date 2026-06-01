// Extracts a clean "key figures" list per STARGATE document from the raw
// entity CSV (data/raw/stargate-metadata.csv) and writes a map keyed by our
// record id (sg-CIA_..._txt) to data/ + public/ stargate-people.json.
//
// The CSV's `persons` column is OCR-extracted and noisy (garbage tokens,
// ALL-CAPS fragments, and the same person under many surface forms like
// "H. Puthoff" / "Hal Puthoff" / "Harold E. Puthoff"). We:
//   1. canonicalize the program's principals by surname,
//   2. drop non-name noise (single tokens, ALL-CAPS, stop-words),
//   3. keep only figures that appear in >= 2 documents corpus-wide
//      (a rare OCR mangle won't clear that bar), and
//   4. cap each document to its 8 most-prominent figures (by corpus frequency).

import fs from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CSV = resolve(ROOT, "data", "raw", "stargate-metadata.csv");

function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Canonicalize the recurring principals so variant spellings collapse to one.
const CANON = {
  puthoff: "Harold Puthoff", targ: "Russell Targ", swann: "Ingo Swann",
  geller: "Uri Geller", price: "Pat Price", rhine: "J. B. Rhine",
  hammid: "Hella Hammid", mitchell: "Edgar Mitchell", koestler: "Arthur Koestler",
  tart: "Charles Tart", kress: "Ken Kress", feinberg: "Gerald Feinberg",
  walker: "Evan Harris Walker", mihalasky: "John Mihalasky", hyman: "Ray Hyman",
  sinclair: "Upton Sinclair", ostrander: "Sheila Ostrander", schroeder: "Lynn Schroeder",
};
const STOP = new Set([
  "the","and","of","for","in","to","fig","stem","optics","increased","table",
  "figure","note","none","electronics","abstract","report","appendix","project",
]);

function clean(raw) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 4) return null;
  if (!/\s/.test(name)) return null;                 // require multi-word
  if (!/[a-z]/.test(name)) return null;              // drop ALL-CAPS OCR noise
  if (!/^[A-Za-z][A-Za-z.'\- ]+$/.test(name)) return null;
  if (name.split(" ").some((t) => STOP.has(t.toLowerCase()))) return null;
  const surname = name.split(" ").pop().toLowerCase().replace(/[^a-z]/g, "");
  return CANON[surname] || name;
}

const fnToId = (fn) => "sg-" + fn.replace(/\.txt$/, "").replace(/[-.]/g, "_") + "_txt";

const rows = parseCSV(fs.readFileSync(CSV, "utf8"));
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const docs = rows.slice(1).filter((r) => (r[idx.filename] || "").endsWith(".txt"));

// Only attach to records we actually display.
const displayed = new Set(
  JSON.parse(fs.readFileSync(resolve(ROOT, "public", "stargate.json"), "utf8")).map((r) => r.id),
);

// Pass 1: clean names per doc + corpus frequency.
const perDoc = new Map();   // recordId -> Set(name)
const freq = new Map();
for (const d of docs) {
  const id = fnToId(d[idx.filename]);
  if (!displayed.has(id)) continue;
  const set = new Set();
  for (const raw of (d[idx.persons] || "").split("|")) {
    const name = clean(raw);
    if (name) set.add(name);
  }
  perDoc.set(id, set);
  for (const n of set) freq.set(n, (freq.get(n) || 0) + 1);
}

// Pass 2: keep figures seen in >= 2 docs, cap each doc to its top 8.
const out = {};
let total = 0;
for (const [id, set] of perDoc) {
  const figures = [...set]
    .filter((n) => (freq.get(n) || 0) >= 2)
    .sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0))
    .slice(0, 8);
  if (figures.length) { out[id] = figures; total += figures.length; }
}

const json = JSON.stringify(out, null, 2);
fs.writeFileSync(resolve(ROOT, "data", "stargate-people.json"), json);
fs.writeFileSync(resolve(ROOT, "public", "stargate-people.json"), json);
console.log(
  `[build] stargate-people: ${Object.keys(out).length} docs tagged, ${total} figure refs, ` +
  `${[...freq.values()].filter((c) => c >= 2).length} distinct figures (>=2 docs).`,
);
