// Renders the case's blast rings on a real OpenStreetMap tile centered on
// the user's current location. Brings the abstract physics down to "this
// much of MY neighborhood is gone" — a viscerally personal scale reference.
//
// The map auto-fits zoom to the outer (1-psi) ring with a comfortable margin
// so the full damage envelope is visible.
//
// Uses Leaflet + OpenStreetMap (free, attribution-required tile server). No
// API key needed. The geolocation prompt is opt-in via the parent BlastDiagram.

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type BlastRing = {
  radiusM: number;
  color: string;
  label: string;
};

type Props = {
  lat: number;
  lng: number;
  rings: BlastRing[];
  /** Fixed height in px. If omitted, the container fills its parent (use a
   *  CSS aspect-ratio or explicit height on the wrapping Box). */
  height?: number;
  /** Label of the ring to visually emphasize (linked to legend hover).
   *  When set, the matching ring gets thicker stroke and full opacity. */
  hoveredLabel?: string | null;
  /** When provided, the map is rendered at this scale (pixels per meter)
   *  rather than auto-fit to the outer ring. Used for tilted-view
   *  integration where the map needs to share its scale with overlaid SVG. */
  pixelsPerMeter?: number;
};

// Pick a zoom level so the largest ring fills ~70% of the map's width.
// `viewportPx` is the diameter we want to see. Adjusted for the map width.
function fitZoomForRadius(lat: number, outerRadiusM: number, mapWidthPx: number): number {
  // Want the outer ring's DIAMETER (2 × radius) to span 70% of the map width.
  const targetDiameterPx = mapWidthPx * 0.7;
  const targetMpp = (2 * outerRadiusM) / targetDiameterPx;
  const z = Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180)) / targetMpp);
  return Math.max(2, Math.min(19, Math.floor(z)));
}

// Compute the Leaflet zoom level that achieves a target pixels-per-meter
// (1/mpp). Used when the map needs to match an externally-defined scale
// (e.g. the SVG ring scale in the tilted view).
function zoomForScale(lat: number, pxPerMeter: number): number {
  // mpp = 1 / pxPerMeter
  // 2^zoom = 156543.03 * cos(lat) / mpp = 156543.03 * cos(lat) * pxPerMeter
  const z = Math.log2(156543.03 * Math.cos((lat * Math.PI) / 180) * pxPerMeter);
  // Leaflet supports fractional zoom; keep some precision for smooth match
  return Math.max(0, Math.min(19, z));
}

// Recenters/zooms the map when lat/lng/rings change. Also invalidates size
// after any container resize so Leaflet recomputes the tile grid (otherwise
// you get gray patches when the map's parent height changes via drag/modal).
function AutoFit({
  lat,
  lng,
  outerRadiusM,
  pixelsPerMeter,
}: {
  lat: number;
  lng: number;
  outerRadiusM: number;
  pixelsPerMeter?: number;
}) {
  const map = useMap();
  useEffect(() => {
    const size = map.getSize();
    const z = pixelsPerMeter
      ? zoomForScale(lat, pixelsPerMeter)
      : fitZoomForRadius(lat, outerRadiusM, size.x || 300);
    map.setView([lat, lng], z, { animate: true });
  }, [lat, lng, outerRadiusM, pixelsPerMeter, map]);

  // Observe the container size and tell Leaflet whenever it changes.
  useEffect(() => {
    const container = map.getContainer();
    if (!container) return;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      const size = map.getSize();
      const z = pixelsPerMeter
        ? zoomForScale(lat, pixelsPerMeter)
        : fitZoomForRadius(lat, outerRadiusM, size.x || 300);
      map.setView([lat, lng], z, { animate: false });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [map, lat, lng, outerRadiusM, pixelsPerMeter]);

  return null;
}

export function LocationMap({ lat, lng, rings, height, hoveredLabel, pixelsPerMeter }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const outerRadiusM = useMemo(
    () => rings.reduce((max, r) => Math.max(max, r.radiusM), 1),
    [rings],
  );
  const initialZoom = pixelsPerMeter
    ? zoomForScale(lat, pixelsPerMeter)
    : fitZoomForRadius(lat, outerRadiusM, 300);

  // If no height was provided, fill the wrapping container (which should set
  // an explicit height or aspect-ratio in CSS).
  const containerStyle: React.CSSProperties = height
    ? { width: "100%", height, position: "relative" }
    : { width: "100%", height: "100%", position: "relative" };

  return (
    <div style={containerStyle}>
      <MapContainer
        center={[lat, lng]}
        zoom={initialZoom}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl={true}
        style={{ width: "100%", height: "100%", background: "#0a0d12" }}
        ref={mapRef as never}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {/* Render rings outer-first so smaller draw on top. The currently
            hovered ring gets a thicker, brighter stroke so it pops above
            the others — visual link to the legend row being hovered. */}
        {[...rings]
          .sort((a, b) => b.radiusM - a.radiusM)
          .map((r) => {
            const isHovered = hoveredLabel === r.label;
            const isFireball = r.label === "Fireball";
            return (
              <Circle
                key={r.label}
                center={[lat, lng]}
                radius={r.radiusM}
                pathOptions={{
                  color: r.color,
                  fillColor: r.color,
                  fillOpacity: isHovered
                    ? (isFireball ? 0.75 : 0.32)
                    : (isFireball ? 0.6 : 0.12),
                  weight: isHovered ? 4 : 1.5,
                  opacity: isHovered ? 1 : (isFireball ? 1 : 0.8),
                }}
              />
            );
          })}
        {/* Tiny marker at exact center so users see where they are */}
        <Circle
          center={[lat, lng]}
          radius={Math.max(20, outerRadiusM * 0.005)}
          pathOptions={{ color: "#ffffff", fillColor: "#ffffff", fillOpacity: 1, weight: 1 }}
        />
        <AutoFit lat={lat} lng={lng} outerRadiusM={outerRadiusM} pixelsPerMeter={pixelsPerMeter} />
      </MapContainer>
    </div>
  );
}
