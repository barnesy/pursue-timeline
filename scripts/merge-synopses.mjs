// Merge agent-written synopses (scripts/synopsis-out/batch-*.json) back into
// the stargate dataset, replacing each record's `description`. Writes both the
// canonical data/ copy and the public/ copy the app serves.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = resolve(ROOT, "scripts", "synopsis-out");

const files = (await readdir(OUT_DIR)).filter((f) => /^batch-\d+\.json$/.test(f)).sort();
if (files.length === 0) throw new Error("no batch output files found in " + OUT_DIR);

const synopsisById = new Map();
let dupes = 0;
for (const f of files) {
  const arr = JSON.parse(await readFile(resolve(OUT_DIR, f), "utf8"));
  for (const { id, synopsis } of arr) {
    if (!id || !synopsis || !synopsis.trim()) {
      console.warn(`  WARN ${f}: empty entry`, id);
      continue;
    }
    if (synopsisById.has(id)) dupes++;
    synopsisById.set(id, synopsis.trim());
  }
}
console.log(`collected ${synopsisById.size} synopses from ${files.length} files (dupes=${dupes})`);

const dataPath = resolve(ROOT, "data", "stargate.json");
const records = JSON.parse(await readFile(dataPath, "utf8"));

let matched = 0;
const missing = [];
for (const r of records) {
  const s = synopsisById.get(r.id);
  if (s) {
    r.description = s;
    matched++;
  } else {
    missing.push(r.id);
  }
}
console.log(`matched ${matched}/${records.length} records`);
if (missing.length) console.warn(`MISSING (${missing.length}):`, missing.join(", "));

const json = JSON.stringify(records, null, 2);
await writeFile(dataPath, json);
await writeFile(resolve(ROOT, "public", "stargate.json"), json);
console.log("wrote data/stargate.json and public/stargate.json");
