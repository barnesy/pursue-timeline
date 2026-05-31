// Prep: join richer entity lists from the source HF metadata onto our 337
// stargate records, then slice into batch files for synopsis agents to read.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const META_URL =
  "https://huggingface.co/datasets/GotThatData/STARGATE-Processed/resolve/main/metadata.json";

const records = JSON.parse(
  await readFile(resolve(ROOT, "data", "stargate.json"), "utf8"),
);

// id = "sg-" + filename with /\W/ -> "_". Invert by matching against meta.
const resp = await fetch(META_URL);
const meta = await resp.json();
const byId = new Map();
for (const m of meta) {
  const id = `sg-${String(m.filename).replace(/\W/g, "_")}`;
  byId.set(id, m);
}

const dedupe = (arr, n) =>
  [...new Set((arr || []).filter((s) => typeof s === "string" && s.trim().length > 1))].slice(0, n);

const enriched = records.map((r) => {
  const m = byId.get(r.id) || {};
  const e = m.entities || {};
  return {
    id: r.id,
    title: r.title,
    year: r.incidentDateRaw,
    category: r.subtype || "other",
    classification: m.classification || "(none on record)",
    pages: m.page_count ?? null,
    words: m.word_count ?? null,
    projectNames: dedupe(m.project_names, 6),
    persons: dedupe(e.persons, 12),
    organizations: dedupe(e.organizations, 12),
    locations: dedupe(e.locations, 12),
    sourceUrl: r.sourceUrl,
  };
});

const BATCH = 17; // 337 / 17 ≈ 20 records per batch
const batches = [];
for (let i = 0; i < enriched.length; i += BATCH) {
  batches.push(enriched.slice(i, i + BATCH));
}

const outDir = resolve(ROOT, "scripts", "synopsis-batches");
await mkdir(outDir, { recursive: true });
for (let i = 0; i < batches.length; i++) {
  const name = `batch-${String(i).padStart(2, "0")}.json`;
  await writeFile(resolve(outDir, name), JSON.stringify(batches[i], null, 2));
}
console.log(`records=${enriched.length} batches=${batches.length} dir=${outDir}`);
console.log(`per-batch sizes: ${batches.map((b) => b.length).join(",")}`);
