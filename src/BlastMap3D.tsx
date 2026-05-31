// Blast rings + full detonation animation on a *real* 3D map camera
// (MapLibre GL JS). The animated phenomena — bomber + banner, bomb drop,
// flash, fireball, mushroom-cloud smoke plumes, shockwave, damage rings and
// markers — are the EXACT `TiltedView` SVG scene from BlastDiagram, rendered
// as a transparent overlay on top of the live map (TiltedView's `mapEnabled`
// mode skips its own sky/ground so the map shows through). This makes the 3D
// map animation a faithful mirror of the tilted SVG animation, reusing the
// same plumes and the same 10 s timeline.
//
// The MapLibre map underneath provides the real ground: OSM streets / Esri
// satellite / 3D terrain / 3D buildings — all free, no API key. The camera is
// pitched to ~62° so the map's foreshortening roughly matches TiltedView's
// axonometric TILT_RATIO (0.45 ≈ cos 63°), and centered on ground zero.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import circle from "@turf/circle";
import type { Feature, Polygon } from "geojson";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Button from "@mui/material/Button";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ReplayIcon from "@mui/icons-material/Replay";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import TerrainIcon from "@mui/icons-material/Terrain";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";
import ApartmentIcon from "@mui/icons-material/Apartment";
import {
  TiltedView,
  ANIM_DURATION,
  PRE_FLIGHT_DURATION,
  TILT_W,
  TILT_H,
  TILT_HORIZON_Y,
  TILT_RATIO,
} from "./BlastDiagram";
import type { DetonationEnv, UnitSystem } from "./blastPhysics";

export type DamageRing = { key: string; label: string; radiusM: number; color: string };

type Props = {
  lat: number;
  lng: number;
  env: DetonationEnv;
  hobM: number;
  fireballM: number;
  shockwavePeakM: number;
  damageRings: DamageRing[];
  hoveredRingKey?: string | null;
  units?: UnitSystem;
};

// No-API-key tile sources.
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_SAT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TERRAIN_DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const OPENFREEMAP = "https://tiles.openfreemap.org/planet";

// Pitch chosen so the map ground foreshortening ≈ TiltedView's TILT_RATIO.
const MAP_PITCH = 62;

// TiltedView scene geometry (its own viewBox units). The burst sits here, and
// rings are drawn at radiusM × S_tv units from it. We anchor + scale the whole
// scene onto the map so it tracks the camera (see updateSceneTransform).
//
// NOTE: computed lazily inside a function rather than at module top-level —
// BlastDiagram and this module import each other, so the TILT_* consts aren't
// initialized yet while this module first evaluates (temporal dead zone).
function sceneGeom() {
  const burstX = TILT_W / 2;
  const burstY = TILT_HORIZON_Y + (TILT_H - TILT_HORIZON_Y) * 0.45;
  const maxRx = (TILT_W - 80) / 2;
  const maxRy = Math.min(burstY - TILT_HORIZON_Y - 8, TILT_H - burstY - 16);
  return { burstX, burstY, maxRx, maxRy };
}
// TiltedView's internal scale (viewBox units per meter) for a given outer ring.
function sceneScalePerMeter(outerRadiusM: number): number {
  const { maxRx, maxRy } = sceneGeom();
  return Math.min(maxRx, maxRy / TILT_RATIO) / Math.max(1, outerRadiusM);
}
// Web-Mercator ground scale at a latitude/zoom: CSS px per meter.
function mapPxPerMeter(lat: number, zoom: number): number {
  return Math.pow(2, zoom) / (156543.03392 * Math.cos((lat * Math.PI) / 180));
}

function buildStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      osm: { type: "raster", tiles: [OSM_TILES], tileSize: 256, attribution: "© OpenStreetMap contributors", maxzoom: 19 },
      satellite: { type: "raster", tiles: [ESRI_SAT], tileSize: 256, attribution: "Imagery © Esri, Maxar, Earthstar Geographics", maxzoom: 19 },
      terrainDEM: { type: "raster-dem", tiles: [TERRAIN_DEM], tileSize: 256, encoding: "terrarium", maxzoom: 15 },
      openfreemap: { type: "vector", url: OPENFREEMAP },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0a0d12" } },
      { id: "osm", type: "raster", source: "osm", layout: { visibility: "visible" } },
      { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
    ],
  };
}

// Fit the camera so the outer ring fits, biased so ground zero lands ~59% down
// the view (matching TiltedView's burst position) — leaving sky room above for
// the rising mushroom cloud.
function fitToOuter(map: maplibregl.Map, lat: number, lng: number, outerRadiusM: number) {
  // Frame the outer ring with extra margin (zoomed out a little) for context.
  const ring = circle([lng, lat], (outerRadiusM * 2.1) / 1000, { steps: 24, units: "kilometers" }) as Feature<Polygon>;
  const coords = ring.geometry.coordinates[0] as [number, number][];
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  const h = map.getContainer().clientHeight || 400;
  map.fitBounds(bounds, {
    // Heavier top padding pushes ground zero toward the lower-middle so the
    // cloud has headroom — matching the SVG scene's burst placement.
    padding: { top: Math.round(h * 0.34), bottom: Math.round(h * 0.06), left: 40, right: 40 },
    pitch: MAP_PITCH,
    bearing: 0,
    duration: 700,
    maxZoom: 16,
  });
}

export function BlastMap3D({
  lat,
  lng,
  env,
  hobM,
  fireballM,
  shockwavePeakM,
  damageRings,
  hoveredRingKey,
  units,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const sceneGroupRef = useRef<SVGGElement | null>(null);
  const [basemap, setBasemap] = useState<"osm" | "satellite">("osm");
  const [terrainOn, setTerrainOn] = useState(false);
  const [buildingsOn, setBuildingsOn] = useState(true);
  const [ready, setReady] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [rawTime, setRawTime] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const ringsKey = useMemo(
    () => damageRings.map((r) => `${r.key}:${Math.round(r.radiusM)}`).join("|"),
    [damageRings],
  );
  const outerRadiusM = useMemo(
    () => Math.max(fireballM * 4, ...damageRings.map((r) => r.radiusM), 1),
    [ringsKey, fireballM], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Latest values the (once-attached) camera handler needs, behind a ref.
  const anchorRef = useRef({ lat, lng, sTv: sceneScalePerMeter(outerRadiusM) });
  useEffect(() => {
    anchorRef.current = { lat, lng, sTv: sceneScalePerMeter(outerRadiusM) };
  }, [lat, lng, outerRadiusM]);

  // Anchor + scale the TiltedView scene onto the map: place its burst at ground
  // zero's live screen position and scale it by the map's true px/m, so the
  // whole animation tracks pan/zoom. Applied imperatively (no React re-render).
  const updateSceneTransform = useCallback(() => {
    const map = mapRef.current;
    const g = sceneGroupRef.current;
    if (!map || !g) return;
    const { lat: aLat, lng: aLng, sTv } = anchorRef.current;
    const { burstX, burstY } = sceneGeom();
    const p = map.project([aLng, aLat]); // GZ in CSS px
    const k = mapPxPerMeter(aLat, map.getZoom()) / sTv; // px per viewBox unit
    g.setAttribute("transform", `translate(${p.x - burstX * k} ${p.y - burstY * k}) scale(${k})`);
  }, []);

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center: [lng, lat],
      zoom: 12,
      pitch: MAP_PITCH,
      bearing: 0,
      attributionControl: { compact: true },
      maxPitch: 85,
    });
    mapRef.current = map;
    // Zoom only via the on-screen +/- buttons; lock the map north-up.
    map.scrollZoom.disable();
    map.doubleClickZoom.disable();
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation?.();
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    // Keep the overlay glued to ground zero + map scale on any camera change.
    map.on("move", updateSceneTransform);

    map.on("load", () => {
      map.addLayer({
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "openfreemap",
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": "#8a93a3",
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, ["coalesce", ["get", "render_height"], 8]],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
      });
      setReady(true);
      fitToOuter(map, lat, lng, outerRadiusM);
      updateSceneTransform();
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter/refit when the case or location changes (reset the animation too).
  useEffect(() => {
    if (!ready) return;
    setPlaying(false);
    setRawTime(0);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: [lng, lat], duration: 600 });
      fitToOuter(map, lat, lng, outerRadiusM);
    }
  }, [lat, lng, ringsKey, ready, outerRadiusM]);

  // Animation loop — drives rawTime from 0 (bomber inbound) through ANIM_DURATION.
  useEffect(() => {
    if (!playing || !ready) return;
    const loop = () => {
      const t = ((performance.now() - startRef.current) / 1000) * speedRef.current;
      if (t >= ANIM_DURATION) {
        setRawTime(ANIM_DURATION);
        setPlaying(false);
        rafRef.current = null;
        return;
      }
      setRawTime(t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, ready]);

  // Layer toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("osm", "visibility", basemap === "osm" ? "visible" : "none");
    map.setLayoutProperty("satellite", "visibility", basemap === "satellite" ? "visible" : "none");
  }, [basemap, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setTerrain(terrainOn ? { source: "terrainDEM", exaggeration: 1.4 } : null);
  }, [terrainOn, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("buildings-3d")) return;
    map.setLayoutProperty("buildings-3d", "visibility", buildingsOn ? "visible" : "none");
  }, [buildingsOn, ready]);

  const handlePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const startT = rawTime >= ANIM_DURATION ? 0 : rawTime;
    startRef.current = performance.now() - (startT / speed) * 1000;
    setRawTime(startT);
    setPlaying(true);
  }, [playing, rawTime, speed]);

  const handleRestart = useCallback(() => {
    setRawTime(0);
    startRef.current = performance.now();
    setPlaying(true);
  }, []);

  const changeSpeed = useCallback(
    (s: number) => {
      if (playing) startRef.current = performance.now() - (rawTime / s) * 1000;
      setSpeed(s);
    },
    [playing, rawTime],
  );

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (map) fitToOuter(map, lat, lng, outerRadiusM);
  }, [lat, lng, outerRadiusM]);

  const detT = rawTime - PRE_FLIGHT_DURATION;
  const tLabel = detT < 0 ? `T− ${(-detT).toFixed(1)} s` : `T+ ${detT < 10 ? detT.toFixed(1) : Math.round(detT)} s`;
  const subLabel = detT < 0 ? "bomber inbound" : "detonation";

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100%", minHeight: 360 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", borderRadius: 4 }} />

      {/* The EXACT TiltedView animation, overlaid transparently on the map.
          preserveAspectRatio="none" stretches the 800×480 scene to the
          container so the burst point tracks the camera-centered ground zero. */}
      {/* No viewBox: 1 user unit = 1 CSS px. The inner <g> is positioned and
          scaled imperatively (updateSceneTransform) so the scene's burst point
          sits at ground zero and rings scale with the map's px/m. */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1, overflow: "visible" }}>
        <g ref={sceneGroupRef}>
          <TiltedView
            env={env}
            hobM={hobM}
            fireballM={fireballM}
            time={rawTime}
            shockwavePeakM={shockwavePeakM}
            damageRings={damageRings}
            hoveredRingKey={hoveredRingKey}
            units={units}
            mapEnabled
          />
        </g>
      </svg>

      {/* Layer controls (top-left) */}
      <Box sx={{ position: "absolute", top: 8, left: 8, zIndex: 2, display: "flex", flexDirection: "column", gap: 0.75 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={basemap}
          onChange={(_, v) => v && setBasemap(v)}
          sx={{ bgcolor: "rgba(10,13,18,0.85)", "& .MuiToggleButton-root": { px: 1, py: 0.3, fontSize: 10 } }}
        >
          <ToggleButton value="osm">Streets</ToggleButton>
          <ToggleButton value="satellite">
            <SatelliteAltIcon sx={{ fontSize: 13, mr: 0.5 }} /> Satellite
          </ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          <ToggleButton size="small" value="terrain" selected={terrainOn} onChange={() => setTerrainOn((x) => !x)} sx={{ bgcolor: "rgba(10,13,18,0.85)", px: 1, py: 0.3, fontSize: 10 }}>
            <TerrainIcon sx={{ fontSize: 13, mr: 0.5 }} /> Terrain
          </ToggleButton>
          <ToggleButton size="small" value="buildings" selected={buildingsOn} onChange={() => setBuildingsOn((x) => !x)} sx={{ bgcolor: "rgba(10,13,18,0.85)", px: 1, py: 0.3, fontSize: 10 }}>
            <ApartmentIcon sx={{ fontSize: 13, mr: 0.5 }} /> Buildings
          </ToggleButton>
          <Button size="small" variant="contained" startIcon={<MyLocationIcon sx={{ fontSize: 14 }} />} onClick={recenter} sx={{ textTransform: "none", fontSize: 10, py: 0.3 }}>
            Recenter
          </Button>
        </Box>
      </Box>

      {/* Animation transport (bottom, centered) */}
      <Box
        sx={{
          position: "absolute",
          bottom: 10,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          py: 0.6,
          borderRadius: 2,
          bgcolor: "rgba(10,13,18,0.88)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <IconButton size="small" onClick={handlePlay} sx={{ color: "#cfe3ff" }} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon sx={{ fontSize: 18 }} /> : <PlayArrowIcon sx={{ fontSize: 18 }} />}
        </IconButton>
        <IconButton size="small" onClick={handleRestart} sx={{ color: "text.secondary" }} aria-label="Restart">
          <ReplayIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <Stack sx={{ minWidth: 110 }}>
          <Typography sx={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{tLabel}</Typography>
          <Typography sx={{ fontSize: 9, color: "text.secondary", lineHeight: 1.1 }}>{subLabel}</Typography>
        </Stack>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={speed}
          onChange={(_, v) => v && changeSpeed(v)}
          sx={{ "& .MuiToggleButton-root": { px: 0.75, py: 0.15, fontSize: 9, color: "text.secondary" } }}
        >
          <ToggleButton value={0.5}>0.5×</ToggleButton>
          <ToggleButton value={1}>1×</ToggleButton>
          <ToggleButton value={2}>2×</ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </Box>
  );
}
