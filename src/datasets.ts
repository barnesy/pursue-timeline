// Multi-dataset registry. Each Case in the app belongs to exactly one dataset.
// Dataset metadata controls how it's rendered (color, icon, lane label) and
// whether it participates in the geographic map view (datasets like Stargate
// have date+source but no useful per-record geographic data).

export type DatasetId =
  | "uap"
  | "uap-catalog"
  | "nuclear-test"
  | "nuclear-incident"
  | "nuclear-physics"
  | "stargate"
  | "publication";

export type Dataset = {
  id: DatasetId;
  name: string;
  shortName: string;
  color: string;
  hasGeo: boolean;
  description: string;
  sourceLabel: string;
  sourceUrl: string;
};

export const DATASETS: Record<DatasetId, Dataset> = {
  uap: {
    id: "uap",
    name: "Unidentified Anomalous Phenomena",
    shortName: "UAP",
    color: "#7ab8ff",
    hasGeo: true,
    description:
      "Declassified UAP cases released by the US Department of War under the PURSUE initiative.",
    sourceLabel: "war.gov/ufo",
    sourceUrl: "https://www.war.gov/ufo/",
  },
  "uap-catalog": {
    id: "uap-catalog",
    name: "UAP Verification Catalog",
    shortName: "UAP Catalog",
    color: "#34d399",
    hasGeo: true,
    description:
      "Curated catalog of publicly available, not-widely-debunked UAP imagery/video scored on six verification dimensions, plus sworn Congressional testimony and key published works.",
    sourceLabel: "UAP Verification Catalog",
    sourceUrl: "https://www.aaro.mil/",
  },
  "nuclear-test": {
    id: "nuclear-test",
    name: "Nuclear Weapons Tests",
    shortName: "Nuclear Tests",
    color: "#ffd166",
    hasGeo: true,
    description:
      "Atmospheric, underground, and underwater nuclear weapons tests worldwide, 1945–present. Sourced from SIPRI's Nuclear Explosions dataset and Wikipedia.",
    sourceLabel: "SIPRI · Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/List_of_nuclear_weapons_tests",
  },
  "nuclear-incident": {
    id: "nuclear-incident",
    name: "Nuclear Incidents",
    shortName: "Nuclear Incidents",
    color: "#ef476f",
    hasGeo: true,
    description:
      'US military "Broken Arrow" weapons accidents and major civilian reactor incidents.',
    sourceLabel: "atomicarchive.com · Wikipedia",
    sourceUrl: "https://www.atomicarchive.com/almanac/broken-arrows/index.html",
  },
  "nuclear-physics": {
    id: "nuclear-physics",
    name: "Nuclear Physics Milestones",
    shortName: "Physics Milestones",
    color: "#a78bfa",
    hasGeo: true,
    description:
      "Landmark discoveries, inventions, and milestones in nuclear and particle physics, 1896–present, placed at the city where each occurred. Each entry links to its canonical Wikipedia article.",
    sourceLabel: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Nuclear_physics",
  },
  stargate: {
    id: "stargate",
    name: "CIA Stargate Project",
    shortName: "Stargate",
    color: "#9aa5b1",
    hasGeo: false,
    description:
      "CIA remote-viewing program documents, declassified 1995. Timeline-only — most records have dates but no useful geographic data.",
    sourceLabel: "CIA FOIA Reading Room",
    sourceUrl: "https://www.cia.gov/readingroom/collection/stargate",
  },
  publication: {
    id: "publication",
    name: "Published Works & Reports",
    shortName: "Published Works",
    color: "#f4a261",
    hasGeo: false,
    description:
      "Key books, papers, and official reports across the anomaly record — UFO literature, parapsychology research cited in the CIA STARGATE files, and government studies.",
    sourceLabel: "Various",
    sourceUrl: "",
  },
};

export const DATASET_IDS: DatasetId[] = Object.keys(DATASETS) as DatasetId[];

export function getDataset(id: DatasetId): Dataset {
  return DATASETS[id];
}

export function datasetHasGeo(id: DatasetId): boolean {
  return DATASETS[id].hasGeo;
}

// Null-safe accessors — return a sensible fallback for an unexpected dataset id
// (stale corpus-stats, a renamed/future dataset) instead of throwing on
// `DATASETS[id].color`, which would white-screen a component.
const FALLBACK_COLOR = "#7ab8ff";
export function datasetColor(id: string): string {
  return DATASETS[id as DatasetId]?.color ?? FALLBACK_COLOR;
}
export function datasetShortName(id: string): string {
  return DATASETS[id as DatasetId]?.shortName ?? id;
}
