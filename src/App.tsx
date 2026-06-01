import { useEffect, useMemo, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import TimelineIcon from "@mui/icons-material/Timeline";
import PublicIcon from "@mui/icons-material/Public";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import EventNoteIcon from "@mui/icons-material/EventNote";
import CloseIcon from "@mui/icons-material/Close";
import HubIcon from "@mui/icons-material/Hub";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SearchIcon from "@mui/icons-material/Search";
import InputBase from "@mui/material/InputBase";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import Drawer from "@mui/material/Drawer";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import Badge from "@mui/material/Badge";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { useRef } from "react";
import type React from "react";
import type { Case } from "./types";
import { AGENCY_COLORS, AGENCY_SHORT, TYPE_COLORS, TYPE_LABELS } from "./theme";
import type { NotableHotspot } from "./notableHotspots";
import { Timeline } from "./Timeline";
import { MapView } from "./MapView";
import { CasePanel } from "./CaseDrawer";
import { HotspotsPanel } from "./HotspotsPanel";
import { CasesOverlay } from "./CasesOverlay";
import { ConnectionsExplorer } from "./ConnectionsExplorer";
import { InvestigationBrief } from "./InvestigationBrief";
import { ErrorBoundary } from "./ErrorBoundary";
import { readSharedFromHash } from "./investigations";
import { casesStore } from "./collection";
import { useCaseIds } from "./collection";
import { useUnits, unitsStore } from "./units";
import { buildEntityIndex } from "./entities";
import { EntityPanel } from "./EntityPanel";
import { getLatLng } from "./proximity";
import { loadCorpusStats, type CorpusStats } from "./corpusStats";
import { loadSearch, rankedIds } from "./search";
import { clickable } from "./a11y";
import {
  DATASETS,
  DATASET_IDS,
  type DatasetId,
  datasetHasGeo,
} from "./datasets";

type ViewMode = "split" | "timeline" | "map";

type DatasetSource = {
  id: DatasetId;
  url: string;
};

// Yield and altitude buckets — only apply to nuclear-test records.
// Yield is bucketed numerically from yieldKt. Altitude is bucketed primarily
// from the test TYPE (SIPRI's depth column is unreliable — frequently 0 for
// records of unknown depth — so we treat type as authoritative and use the
// numeric altitudeM only as a tie-breaker for AIRDROP / BALLOON which span
// "low air" to "air burst").
type YieldBucket = {
  key: string;
  label: string;
  color: string;
  match: (kt: number) => boolean;
};

type AltitudeBucket = {
  key: string;
  label: string;
  color: string;
  /** Matcher inspects the case's type string and altitudeM (m, signed). */
  matchCase: (typeStr: string, altM: number | undefined) => boolean;
};

// Yield buckets — six log-scaled tiers that mirror real-world weapon classes
// AND fit the actual SIPRI yield distribution. The previous 4-bucket scheme
// piled 481 of 1,242 records (39%) into a single "20 kt–1 Mt" chip, and
// lumped Castle Bravo (15 Mt) with the smallest 1 Mt warheads. Six tiers
// keep each chip's record count between ~10 and ~400 — wide enough to be
// useful, narrow enough that filtering is interpretable.
// Sentinel bucket key for nuclear-test records whose yield wasn't recorded
// in SIPRI. 815 of 2,057 NT records have unknown yield — most are safety
// experiments and Soviet/French shots with poor declassification. Without
// this chip, the user couldn't actually filter out the un-yielded set.
const UNKNOWN_YIELD_KEY = "unknown" as const;

const YIELD_BUCKETS: YieldBucket[] = [
  { key: "sub-kt",        label: "<1 kt",       color: "#5fc3b5", match: (kt) => kt < 1 },
  { key: "tactical",      label: "1–20 kt",     color: "#f0c93c", match: (kt) => kt >= 1 && kt < 20 },
  { key: "intermediate",  label: "20–200 kt",   color: "#f08a3a", match: (kt) => kt >= 20 && kt < 200 },
  { key: "strategic",     label: "200 kt–1 Mt", color: "#d9533a", match: (kt) => kt >= 200 && kt < 1000 },
  { key: "megaton",       label: "1–10 Mt",     color: "#e8413a", match: (kt) => kt >= 1000 && kt < 10_000 },
  { key: "super-megaton", label: "≥10 Mt",      color: "#b03060", match: (kt) => kt >= 10_000 },
];

// Display list includes the Unknown chip at the end. Counts and active-state
// for Unknown are handled separately from the other buckets in the rendering.
const YIELD_BUCKET_KEYS_ALL = [...YIELD_BUCKETS.map((b) => b.key), UNKNOWN_YIELD_KEY];

// Device-type inference. SIPRI doesn't record fissile material directly, but
// the physics of nuclear weapons creates strong yield→device-type correlations:
//   • Sub-critical / safety experiments: <10 t (no significant chain reaction)
//   • Pure or low-boosted fission: 10 t – 100 kt (Trinity, Hiroshima class)
//   • Boosted fission / small thermonuclear: 100 kt – 500 kt (ambiguous range)
//   • Thermonuclear (multi-stage fusion): ≥500 kt (Castle Bravo, Mike, Tsar Bomba)
// This is an INFERENCE — the labels include "likely" since a few edge cases
// (e.g. Operation Ivy's KING at 500 kt was pure fission) don't fit cleanly.
type DeviceTypeBucket = {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
  match: (c: Case) => boolean;
};

const DEVICE_TYPE_BUCKETS: DeviceTypeBucket[] = [
  {
    key: "subcritical",
    label: "Sub-critical / safety",
    shortLabel: "Sub-critical",
    color: "#7a8595",
    match: (c) => {
      if (typeof c.yieldKt !== "number") return false;
      if (c.yieldKt < 0.01) return true;
      // Catches safety-experiment tests in the 10t-1kt range too
      const txt = (c.title + " " + (c.description || "")).toLowerCase();
      return /safety experiment|hydronuclear|sub-?critical/.test(txt);
    },
  },
  {
    key: "fission",
    label: "Fission (likely)",
    shortLabel: "Fission",
    color: "#5fc3b5",
    match: (c) => {
      if (typeof c.yieldKt !== "number") return false;
      if (c.yieldKt < 0.01) return false;
      const txt = (c.title + " " + (c.description || "")).toLowerCase();
      if (/safety experiment|hydronuclear|sub-?critical/.test(txt)) return false;
      return c.yieldKt < 100;
    },
  },
  {
    key: "boosted",
    label: "Boosted fission (likely)",
    shortLabel: "Boosted",
    color: "#f0c93c",
    match: (c) => typeof c.yieldKt === "number" && c.yieldKt >= 100 && c.yieldKt < 500,
  },
  {
    key: "thermonuclear",
    label: "Thermonuclear",
    shortLabel: "Thermonuclear",
    color: "#e8413a",
    match: (c) => typeof c.yieldKt === "number" && c.yieldKt >= 500,
  },
];

const UNKNOWN_DEVICE_KEY = "unknown-device" as const;
const DEVICE_BUCKET_KEYS_ALL = [...DEVICE_TYPE_BUCKETS.map((b) => b.key), UNKNOWN_DEVICE_KEY];

function deviceBucketKey(c: Case): string | null {
  for (const b of DEVICE_TYPE_BUCKETS) {
    if (b.match(c)) return b.key;
  }
  return null;
}

// Type patterns. Order matters: first match wins.
const ALTITUDE_BUCKETS: AltitudeBucket[] = [
  {
    key: "exo",
    label: "Exoatmospheric (>30 km)",
    color: "#c8b9ff",
    matchCase: (t, alt) => /ROCKET/.test(t) || (typeof alt === "number" && alt > 30_000),
  },
  {
    key: "air",
    label: "Air burst",
    color: "#7ab8ff",
    matchCase: (t, alt) =>
      /AIRDROP|BALLOON|ATMOSPH/.test(t) ||
      (typeof alt === "number" && alt > 200 && alt <= 30_000),
  },
  {
    key: "tower",
    label: "Tower / low air",
    color: "#f0c93c",
    matchCase: (t, alt) =>
      /TOWER/.test(t) || (typeof alt === "number" && alt > 0 && alt <= 200),
  },
  {
    key: "surface",
    label: "Surface / water",
    color: "#d9b48a",
    matchCase: (t, alt) =>
      /SURFACE|BARGE|SHIP|UNDERWATER|^UW$/.test(t) ||
      (typeof alt === "number" && alt === 0 && !/SHAFT|TUNNEL|^UG$|CRATER/.test(t)),
  },
  {
    key: "underground",
    label: "Underground",
    color: "#8a6a4a",
    matchCase: (t, alt) =>
      /SHAFT|TUNNEL|^UG$|CRATER/.test(t) || (typeof alt === "number" && alt < 0),
  },
];

function yieldBucketKey(kt: number): string | null {
  return YIELD_BUCKETS.find((b) => b.match(kt))?.key ?? null;
}
function altitudeBucketKeyFor(typeStr: string, altM: number | undefined): string | null {
  if (!typeStr && typeof altM !== "number") return null;
  return ALTITUDE_BUCKETS.find((b) => b.matchCase(typeStr || "", altM))?.key ?? null;
}

// CIA Stargate (337 docs) is heavily skewed toward routine process paper, so a
// "Topic" row sorts each doc into one of three significance tiers to let a
// reader cut to the substance:
//   • psi      — reports of actual psychic phenomena (remote viewing, telepathy,
//                psychokinesis, precognition): the headline material
//   • research — substantive experiments, papers and analysis that aren't a
//                named-phenomenon session
//   • admin    — correspondence, funding, security, routing: process paper
// Runtime heuristic (like deviceBucketKey): the data's own `subtype` is
// authoritative for the explicit psi/admin types, and the synopsis text
// disambiguates the large generic experiment/research buckets.
type StargateTopic = { key: string; label: string; color: string };
const STARGATE_TOPICS: StargateTopic[] = [
  { key: "psi",      label: "Psi phenomena",          color: "#c084fc" },
  { key: "research", label: "Experiments & research", color: "#5fc3b5" },
  { key: "admin",    label: "Administrative",         color: "#7a8595" },
];
const STARGATE_TOPIC_KEYS_ALL = STARGATE_TOPICS.map((b) => b.key);
const STARGATE_PSI_SUBTYPES = new Set([
  "remote_viewing",
  "telepathy",
  "psychokinesis",
  "precognition",
]);
const STARGATE_PSI_RE =
  /remote[- ]view|clairvoyan|telepath|psychokine|precognit|out[- ]of[- ]body|\bESP\b|ganzfeld|premonition/i;

function stargateTopicKey(c: Case): string | null {
  if (c.dataset !== "stargate") return null;
  const st = (c.subtype || "").toLowerCase();
  if (st === "administrative" || st === "correspondence") return "admin";
  if (STARGATE_PSI_SUBTYPES.has(st)) return "psi";
  if (STARGATE_PSI_RE.test(c.description || "")) return "psi";
  return "research";
}

const DATASET_SOURCES: DatasetSource[] = [
  { id: "uap", url: "cases.json" },
  { id: "uap-catalog", url: "uap-catalog.json" },
  { id: "nuclear-test", url: "nuclear-tests.json" },
  { id: "nuclear-incident", url: "nuclear-incidents.json" },
  { id: "nuclear-physics", url: "nuclear-physics.json" },
  { id: "stargate", url: "stargate.json" },
  { id: "publication", url: "publications.json" },
];

export function App() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const caseIds = useCaseIds();
  const units = useUnits();
  const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null);
  // Cross-dataset people registry (Stargate figures + publication authors).
  const entityIndex = useMemo(() => buildEntityIndex(cases ?? []), [cases]);
  // Build-time corpus analytics: TF-IDF similars, scored links, p-values.
  const [corpusStats, setCorpusStats] = useState<CorpusStats | null>(null);
  useEffect(() => {
    loadCorpusStats(import.meta.env.BASE_URL).then(setCorpusStats);
  }, []);
  // A shared investigation link (#inv=...) hydrates the Cases collection and
  // opens the brief — turning a URL into a reproducible investigation.
  useEffect(() => {
    const shared = readSharedFromHash();
    if (shared && shared.caseIds.length) {
      shared.caseIds.forEach((id) => casesStore.add(id));
      setBriefOpen(true);
      try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignore */ }
    }
  }, []);
  // Lazy-load the MiniSearch index on first keystroke; a bump re-runs the
  // search memo once it's ready so ranked results replace the substring fallback.
  const [searchReadyTick, setSearchReadyTick] = useState(0);
  const [casesOpen, setCasesOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [activeAgencies, setActiveAgencies] = useState<Set<string>>(new Set());
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [activeDatasets, setActiveDatasets] = useState<Set<DatasetId>>(
    new Set(DATASET_IDS),
  );
  const [activeYieldBuckets, setActiveYieldBuckets] = useState<Set<string>>(
    new Set(YIELD_BUCKET_KEYS_ALL),
  );
  const [activeAltitudeBuckets, setActiveAltitudeBuckets] = useState<Set<string>>(
    new Set(ALTITUDE_BUCKETS.map((b) => b.key)),
  );
  const [activeDeviceBuckets, setActiveDeviceBuckets] = useState<Set<string>>(
    new Set(DEVICE_BUCKET_KEYS_ALL),
  );
  const [activeStargateTopics, setActiveStargateTopics] = useState<Set<string>>(
    new Set(STARGATE_TOPIC_KEYS_ALL),
  );
  const [selected, setSelected] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Non-fatal: datasets that failed to load while others succeeded.
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("timeline");
  const [xDomain, setXDomain] = useState<[Date, Date] | null>(null);
  // Lifted from MapView so timeline + map can both react to the same focus.
  // Now uses curated NotableHotspot definitions instead of algorithmic
  // group-key matching — the matcher predicate fully defines the case set.
  const [focusedHotspot, setFocusedHotspot] = useState<NotableHotspot | null>(null);

  // Imperative handles for the side panels so the toolbar toggles can
  // collapse/expand without changing the layout state.
  const hotspotsPanelRef = useRef<ImperativePanelHandle>(null);
  const detailPanelRef = useRef<ImperativePanelHandle>(null);
  const [hotspotsCollapsed, setHotspotsCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Mobile detection. At sm-down (<600px) we switch to a stack of overlay
  // drawers instead of a 3-pane resizable layout. The horizontal panel
  // group simply isn't usable on a phone-width screen.
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileDrawer, setMobileDrawer] = useState<"hotspots" | "detail" | null>(null);

  // On mobile, opening a case shows the detail drawer instead of a side pane.
  useEffect(() => {
    if (isMobile && selected) setMobileDrawer("detail");
  }, [isMobile, selected?.id]);

  // Debounce the search input by 200ms so we don't refilter 2,640 records
  // on every keystroke. 200ms is short enough that typing feels live.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [searchTerm]);

  // First time the user searches, lazily fetch the MiniSearch index; bump a
  // tick when it lands so the search memo recomputes with ranked results.
  useEffect(() => {
    if (searchTerm.trim().length >= 2) {
      loadSearch(import.meta.env.BASE_URL).then((m) => { if (m) setSearchReadyTick((t) => t + 1); });
    }
  }, [searchTerm]);

  // Keyboard shortcuts: "/" focuses search, "Esc" clears it or closes the
  // detail panel (whichever is most relevant).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in a different input.
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape") {
        if (document.activeElement === searchInputRef.current && searchTerm) {
          setSearchTerm("");
        } else if (selected) {
          setSelected(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchTerm, selected]);

  // When the user picks a new case, auto-expand the detail panel if it was
  // collapsed — otherwise their click would feel like a no-op.
  useEffect(() => {
    if (selected && detailCollapsed) {
      detailPanelRef.current?.expand();
    }
    // Only re-run on selection change, not on collapse-state change (else
    // collapsing while a case is selected would immediately re-expand).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    const normalize = (src: (typeof DATASET_SOURCES)[number], raw: Omit<Case, "dataset">[]): Case[] =>
      raw.map((c) => {
        // For non-UAP datasets, collapse detailed `type` strings (UNDERGROUND
        // SHAFT, BROKEN ARROW, etc.) into the catch-all "PDF" so the MEDIA
        // filter row stays focused on the 4 primary media types. The original
        // type is preserved as `subtype` — unless the record already carries
        // its own `subtype` (Stargate/physics/catalog), which we keep.
        if (src.id !== "uap") {
          return { ...c, dataset: src.id, subtype: c.subtype ?? c.type, type: "PDF" } as Case;
        }
        return { ...c, dataset: src.id } as Case;
      });

    // Load each dataset independently: one bad/missing file degrades to "N of 7
    // loaded" rather than blanking everything. Only a TOTAL failure is fatal.
    const datasetsP = Promise.allSettled(
      DATASET_SOURCES.map((src) =>
        fetch(`${import.meta.env.BASE_URL}${src.url}`)
          .then((r) => {
            if (!r.ok) throw new Error(`${src.id}: HTTP ${r.status}`);
            return r.json();
          })
          .then((raw: Omit<Case, "dataset">[]) => ({ src, cases: normalize(src, raw) })),
      ),
    );
    // Key-figure entity map for STARGATE docs (best-effort; absent → no chips).
    const peopleP: Promise<Record<string, string[]>> = fetch(
      `${import.meta.env.BASE_URL}stargate-people.json`,
    )
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    Promise.all([datasetsP, peopleP])
      .then(([settled, people]) => {
        const failed = settled
          .map((s, i) => (s.status === "rejected" ? String(DATASET_SOURCES[i].id) : null))
          .filter((x): x is string => x !== null);
        const perDataset = settled
          .filter((s): s is PromiseFulfilledResult<{ src: (typeof DATASET_SOURCES)[number]; cases: Case[] }> => s.status === "fulfilled")
          .map((s) => s.value.cases);
        if (perDataset.length === 0) {
          setError("Could not load any dataset. Check your connection and reload.");
          return;
        }
        if (failed.length) setLoadWarning(`${failed.length} dataset${failed.length === 1 ? "" : "s"} failed to load (${failed.join(", ")}). Showing the rest.`);
        const data: Case[] = perDataset
          .flat()
          .map((c) => {
            const withPeople =
              c.dataset === "stargate" && people[c.id] ? { ...c, people: people[c.id] } : c;
            // Resolve string-only locations (UAP cases) to real coordinates once
            // at load, so the places network/map/graph all see lat/lng instead
            // of each re-running the geocoder (or, for places.ts, missing them).
            if (typeof withPeople.lat === "number") return withPeople;
            const ll = getLatLng(withPeople);
            // Geocoded coords are coarse (theater/region centroid): plot them,
            // but flag so places.ts won't geo-match them to site-level places.
            return ll ? { ...withPeople, lat: ll.lat, lng: ll.lng, approxGeo: true } : withPeople;
          });
        setCases(data);
        setActiveAgencies(new Set(data.map((c) => c.agency).filter(Boolean)));
        setActiveTypes(new Set(data.map((c) => c.type).filter(Boolean)));
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Datasets present in the loaded data (with totals).
  const datasets = useMemo(() => {
    if (!cases) return [];
    const counts = new Map<DatasetId, number>();
    for (const c of cases) counts.set(c.dataset, (counts.get(c.dataset) || 0) + 1);
    return DATASET_IDS.filter((id) => counts.has(id)).map((id) => ({
      id,
      count: counts.get(id) || 0,
      meta: DATASETS[id],
    }));
  }, [cases]);

  // Agencies — restricted to currently-active datasets so toggling off a
  // dataset hides its nation chips.
  const agencies = useMemo(() => {
    if (!cases) return [];
    const counts = new Map<string, number>();
    for (const c of cases) {
      if (!c.agency) continue;
      if (!activeDatasets.has(c.dataset)) continue;
      counts.set(c.agency, (counts.get(c.agency) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [cases, activeDatasets]);

  // Agencies grouped by dataset — drives the timeline's section-header layout.
  // Each entry: one dataset, with its agencies sorted by case count descending.
  // The SAME agency string (e.g. "United States") can appear under multiple
  // datasets and gets its own lane in each.
  const agencyGroups = useMemo(() => {
    if (!cases) return [];
    const perDataset = new Map<DatasetId, Map<string, number>>();
    for (const c of cases) {
      if (!c.agency) continue;
      if (!activeDatasets.has(c.dataset)) continue;
      if (!activeAgencies.has(c.agency)) continue;
      if (!perDataset.has(c.dataset)) perDataset.set(c.dataset, new Map());
      const m = perDataset.get(c.dataset)!;
      m.set(c.agency, (m.get(c.agency) || 0) + 1);
    }
    return DATASET_IDS.filter((id) => perDataset.has(id)).map((id) => ({
      datasetId: id,
      datasetMeta: DATASETS[id],
      agencies: [...perDataset.get(id)!.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    }));
  }, [cases, activeDatasets, activeAgencies]);

  // Yield + altitude bucket counts — only count cases the user could currently
  // see if everything else were active, i.e. respecting the dataset filter
  // (otherwise the numbers would feel disconnected when nuclear-test is off).
  const yieldCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!cases) return m;
    for (const c of cases) {
      if (c.dataset !== "nuclear-test") continue;
      if (typeof c.yieldKt !== "number") {
        m.set(UNKNOWN_YIELD_KEY, (m.get(UNKNOWN_YIELD_KEY) || 0) + 1);
        continue;
      }
      const k = yieldBucketKey(c.yieldKt);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [cases]);

  const altitudeCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!cases) return m;
    for (const c of cases) {
      if (c.dataset !== "nuclear-test") continue;
      const k = altitudeBucketKeyFor(c.subtype || c.type, c.altitudeM);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [cases]);

  const deviceCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!cases) return m;
    for (const c of cases) {
      if (c.dataset !== "nuclear-test") continue;
      const k = deviceBucketKey(c);
      if (k) m.set(k, (m.get(k) || 0) + 1);
      else m.set(UNKNOWN_DEVICE_KEY, (m.get(UNKNOWN_DEVICE_KEY) || 0) + 1);
    }
    return m;
  }, [cases]);

  const stargateTopicCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!cases) return m;
    for (const c of cases) {
      if (c.dataset !== "stargate") continue;
      const k = stargateTopicKey(c);
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [cases]);

  // The yield/altitude rows only make sense when nuclear-test data is on.
  const showNuclearFilters = activeDatasets.has("nuclear-test");
  // The topic row only makes sense when Stargate data is on.
  const showStargateFilters = activeDatasets.has("stargate");

  // A compact one-line summary of active filters, shown next to the title
  // when the filter panel is collapsed so the user can see what's on without
  // re-opening the panel.
  const filterSummary = useMemo(() => {
    if (!cases) return "";
    const parts: string[] = [];
    if (debouncedSearch) parts.push(`"${debouncedSearch}"`);
    parts.push(`${activeDatasets.size}/${DATASET_IDS.length} datasets`);
    if (activeAgencies.size > 0 && cases.length > 0) {
      const totalAgencies = new Set(cases.map((c) => c.agency).filter(Boolean)).size;
      if (activeAgencies.size < totalAgencies) {
        parts.push(`${activeAgencies.size}/${totalAgencies} agencies`);
      }
    }
    if (showNuclearFilters && activeYieldBuckets.size < YIELD_BUCKET_KEYS_ALL.length) {
      parts.push(`${activeYieldBuckets.size}/${YIELD_BUCKET_KEYS_ALL.length} yield`);
    }
    if (showNuclearFilters && activeAltitudeBuckets.size < ALTITUDE_BUCKETS.length) {
      parts.push(`${activeAltitudeBuckets.size}/${ALTITUDE_BUCKETS.length} altitude`);
    }
    if (showNuclearFilters && activeDeviceBuckets.size < DEVICE_BUCKET_KEYS_ALL.length) {
      parts.push(`${activeDeviceBuckets.size}/${DEVICE_BUCKET_KEYS_ALL.length} device`);
    }
    if (showStargateFilters && activeStargateTopics.size < STARGATE_TOPIC_KEYS_ALL.length) {
      parts.push(`${activeStargateTopics.size}/${STARGATE_TOPIC_KEYS_ALL.length} topics`);
    }
    return parts.join(" · ");
  }, [cases, debouncedSearch, activeDatasets, activeAgencies, activeYieldBuckets, activeAltitudeBuckets, activeDeviceBuckets, activeStargateTopics, showNuclearFilters, showStargateFilters]);

  const types = useMemo(() => {
    if (!cases) return [];
    const counts = new Map<string, number>();
    for (const c of cases) {
      if (!c.type) continue;
      counts.set(c.type, (counts.get(c.type) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [cases]);

  // Step 1: filter by dataset + agency + type + yield bucket + altitude bucket.
  // Yield/altitude only constrain cases that actually have those fields. Cases
  // without them (UAP, Stargate, nuclear-incident, nuclear-test of unknown
  // yield/altitude) pass through regardless of which buckets are active.
  const filtered = useMemo(() => {
    if (!cases) return [];
    return cases.filter((c) => {
      if (!activeDatasets.has(c.dataset)) return false;
      if (!activeAgencies.has(c.agency)) return false;
      if (!activeTypes.has(c.type)) return false;
      if (c.dataset === "nuclear-test") {
        if (typeof c.yieldKt === "number") {
          const k = yieldBucketKey(c.yieldKt);
          if (k && !activeYieldBuckets.has(k)) return false;
        } else if (!activeYieldBuckets.has(UNKNOWN_YIELD_KEY)) {
          return false;
        }
      }
      if (c.dataset === "nuclear-test") {
        const k = altitudeBucketKeyFor(c.subtype || c.type, c.altitudeM);
        if (k && !activeAltitudeBuckets.has(k)) return false;
      }
      if (c.dataset === "nuclear-test") {
        const k = deviceBucketKey(c);
        if (k) {
          if (!activeDeviceBuckets.has(k)) return false;
        } else if (!activeDeviceBuckets.has(UNKNOWN_DEVICE_KEY)) {
          return false;
        }
      }
      if (c.dataset === "stargate") {
        const k = stargateTopicKey(c);
        if (k && !activeStargateTopics.has(k)) return false;
      }
      return true;
    });
  }, [cases, activeDatasets, activeAgencies, activeTypes, activeYieldBuckets, activeAltitudeBuckets, activeDeviceBuckets, activeStargateTopics]);

  // Step 2: apply plain-text search across title, description, agency,
  // location, subtype, and id. Case-insensitive substring match — splits the
  // query on whitespace so multiple words can match in any order.
  const searchFiltered = useMemo(() => {
    if (!debouncedSearch) return filtered;
    const tokens = debouncedSearch.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return filtered;

    // Preferred path: MiniSearch ranked ids (field-boosted, prefix, fuzzy),
    // intersected with the active filter set and returned in relevance order.
    const ranked = rankedIds(debouncedSearch);
    if (ranked.length) {
      const allowed = new Set(filtered.map((c) => c.id));
      const byId = new Map(filtered.map((c) => [c.id, c]));
      const out: Case[] = [];
      for (const id of ranked) if (allowed.has(id)) out.push(byId.get(id)!);
      return out;
    }

    // Fallback (index not loaded yet, or zero ranked hits): substring match.
    return filtered.filter((c) => {
      const hay = [
        c.title,
        c.description,
        c.agency,
        c.incidentLocation,
        c.subtype || "",
        c.type,
        c.id,
        // Key figures (STARGATE) so a person chip in the detail panel finds
        // every file that names them, even when the synopsis doesn't.
        ...(c.people || []),
      ]
        .join("  ") // unlikely separator so words from different fields don't accidentally concatenate
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    // searchReadyTick forces recompute once the index finishes loading.
  }, [filtered, debouncedSearch, searchReadyTick]);

  // Step 3: apply date-range filter (from the timeline brush). When active,
  // undated cases drop out of every view since we can't verify they fit.
  const dateFiltered = useMemo(() => {
    if (!xDomain) return searchFiltered;
    const lo = xDomain[0].getTime();
    const hi = xDomain[1].getTime();
    return searchFiltered.filter((c) => {
      if (!c.incidentDate) return false;
      const t = new Date(c.incidentDate).getTime();
      return t >= lo && t <= hi;
    });
  }, [searchFiltered, xDomain]);

  // Step 3: if a notable hotspot is focused, restrict to the cases its
  // matcher predicate identifies. For curated hotspots, the matcher defines
  // the complete scope (no proximity expansion) — the curation already
  // captures the full story.
  const hotspotFiltered = useMemo(() => {
    if (!focusedHotspot) return dateFiltered;
    return dateFiltered.filter(focusedHotspot.matches);
  }, [dateFiltered, focusedHotspot]);

  const filteredWithDate = useMemo(
    () => hotspotFiltered.filter((c) => c.incidentDate),
    [hotspotFiltered],
  );

  const fmtChipDate = (d: Date) =>
    d.toLocaleDateString("en-US", { year: "numeric", month: "short" });

  const toggleAgency = (name: string) => {
    setActiveAgencies((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleType = (name: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleYieldBucket = (key: string) => {
    setActiveYieldBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAltitudeBucket = (key: string) => {
    setActiveAltitudeBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleDeviceBucket = (key: string) => {
    setActiveDeviceBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleStargateTopic = (key: string) => {
    setActiveStargateTopics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleDataset = (id: DatasetId) => {
    setActiveDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <AppBar position="static">
        <Toolbar sx={{ gap: { xs: 1, md: 2 }, alignItems: "center", px: { xs: 1.5, md: 3 } }}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              letterSpacing: "-0.01em",
              fontSize: { xs: 16, md: 20 },
              flexShrink: 0,
            }}
          >
            Off Nominal
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flexShrink: 0, display: { xs: "none", md: "block" } }}
          >
            {cases
              ? `${dateFiltered.length} of ${cases.length} cases`
              : "loading…"}
          </Typography>
          {/* The date range lives in the timeline's own sticky header now.
              Only surface it in the navbar for map-only view, where that
              header isn't on screen. */}
          {xDomain && view === "map" && (
            <Chip
              size="small"
              icon={<EventNoteIcon />}
              label={`${fmtChipDate(xDomain[0])} – ${fmtChipDate(xDomain[1])}`}
              onDelete={() => setXDomain(null)}
              deleteIcon={<CloseIcon />}
              sx={{
                bgcolor: "rgba(122,184,255,0.12)",
                color: "#cfe3ff",
                border: "1px solid rgba(122,184,255,0.4)",
                fontFamily: "JetBrains Mono, monospace",
                display: { xs: "none", sm: "flex" },
                "& .MuiChip-deleteIcon": { color: "#cfe3ff" },
              }}
            />
          )}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              px: 1,
              py: 0.25,
              ml: { xs: 0, sm: 1 },
              borderRadius: 1,
              border: "1px solid",
              borderColor: searchTerm ? "rgba(207,227,255,0.5)" : "rgba(255,255,255,0.14)",
              bgcolor: searchTerm ? "rgba(207,227,255,0.06)" : "rgba(255,255,255,0.03)",
              transition: "border-color 0.15s, background-color 0.15s, width 0.2s",
              flexGrow: { xs: 1, md: 0 },
              width: { md: 240 },
              maxWidth: 320,
              "&:hover": { borderColor: "rgba(207,227,255,0.4)" },
              "&:focus-within": {
                borderColor: "#cfe3ff",
                bgcolor: "rgba(207,227,255,0.08)",
              },
            }}
          >
            <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <InputBase
              inputRef={searchInputRef}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search…"
              sx={{
                color: "text.primary",
                fontSize: 13,
                flexGrow: 1,
                ml: 0.5,
                "& input": { p: 0 },
              }}
              inputProps={{ "aria-label": "Search cases" }}
            />
            {searchTerm ? (
              <IconButton
                size="small"
                onClick={() => setSearchTerm("")}
                sx={{ color: "text.secondary", p: 0.25 }}
                aria-label="Clear search"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            ) : (
              <Typography
                variant="caption"
                sx={{
                  display: { xs: "none", md: "inline" },
                  color: "text.disabled",
                  fontFamily: "JetBrains Mono, monospace",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 0.5,
                  px: 0.5,
                  py: "1px",
                  fontSize: 10,
                }}
              >
                /
              </Typography>
            )}
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title={isMobile ? "Co-occurrences" : (hotspotsCollapsed ? "Show co-occurrences" : "Hide co-occurrences")}>
            <IconButton
              size="small"
              onClick={() => {
                if (isMobile) {
                  setMobileDrawer((d) => (d === "hotspots" ? null : "hotspots"));
                  return;
                }
                const next = !hotspotsCollapsed;
                setHotspotsCollapsed(next);
                if (next) hotspotsPanelRef.current?.collapse();
                else hotspotsPanelRef.current?.expand();
              }}
              sx={{
                color: (isMobile ? mobileDrawer === "hotspots" : !hotspotsCollapsed) ? "#cfe3ff" : "text.secondary",
                bgcolor: (isMobile ? mobileDrawer === "hotspots" : !hotspotsCollapsed) ? "rgba(207,227,255,0.08)" : "transparent",
                border: "1px solid",
                borderColor: (isMobile ? mobileDrawer === "hotspots" : !hotspotsCollapsed) ? "rgba(207,227,255,0.4)" : "rgba(255,255,255,0.12)",
                borderRadius: 1,
              }}
              aria-label="Toggle co-occurrences panel"
            >
              <HubIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {selected && (
            <Tooltip title={isMobile ? "Detail" : (detailCollapsed ? "Show detail panel" : "Hide detail panel")}>
              <IconButton
                size="small"
                onClick={() => {
                  if (isMobile) {
                    setMobileDrawer((d) => (d === "detail" ? null : "detail"));
                    return;
                  }
                  if (detailCollapsed) detailPanelRef.current?.expand();
                  else detailPanelRef.current?.collapse();
                }}
                sx={{
                  color: (isMobile ? mobileDrawer === "detail" : !detailCollapsed) ? "#cfe3ff" : "text.secondary",
                  bgcolor: (isMobile ? mobileDrawer === "detail" : !detailCollapsed) ? "rgba(207,227,255,0.08)" : "transparent",
                  border: "1px solid",
                  borderColor: (isMobile ? mobileDrawer === "detail" : !detailCollapsed) ? "rgba(207,227,255,0.4)" : "rgba(255,255,255,0.12)",
                  borderRadius: 1,
                }}
                aria-label="Toggle detail panel"
              >
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <ToggleButtonGroup
            size="small"
            value={view}
            exclusive
            onChange={(_, v) => v && setView(v)}
            sx={{
              "& .MuiToggleButton-root": {
                px: { xs: 0.75, md: 1.25 },
                py: 0.5,
                textTransform: "none",
                minWidth: { xs: 36, md: "auto" },
              },
            }}
          >
            <ToggleButton value="split" aria-label="Both views">
              <ViewAgendaIcon fontSize="small" sx={{ mr: { xs: 0, md: 0.75 } }} />
              <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>Both</Box>
            </ToggleButton>
            <ToggleButton value="timeline" aria-label="Timeline view">
              <TimelineIcon fontSize="small" sx={{ mr: { xs: 0, md: 0.75 } }} />
              <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>Timeline</Box>
            </ToggleButton>
            <ToggleButton value="map" aria-label="Map view">
              <PublicIcon fontSize="small" sx={{ mr: { xs: 0, md: 0.75 } }} />
              <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>Map</Box>
            </ToggleButton>
          </ToggleButtonGroup>
          {/* App-wide units of measure — drives every distance in the app */}
          <ToggleButtonGroup
            size="small"
            value={units}
            exclusive
            onChange={(_, v) => v && unitsStore.set(v)}
            aria-label="Units of measure"
            sx={{
              "& .MuiToggleButton-root": {
                px: { xs: 0.6, md: 0.9 },
                py: 0.5,
                textTransform: "none",
                minWidth: 32,
              },
            }}
          >
            <ToggleButton value="metric" aria-label="Metric units (m / km)">m</ToggleButton>
            <ToggleButton value="imperial" aria-label="Imperial units (ft / mi)">ft</ToggleButton>
          </ToggleButtonGroup>
          <Button
            size="small"
            onClick={() => setConnectionsOpen(true)}
            variant="outlined"
            startIcon={<HubIcon fontSize="small" />}
            sx={{ textTransform: "none", px: { xs: 1, md: 1.25 }, color: "text.secondary" }}
          >
            <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>Connections</Box>
          </Button>
          <Badge
            badgeContent={caseIds.length}
            color="primary"
            overlap="rectangular"
            sx={{ "& .MuiBadge-badge": { fontWeight: 800, fontFamily: "JetBrains Mono, monospace" } }}
          >
            <Button
              size="small"
              onClick={() => setCasesOpen(true)}
              variant={caseIds.length ? "contained" : "outlined"}
              startIcon={<Inventory2OutlinedIcon fontSize="small" />}
              sx={{
                textTransform: "none",
                px: { xs: 1, md: 1.25 },
                color: caseIds.length ? "#0a0d12" : "text.secondary",
              }}
            >
              <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>Cases</Box>
            </Button>
          </Badge>
          <Link
            href="https://www.war.gov/ufo/"
            target="_blank"
            rel="noopener noreferrer"
            color="text.secondary"
            variant="body2"
            underline="hover"
            sx={{ display: { xs: "none", lg: "inline" } }}
          >
            war.gov/ufo ↗
          </Link>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          backgroundColor: "background.paper",
        }}
      >
        <Box
          {...clickable(() => setFiltersCollapsed((v) => !v))}
          aria-expanded={!filtersCollapsed}
          aria-label="Toggle filters"
          sx={{
            px: { xs: 1.5, md: 3 },
            py: 0.75,
            display: "flex",
            alignItems: "center",
            gap: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: "rgba(255,255,255,0.02)" },
            borderBottom: filtersCollapsed ? "none" : "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <FilterAltIcon fontSize="small" sx={{ color: "text.secondary" }} />
          <Typography
            variant="caption"
            sx={{
              color: "text.primary",
              fontWeight: 700,
              textTransform: "capitalize",
              letterSpacing: "0.08em",
              fontSize: 11,
            }}
          >
            Filters
          </Typography>
          {filtersCollapsed && (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {filterSummary}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {filtersCollapsed ? (
            <ExpandMoreIcon fontSize="small" sx={{ color: "text.secondary" }} />
          ) : (
            <ExpandLessIcon fontSize="small" sx={{ color: "text.secondary" }} />
          )}
        </Box>
        {!filtersCollapsed && (
          <Box
            sx={{
              px: { xs: 1.5, md: 3 },
              py: 1.25,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
        <FilterRow
          label="Dataset"
          items={datasets.map((d) => ({
            key: d.id,
            label: `${d.meta.shortName} · ${d.count.toLocaleString()}${datasetHasGeo(d.id) ? "" : " · timeline only"}`,
            color: d.meta.color,
            active: activeDatasets.has(d.id),
            onClick: () => toggleDataset(d.id),
          }))}
        />
        <FilterRow
          label="Agency"
          items={agencies.map((a) => ({
            key: a.name,
            label: `${AGENCY_SHORT[a.name] || a.name} · ${a.count.toLocaleString()}`,
            color: AGENCY_COLORS[a.name] || "#7ab8ff",
            active: activeAgencies.has(a.name),
            onClick: () => toggleAgency(a.name),
          }))}
        />
        <FilterRow
          label="Media"
          items={types.map((t) => ({
            key: t.name,
            label: `${TYPE_LABELS[t.name] || t.name} · ${t.count}`,
            color: TYPE_COLORS[t.name] || "#9aa5b1",
            active: activeTypes.has(t.name),
            onClick: () => toggleType(t.name),
          }))}
        />
        {showNuclearFilters && (
          <FilterRow
            label="Yield"
            items={[
              ...YIELD_BUCKETS.map((b) => ({
                key: b.key,
                label: `${b.label} · ${(yieldCounts.get(b.key) || 0).toLocaleString()}`,
                color: b.color,
                active: activeYieldBuckets.has(b.key),
                onClick: () => toggleYieldBucket(b.key),
              })),
              {
                key: UNKNOWN_YIELD_KEY,
                label: `Unknown · ${(yieldCounts.get(UNKNOWN_YIELD_KEY) || 0).toLocaleString()}`,
                color: "#7a8595",
                active: activeYieldBuckets.has(UNKNOWN_YIELD_KEY),
                onClick: () => toggleYieldBucket(UNKNOWN_YIELD_KEY),
              },
            ]}
          />
        )}
        {showNuclearFilters && (
          <FilterRow
            label="Altitude"
            items={ALTITUDE_BUCKETS.map((b) => ({
              key: b.key,
              label: `${b.label} · ${(altitudeCounts.get(b.key) || 0).toLocaleString()}`,
              color: b.color,
              active: activeAltitudeBuckets.has(b.key),
              onClick: () => toggleAltitudeBucket(b.key),
            }))}
          />
        )}
        {showNuclearFilters && (
          <FilterRow
            label="Device"
            items={[
              ...DEVICE_TYPE_BUCKETS.map((b) => ({
                key: b.key,
                label: `${b.shortLabel} · ${(deviceCounts.get(b.key) || 0).toLocaleString()}`,
                color: b.color,
                active: activeDeviceBuckets.has(b.key),
                onClick: () => toggleDeviceBucket(b.key),
              })),
              {
                key: UNKNOWN_DEVICE_KEY,
                label: `Unknown · ${(deviceCounts.get(UNKNOWN_DEVICE_KEY) || 0).toLocaleString()}`,
                color: "#7a8595",
                active: activeDeviceBuckets.has(UNKNOWN_DEVICE_KEY),
                onClick: () => toggleDeviceBucket(UNKNOWN_DEVICE_KEY),
              },
            ]}
          />
        )}
        {showStargateFilters && (
          <FilterRow
            label="Topic"
            items={STARGATE_TOPICS.map((b) => ({
              key: b.key,
              label: `${b.label} · ${(stargateTopicCounts.get(b.key) || 0).toLocaleString()}`,
              color: b.color,
              active: activeStargateTopics.has(b.key),
              onClick: () => toggleStargateTopic(b.key),
            }))}
          />
        )}
          </Box>
        )}
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
        {!cases && !error && (
          <Box sx={{ display: "grid", placeItems: "center", height: "100%" }}>
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Box sx={{ display: "grid", placeItems: "center", height: "100%", p: 4, textAlign: "center" }}>
            <Box sx={{ maxWidth: 420 }}>
              <Typography color="error" sx={{ fontWeight: 700, mb: 1 }}>Failed to load data</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{error}</Typography>
              <Button size="small" variant="outlined" onClick={() => location.reload()}>Reload</Button>
            </Box>
          </Box>
        )}
        {cases && !isMobile && (
          <PanelGroup direction="horizontal" autoSaveId="off-nominal-layout">
            <Panel
              ref={hotspotsPanelRef}
              id="hotspots"
              order={1}
              defaultSize={20}
              minSize={14}
              maxSize={35}
              collapsible
              collapsedSize={0}
              onCollapse={() => setHotspotsCollapsed(true)}
              onExpand={() => setHotspotsCollapsed(false)}
            >
              <HotspotsPanel
                allCases={dateFiltered}
                focusedHotspot={focusedHotspot}
                onFocusChange={setFocusedHotspot}
                onCollapse={() => hotspotsPanelRef.current?.collapse()}
                entityIndex={entityIndex}
                onEntity={setFocusedEntityId}
                corpusStats={corpusStats}
                onSelectCase={setSelected}
              />
            </Panel>
            <ResizeHandle />
            <Panel id="main" order={2} minSize={30}>
              <MainContent
                view={view}
                hotspotFiltered={hotspotFiltered}
                dateFiltered={dateFiltered}
                filteredWithDate={filteredWithDate}
                agencyGroups={agencyGroups}
                selected={selected}
                setSelected={setSelected}
                focusedHotspot={focusedHotspot}
                setFocusedHotspot={setFocusedHotspot}
                xDomain={xDomain}
                setXDomain={setXDomain}
              />
            </Panel>
            {selected && (
              <>
                <ResizeHandle />
                <Panel
                  ref={detailPanelRef}
                  id="detail"
                  order={3}
                  defaultSize={26}
                  minSize={18}
                  maxSize={48}
                  collapsible
                  collapsedSize={0}
                  onCollapse={() => setDetailCollapsed(true)}
                  onExpand={() => setDetailCollapsed(false)}
                >
                  <CasePanel
                    kase={selected}
                    allCases={cases}
                    onSelect={setSelected}
                    onClose={() => setSelected(null)}
                    onCollapse={() => detailPanelRef.current?.collapse()}
                    entityIndex={entityIndex}
                    onEntity={setFocusedEntityId}
                    corpusStats={corpusStats}
                  />
                </Panel>
              </>
            )}
          </PanelGroup>
        )}
        {cases && isMobile && (
          <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <MainContent
              view={view}
              hotspotFiltered={hotspotFiltered}
              dateFiltered={dateFiltered}
              filteredWithDate={filteredWithDate}
              agencyGroups={agencyGroups}
              selected={selected}
              setSelected={setSelected}
              focusedHotspot={focusedHotspot}
              setFocusedHotspot={setFocusedHotspot}
              xDomain={xDomain}
              setXDomain={setXDomain}
            />
            <Drawer
              anchor="left"
              open={mobileDrawer === "hotspots"}
              onClose={() => setMobileDrawer(null)}
              PaperProps={{ sx: { width: { xs: "85%", sm: 380 }, maxWidth: 420 } }}
            >
              <HotspotsPanel
                allCases={dateFiltered}
                focusedHotspot={focusedHotspot}
                onFocusChange={(h) => {
                  setFocusedHotspot(h);
                  setMobileDrawer(null);
                }}
                onCollapse={() => setMobileDrawer(null)}
                entityIndex={entityIndex}
                onEntity={(id) => {
                  setFocusedEntityId(id);
                  setMobileDrawer(null);
                }}
                corpusStats={corpusStats}
                onSelectCase={(c) => {
                  setSelected(c);
                  setMobileDrawer(null);
                }}
              />
            </Drawer>
            <Drawer
              anchor="right"
              open={mobileDrawer === "detail" && !!selected}
              onClose={() => setMobileDrawer(null)}
              PaperProps={{ sx: { width: { xs: "92%", sm: 460 }, maxWidth: 540 } }}
            >
              {selected && (
                <CasePanel
                  kase={selected}
                  allCases={cases}
                  onSelect={setSelected}
                  onClose={() => {
                    setSelected(null);
                    setMobileDrawer(null);
                  }}
                  onCollapse={() => setMobileDrawer(null)}
                  entityIndex={entityIndex}
                  onEntity={setFocusedEntityId}
                  corpusStats={corpusStats}
                />
              )}
            </Drawer>
          </Box>
        )}
      </Box>

      <ErrorBoundary label="Cases">
        <CasesOverlay
          open={casesOpen}
          onClose={() => setCasesOpen(false)}
          allCases={cases ?? []}
          entityIndex={entityIndex}
          onEntity={setFocusedEntityId}
          onGenerateBrief={() => { setCasesOpen(false); setBriefOpen(true); }}
          onSelect={(c) => {
            setCasesOpen(false);
            setSelected(c);
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary label="Connections Explorer">
        <ConnectionsExplorer
          open={connectionsOpen}
          onClose={() => setConnectionsOpen(false)}
          allCases={cases ?? []}
          corpusStats={corpusStats}
          onSelect={(c) => {
            setConnectionsOpen(false);
            setSelected(c);
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary label="Investigation Brief">
        <InvestigationBrief
          open={briefOpen}
          onClose={() => setBriefOpen(false)}
          cases={(cases ?? []).filter((c) => caseIds.includes(c.id))}
          corpusStats={corpusStats}
          onSelect={(c) => {
            setBriefOpen(false);
            setCasesOpen(false);
            setSelected(c);
          }}
        />
      </ErrorBoundary>
      {focusedEntityId && entityIndex.byId.get(focusedEntityId) && (
        <EntityPanel
          entity={entityIndex.byId.get(focusedEntityId)!}
          allCases={cases ?? []}
          onClose={() => setFocusedEntityId(null)}
          onSelect={(c) => {
            setFocusedEntityId(null);
            setSelected(c);
          }}
        />
      )}
      <Snackbar
        open={!!loadWarning}
        autoHideDuration={6000}
        onClose={() => setLoadWarning(null)}
        message={loadWarning || ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      />
    </Box>
  );
}

// Extracted center content so the same component renders in both desktop
// (inside a Panel) and mobile (full-width) layouts without duplication.
type MainContentProps = {
  view: ViewMode;
  hotspotFiltered: Case[];
  dateFiltered: Case[];
  filteredWithDate: Case[];
  agencyGroups: React.ComponentProps<typeof Timeline>["groups"];
  selected: Case | null;
  setSelected: (c: Case | null) => void;
  focusedHotspot: NotableHotspot | null;
  setFocusedHotspot: (h: NotableHotspot | null) => void;
  xDomain: [Date, Date] | null;
  setXDomain: (d: [Date, Date] | null) => void;
};

function MainContent({
  view,
  hotspotFiltered,
  dateFiltered,
  filteredWithDate,
  agencyGroups,
  selected,
  setSelected,
  focusedHotspot,
  setFocusedHotspot,
  xDomain,
  setXDomain,
}: MainContentProps) {
  // Empty state — when filters yield zero results, show a helpful message
  // instead of an empty map and timeline.
  const hasData = dateFiltered.length > 0;
  if (!hasData) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          p: 4,
          textAlign: "center",
          color: "text.secondary",
        }}
      >
        <Stack spacing={1.5} alignItems="center" sx={{ maxWidth: 360 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: "text.primary" }}>
            No matching cases
          </Typography>
          <Typography variant="body2">
            Your current filters or search query don&rsquo;t match any records in
            the 2,640-case corpus. Try widening the filters above, clearing your
            search, or removing the date range.
          </Typography>
        </Stack>
      </Box>
    );
  }
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {(view === "map" || view === "split") && (
        <Box
          sx={{
            flex: view === "split" ? "1 1 45%" : "1 1 100%",
            minHeight: 0,
            position: "relative",
            borderBottom:
              view === "split" ? "1px solid rgba(255,255,255,0.08)" : "none",
          }}
        >
          <MapView
            cases={hotspotFiltered}
            allCases={dateFiltered}
            onSelect={setSelected}
            selectedCase={selected}
            focusedHotspot={focusedHotspot}
            onFocusHotspotChange={setFocusedHotspot}
          />
        </Box>
      )}
      {(view === "timeline" || view === "split") && (
        <Box
          sx={{
            flex: view === "split" ? "1 1 55%" : "1 1 100%",
            minHeight: 0,
            position: "relative",
          }}
        >
          <Timeline
            cases={filteredWithDate}
            groups={agencyGroups}
            onSelect={setSelected}
            selectedCase={selected}
            xDomain={xDomain}
            onXDomainChange={setXDomain}
          />
        </Box>
      )}
    </Box>
  );
}

// Vertical resize handle between panels — 4px wide with a visible hairline
// and a slightly brighter hover state. Cursor changes to col-resize on hover.
function ResizeHandle() {
  return (
    <PanelResizeHandle
      className="off-nominal-resize-handle"
      style={{
        width: 6,
        background: "rgba(255,255,255,0.06)",
        cursor: "col-resize",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Center grip dots so users can see the handle. */}
      <div
        style={{
          width: 2,
          height: 28,
          borderRadius: 1,
          background: "rgba(255,255,255,0.18)",
          transition: "background 0.15s",
        }}
      />
    </PanelResizeHandle>
  );
}

type FilterItem = {
  key: string;
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
};

function FilterRow({ label, items }: { label: string; items: FilterItem[] }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 1, md: 2 } }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          minWidth: { xs: 42, md: 56 },
          textTransform: "capitalize",
          letterSpacing: "0.08em",
          fontWeight: 600,
          flexShrink: 0,
          fontSize: { xs: 10, md: 12 },
        }}
      >
        {label}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          flexGrow: 1,
          minWidth: 0,
          flexWrap: { xs: "nowrap", md: "wrap" },
          overflowX: { xs: "auto", md: "visible" },
          // Hide scrollbar for cleaner look on touch devices.
          scrollbarWidth: "thin",
          "&::-webkit-scrollbar": { height: 4 },
          "&::-webkit-scrollbar-thumb": { background: "rgba(255,255,255,0.1)", borderRadius: 2 },
          pb: { xs: 0.5, md: 0 },
        }}
      >
        {items.map((it) => (
          <Chip
            key={it.key}
            label={it.label}
            onClick={it.onClick}
            sx={{
              bgcolor: it.active ? it.color : "transparent",
              color: it.active ? "#0a0d12" : "text.secondary",
              border: `1px solid ${it.color}`,
              fontWeight: 600,
              flexShrink: 0,
              "&:hover": {
                bgcolor: it.active ? it.color : "rgba(255,255,255,0.04)",
              },
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}
