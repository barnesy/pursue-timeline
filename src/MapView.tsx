import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Popover from "@mui/material/Popover";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import HubIcon from "@mui/icons-material/Hub";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import PublicIcon from "@mui/icons-material/Public";
import CloseIcon from "@mui/icons-material/Close";
import { geoEqualEarth, geoPath, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import "d3-transition"; // augments d3-selection with .transition()
import type { Case } from "./types";
import { AGENCY_COLORS } from "./theme";
import { geocode } from "./locations";
import { getLatLng } from "./proximity";
import type { NotableHotspot } from "./notableHotspots";
import { CaseRow } from "./CaseList";
import { AddToCasesButton } from "./AddToCasesButton";

type Props = {
  /** Cases for marker rendering — pre-filtered by hotspot focus if any. */
  cases: Case[];
  /**
   * All cases (only filtered by App-level chips, NOT by hotspot focus).
   * Used to compute per-hotspot statistics for the sidebar.
   */
  allCases: Case[];
  onSelect: (c: Case) => void;
  selectedCase?: Case | null;
  /** Currently focused notable hotspot, or null. Lifted to App so the
   *  timeline can also filter to the same case set. */
  focusedHotspot: NotableHotspot | null;
  onFocusHotspotChange: (h: NotableHotspot | null) => void;
};

const MARGIN = { top: 24, right: 24, bottom: 24, left: 24 };
const ZOOM_MIN = 1;
const ZOOM_MAX = 32;

type GroupedLocation = {
  key: string;
  display: string;
  lat: number;
  lng: number;
  cases: Case[];
  dominantAgency: string;
};

type WorldTopo = {
  type: "Topology";
  objects: { countries: unknown };
  arcs: unknown[];
  transform?: unknown;
};

export function MapView({
  cases,
  allCases,
  onSelect,
  selectedCase,
  focusedHotspot,
  onFocusHotspotChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ width: 1200, height: 600 });
  const [world, setWorld] = useState<GeoJSON.FeatureCollection | null>(null);
  // Popover state — handles BOTH single-location markers and clusters.
  // For single markers we show the cases at that location; for clusters we
  // show all member locations with their cases (so the user can pick exactly
  // even when zooming further won't separate them).
  const [popover, setPopover] = useState<
    | { kind: "single"; anchor: SVGCircleElement; group: GroupedLocation }
    | { kind: "cluster"; anchor: SVGCircleElement; members: GroupedLocation[]; centroid: { cx: number; cy: number } }
    | null
  >(null);
  // Zoom state mirrors d3-zoom's transform — drives all rendering inside the
  // map's <g> container. k = scale, (x, y) = translation in SVG pixels.
  const [zoomState, setZoomState] = useState({ k: 1, x: 0, y: 0 });

  // Resize observer
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Load TopoJSON once
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}world-110m.json`)
      .then((r) => r.json() as Promise<WorldTopo>)
      .then((topo) => {
        const fc = feature(
          topo as never,
          (topo as never as { objects: { countries: never } }).objects.countries,
        ) as unknown as GeoJSON.FeatureCollection;
        setWorld(fc);
      });
  }, []);

  // `cases` is already hotspot-filtered by App (so the timeline + map stay
  // in sync). We just use it directly for marker rendering. `allCases`
  // provides the unfiltered set for computing the Hotspots panel itself.
  const mapCases = cases;

  // Helper: group a set of cases by geographic point. Used twice — once on
  // `mapCases` for marker rendering, once on `allCases` for hotspot list.
  const groupCases = useCallback((source: Case[]): GroupedLocation[] => {
    const map = new Map<
      string,
      { display: string; lat: number; lng: number; cases: Case[] }
    >();
    for (const c of source) {
      let lat: number;
      let lng: number;
      let display: string;
      let key: string;

      if (typeof c.lat === "number" && typeof c.lng === "number") {
        const rlat = Math.round(c.lat * 2) / 2;
        const rlng = Math.round(c.lng * 2) / 2;
        key = `geo:${rlat.toFixed(1)},${rlng.toFixed(1)}`;
        lat = rlat;
        lng = rlng;
        display = c.incidentLocation || `(${rlat.toFixed(1)}, ${rlng.toFixed(1)})`;
      } else {
        const g = geocode(c.incidentLocation);
        if (!g || g.offWorld) continue;
        key = `str:${c.incidentLocation.trim()}`;
        lat = g.lat;
        lng = g.lng;
        display = g.display;
      }
      const entry = map.get(key) ?? { display, lat, lng, cases: [] };
      entry.cases.push(c);
      map.set(key, entry);
    }
    return [...map.entries()].map(([key, e]) => {
      const counts = new Map<string, number>();
      for (const c of e.cases) counts.set(c.agency, (counts.get(c.agency) || 0) + 1);
      const dominantAgency =
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return { key, ...e, dominantAgency };
    });
  }, []);

  // Group cases by geographic point. Nuclear tests carry direct lat/lng on
  // each Case; UAP cases use the string-based geocoder in locations.ts.
  // Direct-lat/lng cases are bucketed at ~0.5° (~55 km) resolution so a
  // hundred Semipalatinsk tests at slightly different coords collapse into
  // one marker rather than rendering as a black blob of overlapping circles.
  const groups = useMemo(() => groupCases(mapCases), [mapCases, groupCases]);

  // Zoom-aware marker clustering — merges markers that visually overlap at the
  // current zoom level. Returns an array of display markers, each either a
  // single original group or a "cluster" representing multiple merged groups.
  //
  // The clustering distance threshold is fixed in SCREEN pixels (currently
  // 60px). In pre-transform pixel space (which is what `projection()` returns)
  // we divide by zoom_k so that the threshold scales correctly. As the user
  // zooms in, the effective world-space threshold shrinks, so clusters
  // naturally break apart.
  type DisplayMarker =
    | { kind: "single"; group: GroupedLocation; cx: number; cy: number }
    | {
        kind: "cluster";
        members: GroupedLocation[];
        cx: number;
        cy: number;
        totalCount: number;
        dominantAgency: string;
      };

  const offWorldCount = useMemo(() => {
    return cases.filter((c) => {
      const g = geocode(c.incidentLocation);
      return g?.offWorld;
    }).length;
  }, [mapCases, allCases]);

  const offWorldBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cases) {
      const g = geocode(c.incidentLocation);
      if (!g?.offWorld) continue;
      counts.set(g.display, (counts.get(g.display) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [mapCases, allCases]);

  // Projection fitted to viewport at k=1. Zoom transform is applied SEPARATELY
  // via the SVG group's transform attribute — projection itself never changes.
  const projection = useMemo<GeoProjection | null>(() => {
    if (!world || size.width < 100) return null;
    const proj = geoEqualEarth();
    proj.fitExtent(
      [
        [MARGIN.left, MARGIN.top],
        [size.width - MARGIN.right, size.height - MARGIN.bottom],
      ],
      { type: "Sphere" } as never,
    );
    return proj;
  }, [world, size]);

  const pathGen = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  // Zoom-aware clustering (declared here so it can reference projection).
  const displayMarkers = useMemo<DisplayMarker[]>(() => {
    if (!projection) return [];
    const thresholdWorld = 60 / Math.max(0.1, zoomState.k);
    const positioned: Array<{ group: GroupedLocation; cx: number; cy: number }> = [];
    for (const g of groups) {
      const xy = projection([g.lng, g.lat]);
      if (!xy) continue;
      positioned.push({ group: g, cx: xy[0], cy: xy[1] });
    }
    // Sort by case count descending so big markers act as cluster anchors.
    positioned.sort((a, b) => b.group.cases.length - a.group.cases.length);
    type Cluster = { members: GroupedLocation[]; cx: number; cy: number; totalCount: number };
    const clusters: Cluster[] = [];
    for (const m of positioned) {
      let nearest = -1;
      let nearestDist = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        const c = clusters[i];
        const d = Math.hypot(m.cx - c.cx, m.cy - c.cy);
        if (d < thresholdWorld && d < nearestDist) {
          nearest = i;
          nearestDist = d;
        }
      }
      if (nearest === -1) {
        clusters.push({
          members: [m.group],
          cx: m.cx,
          cy: m.cy,
          totalCount: m.group.cases.length,
        });
      } else {
        const c = clusters[nearest];
        const newCases = m.group.cases.length;
        const newTotal = c.totalCount + newCases;
        c.cx = (c.cx * c.totalCount + m.cx * newCases) / newTotal;
        c.cy = (c.cy * c.totalCount + m.cy * newCases) / newTotal;
        c.totalCount = newTotal;
        c.members.push(m.group);
      }
    }
    return clusters.map<DisplayMarker>((c) => {
      if (c.members.length === 1) {
        return { kind: "single", group: c.members[0], cx: c.cx, cy: c.cy };
      }
      const agencyCounts = new Map<string, number>();
      for (const g of c.members) {
        for (const cs of g.cases) {
          agencyCounts.set(cs.agency, (agencyCounts.get(cs.agency) || 0) + 1);
        }
      }
      const dominantAgency =
        [...agencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return {
        kind: "cluster",
        members: c.members,
        cx: c.cx,
        cy: c.cy,
        totalCount: c.totalCount,
        dominantAgency,
      };
    });
  }, [groups, projection, zoomState.k]);

  // Lookup: which group contains the selected case (for fly-to + highlight).
  const highlightedGroupKey = useMemo(() => {
    if (!selectedCase) return null;
    for (const g of groups) {
      if (g.cases.some((c) => c.id === selectedCase.id)) return g.key;
    }
    return null;
  }, [selectedCase, groups]);

  // Wire d3-zoom to the SVG. Re-attached when size changes so the new
  // viewport extent is honored. The behavior is stored on a ref so the
  // flyTo effect can call .transform() on it imperatively.
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const zoom = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .translateExtent([
        [-size.width * 0.5, -size.height * 0.5],
        [size.width * 1.5, size.height * 1.5],
      ])
      .filter((event: Event) => {
        // Don't start a pan when clicking on a marker — marker onClick still
        // needs to fire. The filter receives the original DOM event.
        const target = event.target as Element | null;
        if (event.type === "mousedown" && target?.tagName === "circle") return false;
        return true;
      })
      .on("zoom", (event) => {
        const t = event.transform;
        setZoomState({ k: t.k, x: t.x, y: t.y });
      });
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);
    // No teardown — leaving the listener attached across re-renders is fine.
    return () => {
      svg.on(".zoom", null);
    };
  }, [size.width, size.height]);

  // Fly-to-selected effect. When the selected case changes to one with a
  // resolvable geo point, animate the map's zoom transform so that point
  // lands in the viewport center.
  useEffect(() => {
    if (!selectedCase || !projection || !svgRef.current || !zoomBehaviorRef.current) return;
    const ll = getLatLng(selectedCase);
    if (!ll) return;
    const xy = projection([ll.lng, ll.lat]);
    if (!xy) return;
    const [cx, cy] = xy;
    // Pick a comfortable zoom level — keep current zoom if already zoomed in,
    // otherwise pop to k=5 (regional view).
    const targetK = Math.max(5, zoomState.k);
    const tx = size.width / 2 - cx * targetK;
    const ty = size.height / 2 - cy * targetK;
    const t = zoomIdentity.translate(tx, ty).scale(targetK);
    select(svgRef.current)
      .transition()
      .duration(750)
      .call(zoomBehaviorRef.current.transform as never, t as never);
    // We intentionally do NOT include zoomState in deps — we only want to
    // fly when the selection itself changes, not every pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCase, projection, size.width, size.height]);

  const setZoomLevel = (k: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const clampedK = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k));
    // Zoom around viewport center
    const cx = size.width / 2;
    const cy = size.height / 2;
    // Current world-space coords at the center
    const wx = (cx - zoomState.x) / zoomState.k;
    const wy = (cy - zoomState.y) / zoomState.k;
    const tx = cx - wx * clampedK;
    const ty = cy - wy * clampedK;
    select(svgRef.current)
      .transition()
      .duration(250)
      .call(
        zoomBehaviorRef.current.transform as never,
        zoomIdentity.translate(tx, ty).scale(clampedK) as never,
      );
  };

  const resetZoom = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    select(svgRef.current)
      .transition()
      .duration(450)
      .call(zoomBehaviorRef.current.transform as never, zoomIdentity as never);
  };

  const isZoomed = Math.abs(zoomState.k - 1) > 0.001 || Math.abs(zoomState.x) > 0.5 || Math.abs(zoomState.y) > 0.5;
  // Counter-scale factor: keeps markers and labels legible at any zoom level.
  // Using sqrt(k) means moderate growth at high zoom (visible) without bloat.
  const inv = 1 / Math.sqrt(zoomState.k);


  const flyToLatLng = useCallback(
    (lat: number, lng: number, targetK = 5) => {
      if (!projection || !svgRef.current || !zoomBehaviorRef.current) return;
      const xy = projection([lng, lat]);
      if (!xy) return;
      const [cx, cy] = xy;
      const tx = size.width / 2 - cx * targetK;
      const ty = size.height / 2 - cy * targetK;
      select(svgRef.current)
        .transition()
        .duration(750)
        .call(
          zoomBehaviorRef.current.transform as never,
          zoomIdentity.translate(tx, ty).scale(targetK) as never,
        );
    },
    [projection, size],
  );

  // Hotspot focus is now driven externally (from HotspotsPanel via App).
  // React to changes here by flying the map to the selected location, or
  // resetting to the world fit when focus clears.
  useEffect(() => {
    if (focusedHotspot) {
      flyToLatLng(
        focusedHotspot.center.lat,
        focusedHotspot.center.lng,
        focusedHotspot.zoom ?? 5,
      );
    } else if (svgRef.current && zoomBehaviorRef.current) {
      select(svgRef.current)
        .transition()
        .duration(450)
        .call(zoomBehaviorRef.current.transform as never, zoomIdentity as never);
    }
    // We intentionally depend only on focusedHotspot.id — re-running on every
    // flyToLatLng identity change would double-fire when other things change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedHotspot?.id]);

  const clearHotspotFocus = useCallback(() => {
    onFocusHotspotChange(null);
  }, [onFocusHotspotChange]);

  return (
    <Box ref={wrapRef} sx={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        style={{ display: "block", cursor: isZoomed ? "grab" : "default" }}
      >
        {/* Everything inside this group is pan/zoom-transformed. Markers
            counter-scale so they stay legible. Country strokes use
            vector-effect="non-scaling-stroke" to stay 1px regardless of zoom. */}
        <g transform={`translate(${zoomState.x},${zoomState.y}) scale(${zoomState.k})`}>
          {/* Sphere outline */}
          {pathGen && (
            <path
              d={pathGen({ type: "Sphere" } as never) || ""}
              fill="#0d141d"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Country fills */}
          {world &&
            pathGen &&
            (world.features as GeoJSON.Feature[]).map((f, i) => (
              <path
                key={i}
                d={pathGen(f) || ""}
                fill="#1a2330"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}

          {/* Cluster markers — render before single markers so they sit
              underneath any pulsing highlights etc. */}
          {projection &&
            displayMarkers
              .filter((m): m is Extract<DisplayMarker, { kind: "cluster" }> => m.kind === "cluster")
              .map((c) => {
                const cx = c.cx;
                const cy = c.cy;
                const baseRadius = Math.max(10, Math.min(28, Math.sqrt(c.totalCount) * 3));
                const radius = baseRadius * inv;
                const color = AGENCY_COLORS[c.dominantAgency] || "#7ab8ff";
                return (
                  <g key={`cluster-${cx.toFixed(2)}-${cy.toFixed(2)}-${c.members.length}`} style={{ cursor: "pointer" }}>
                    {/* Outer ring identifies this as a cluster (not a single marker) */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius + 5 * inv}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.6}
                      strokeWidth={1.5}
                      strokeDasharray={`${4 * inv} ${3 * inv}`}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    {/* Solid colored core */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={color}
                      fillOpacity={0.85}
                      stroke="#ffffff"
                      strokeOpacity={0.9}
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      onClick={(e) => {
                        // At low/medium zoom, clusters represent visually-
                        // overlapping markers that will separate on zoom in.
                        // At high zoom (or near max), zooming further won't
                        // disambiguate — show a case-picker popover instead.
                        if (zoomState.k < 6) {
                          if (!svgRef.current || !zoomBehaviorRef.current) return;
                          const targetK = Math.min(ZOOM_MAX, zoomState.k * 2);
                          const tx = size.width / 2 - cx * targetK;
                          const ty = size.height / 2 - cy * targetK;
                          select(svgRef.current)
                            .transition()
                            .duration(450)
                            .call(
                              zoomBehaviorRef.current.transform as never,
                              zoomIdentity.translate(tx, ty).scale(targetK) as never,
                            );
                        } else {
                          setPopover({
                            kind: "cluster",
                            anchor: e.currentTarget as SVGCircleElement,
                            members: c.members,
                            centroid: { cx, cy },
                          });
                        }
                      }}
                    >
                      <title>
                        {zoomState.k < 6
                          ? `${c.members.length} locations · ${c.totalCount} cases — click to zoom in`
                          : `${c.members.length} locations · ${c.totalCount} cases — click to pick`}
                      </title>
                    </circle>
                    {/* Count */}
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#0a0d12"
                      fontSize={Math.max(10, Math.min(14, baseRadius * 0.7)) * inv}
                      fontWeight={700}
                      pointerEvents="none"
                    >
                      {c.totalCount}
                    </text>
                  </g>
                );
              })}

          {/* Single (un-clustered) markers */}
          {projection &&
            displayMarkers
              .filter((m): m is Extract<DisplayMarker, { kind: "single" }> => m.kind === "single")
              .map(({ group: g, cx, cy }) => {
              const baseRadius = Math.max(4, Math.min(22, Math.sqrt(g.cases.length) * 4));
              const radius = baseRadius * inv;
              const color = AGENCY_COLORS[g.dominantAgency] || "#7ab8ff";
              const isHighlighted = g.key === highlightedGroupKey;
              return (
                <g key={g.key} style={{ cursor: "pointer" }}>
                  {/* Highlight pulse ring on the selected case's marker */}
                  {isHighlighted && (
                    <>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={radius + 10 * inv}
                        fill="none"
                        stroke="#ffffff"
                        strokeOpacity={0.85}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      >
                        <animate
                          attributeName="r"
                          values={`${radius + 8 * inv};${radius + 18 * inv};${radius + 8 * inv}`}
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="stroke-opacity"
                          values="0.85;0.2;0.85"
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    </>
                  )}
                  {/* halo */}
                  <circle cx={cx} cy={cy} r={radius + 4 * inv} fill={color} fillOpacity={0.12} />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={color}
                    fillOpacity={0.65}
                    stroke={color}
                    strokeOpacity={0.95}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    onClick={(e) =>
                      setPopover({ kind: "single", anchor: e.currentTarget as SVGCircleElement, group: g })
                    }
                  >
                    <title>{`${g.display} — ${g.cases.length} case${g.cases.length === 1 ? "" : "s"}`}</title>
                  </circle>
                  {g.cases.length > 1 && (
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#0a0d12"
                      fontSize={Math.max(9, Math.min(14, baseRadius * 0.85)) * inv}
                      fontWeight={700}
                      pointerEvents="none"
                    >
                      {g.cases.length}
                    </text>
                  )}
                </g>
              );
            })}
        </g>
      </svg>

      {/* Active filter banner — appears at the top center when a hotspot
          is focused so the user knows the map is filtered + can clear it. */}
      {focusedHotspot && (
        <Box
          sx={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            bgcolor: "rgba(207,227,255,0.18)",
            border: "1px solid rgba(207,227,255,0.5)",
            borderRadius: 1,
            px: 1.5,
            py: 0.5,
            display: "flex",
            alignItems: "center",
            gap: 1,
            zIndex: 10,
            maxWidth: "70%",
          }}
        >
          <HubIcon fontSize="small" sx={{ color: "#cfe3ff" }} />
          <Typography variant="caption" sx={{ color: "#cfe3ff", fontWeight: 600 }}>
            Focused: {focusedHotspot.title}
          </Typography>
          <IconButton
            size="small"
            onClick={clearHotspotFocus}
            sx={{ color: "#cfe3ff", p: 0.25 }}
            title="Clear focus"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Zoom controls — top-right stack, below off-world badge */}
      <Box
        sx={{
          position: "absolute",
          top: 16,
          right: offWorldCount > 0 ? 268 : 16,
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
          bgcolor: "rgba(10,13,18,0.85)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 1,
          p: 0.25,
        }}
      >
        <Tooltip title="Zoom in" placement="left">
          <IconButton size="small" onClick={() => setZoomLevel(zoomState.k * 1.6)} sx={{ color: "text.primary" }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out" placement="left">
          <IconButton
            size="small"
            onClick={() => setZoomLevel(zoomState.k / 1.6)}
            disabled={zoomState.k <= ZOOM_MIN + 0.001}
            sx={{ color: "text.primary" }}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit world" placement="left">
          <span>
            <IconButton size="small" onClick={resetZoom} disabled={!isZoomed} sx={{ color: "text.primary" }}>
              <PublicIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Off-world badge */}
      {offWorldCount > 0 && (
        <Box
          sx={{
            position: "absolute",
            top: 16,
            right: 16,
            bgcolor: "rgba(10,13,18,0.85)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 1,
            px: 1.5,
            py: 1,
            maxWidth: 240,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Off-world · {offWorldCount}
          </Typography>
          <Stack spacing={0.25} sx={{ mt: 0.5 }}>
            {offWorldBreakdown.map(([name, n]) => (
              <Typography
                key={name}
                variant="caption"
                sx={{ display: "block", color: "text.primary", fontSize: 11 }}
              >
                {name} · {n}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}

      {/* Marker popover with case list */}
      <Popover
        open={!!popover}
        anchorEl={popover?.anchor ?? null}
        onClose={() => setPopover(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        slotProps={{
          paper: {
            sx: {
              bgcolor: "background.paper",
              border: "1px solid rgba(255,255,255,0.1)",
              maxWidth: 360,
              p: 1.5,
            },
          },
        }}
      >
        {popover && popover.kind === "single" && (
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              {popover.group.display}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {popover.group.cases.length} case
              {popover.group.cases.length === 1 ? "" : "s"}
            </Typography>
            <Stack spacing={0.5} sx={{ maxHeight: 320, overflowY: "auto" }}>
              {popover.group.cases
                .slice()
                .sort((a, b) =>
                  (a.incidentDate || "9999").localeCompare(b.incidentDate || "9999"),
                )
                .map((c) => (
                  <CaseRow
                    key={c.id}
                    kase={c}
                    onSelect={(x) => {
                      onSelect(x);
                      setPopover(null);
                    }}
                    trailing={<AddToCasesButton kase={c} />}
                  />
                ))}
            </Stack>
          </Box>
        )}
        {popover && popover.kind === "cluster" && (() => {
          const totalCases = popover.members.reduce((s, m) => s + m.cases.length, 0);
          const totalLocations = popover.members.length;
          // Flatten cases with their group info, sort by date
          type Row = { case: Case; group: GroupedLocation };
          const rows: Row[] = [];
          for (const g of popover.members) {
            for (const c of g.cases) rows.push({ case: c, group: g });
          }
          rows.sort((a, b) =>
            (a.case.incidentDate || "9999").localeCompare(b.case.incidentDate || "9999"),
          );
          return (
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.25 }}>
                {totalCases} cases at {totalLocations} location{totalLocations === 1 ? "" : "s"}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Click a case to open it, or zoom further to separate.
              </Typography>
              <Stack spacing={0.5} sx={{ maxHeight: 360, overflowY: "auto" }}>
                {rows.map(({ case: c, group: g }) => (
                  <CaseRow
                    key={c.id}
                    kase={c}
                    location={g.display}
                    onSelect={(x) => {
                      onSelect(x);
                      setPopover(null);
                    }}
                    trailing={<AddToCasesButton kase={c} />}
                  />
                ))}
              </Stack>
              <Box sx={{ mt: 1, pt: 1, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <Button
                  size="small"
                  fullWidth
                  variant="outlined"
                  onClick={() => {
                    if (!svgRef.current || !zoomBehaviorRef.current || !popover) return;
                    const targetK = Math.min(ZOOM_MAX, zoomState.k * 2);
                    const tx = size.width / 2 - popover.centroid.cx * targetK;
                    const ty = size.height / 2 - popover.centroid.cy * targetK;
                    select(svgRef.current)
                      .transition()
                      .duration(450)
                      .call(
                        zoomBehaviorRef.current.transform as never,
                        zoomIdentity.translate(tx, ty).scale(targetK) as never,
                      );
                    setPopover(null);
                  }}
                  sx={{ textTransform: "none", fontSize: 11 }}
                >
                  Zoom in further
                </Button>
              </Box>
            </Box>
          );
        })()}
      </Popover>

      {/* Empty state */}
      {!world && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "text.secondary",
            fontSize: 13,
          }}
        >
          Loading world map…
        </Box>
      )}

      {/* Bottom-left footnote */}
      <Box
        sx={{
          position: "absolute",
          bottom: 12,
          left: 16,
          color: "text.secondary",
          fontSize: 11,
          fontStyle: "italic",
          maxWidth: "60%",
        }}
      >
        Locations are approximate. Drag to pan · scroll to zoom · click a case to fly to it.
      </Box>
    </Box>
  );
}

