// Two tiny inline graphs for showing yield (tonnage) and altitude per case
// in dense case lists (the map's cluster popover, the cross-dataset nearby
// list in the detail panel).
//
// Both render at ~70px × 10px. They share a visual grammar:
//   - thin horizontal track for the full range
//   - filled segment or a tick mark indicating this case's value
//   - color matches the bucket from App.tsx filter chips (so a megaton case
//     reads "red" both in the filter row and here)
//
// Yield uses log10 because nuclear yields span 5+ orders of magnitude.
// Altitude uses a piecewise-linear scale with 5 named bands so the tick
// position is interpretable at a glance ("just past 'tower' is low air").

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { fmtDistance, type UnitSystem } from "./blastPhysics";
import { useUnits } from "./units";

// ---- Yield ---------------------------------------------------------------

// Match the App.tsx bucket palette so the chip color and sparkline fill
// agree at-a-glance. Six tiers from sub-kt to super-megaton (≥10 Mt).
function yieldColor(kt: number): string {
  if (kt < 1) return "#5fc3b5";
  if (kt < 20) return "#f0c93c";
  if (kt < 200) return "#f08a3a";
  if (kt < 1000) return "#d9533a";
  if (kt < 10_000) return "#e8413a";
  return "#b03060";
}

// Map kt → [0..1] via log scale. Anchors: 0.01 kt (sub-kiloton fizzles) → 0,
// 50 Mt (Tsar Bomba) → 1. Anything beyond clamps.
const Y_MIN_LOG = Math.log10(0.01); // -2
const Y_MAX_LOG = Math.log10(50_000); // 4.7

function yieldToFrac(kt: number): number {
  if (kt <= 0) return 0;
  const f = (Math.log10(kt) - Y_MIN_LOG) / (Y_MAX_LOG - Y_MIN_LOG);
  return Math.max(0, Math.min(1, f));
}

function fmtKt(kt: number): string {
  if (kt < 1) return `${kt.toFixed(2)} kt`;
  if (kt >= 1000) return `${(kt / 1000).toFixed(kt >= 10_000 ? 0 : 1)} Mt`;
  return `${kt < 10 ? kt.toFixed(1) : Math.round(kt)} kt`;
}

export function YieldSparkline({ kt, ktUpper }: { kt: number; ktUpper?: number }) {
  const W = 64;
  const H = 8;
  const f1 = yieldToFrac(kt);
  const f2 = ktUpper ? yieldToFrac(ktUpper) : f1;
  const color = yieldColor(kt);
  const label =
    ktUpper && ktUpper !== kt
      ? `${fmtKt(kt)}–${fmtKt(ktUpper)}`
      : fmtKt(kt);
  return (
    <Tooltip title={`Yield: ${label}`} placement="top">
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          flexShrink: 0,
        }}
      >
        <svg width={W} height={H} style={{ display: "block" }}>
          {/* Track */}
          <rect
            x={0}
            y={H / 2 - 1}
            width={W}
            height={2}
            rx={1}
            fill="rgba(255,255,255,0.1)"
          />
          {/* Bucket tick marks at each App.tsx YIELD_BUCKETS boundary
              (1 kt, 20 kt, 200 kt, 1 Mt, 10 Mt). Drawn faintly so the user
              can read the bucket boundaries without overpowering the dot. */}
          {[1, 20, 200, 1000, 10_000].map((kBound) => {
            const x = yieldToFrac(kBound) * W;
            return (
              <line
                key={kBound}
                x1={x}
                x2={x}
                y1={1}
                y2={H - 1}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={0.6}
              />
            );
          })}
          {/* Filled range (lower → upper for ranged yields, else a single dot). */}
          {ktUpper && ktUpper !== kt ? (
            <rect
              x={f1 * W}
              y={H / 2 - 2}
              width={Math.max(2, (f2 - f1) * W)}
              height={4}
              rx={2}
              fill={color}
            />
          ) : (
            <circle cx={f1 * W} cy={H / 2} r={3} fill={color} />
          )}
        </svg>
        <Typography
          variant="caption"
          sx={{
            fontSize: 9.5,
            color: "text.secondary",
            fontFamily: "JetBrains Mono, monospace",
            minWidth: 48,
          }}
        >
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
}

// ---- Altitude ------------------------------------------------------------

// 5-segment scale that matches the App.tsx altitude buckets exactly so the
// tick position lines up with the filter chip the user just toggled.
//   Underground  | Surface | Tower (≤200m) | Air (≤30km) | Exo (>30km)
// Each band gets equal screen width — much more readable than a real-scale
// signed log, where 90% of bursts crowd into a tiny sliver near 0.
type Band = { key: string; label: string; color: string };
const BANDS: Band[] = [
  { key: "underground", label: "Underground", color: "#8a6a4a" },
  { key: "surface",     label: "Surface",     color: "#d9b48a" },
  { key: "tower",       label: "Tower",       color: "#f0c93c" },
  { key: "air",         label: "Air burst",   color: "#7ab8ff" },
  { key: "exo",         label: "Exo",         color: "#c8b9ff" },
];

function altitudeBandIndex(m: number, typeStr: string): number {
  // Type-string heuristics first (matches App.tsx altitudeBucketKeyFor).
  if (/ROCKET/.test(typeStr)) return 4;
  if (/AIRDROP|BALLOON|ATMOSPH/.test(typeStr)) return 3;
  if (/TOWER/.test(typeStr)) return 2;
  if (/SURFACE|BARGE|SHIP|UNDERWATER|^UW$/.test(typeStr)) return 1;
  if (/SHAFT|TUNNEL|^UG$|CRATER/.test(typeStr)) return 0;
  // Fallback to the numeric value.
  if (m > 30_000) return 4;
  if (m > 200) return 3;
  if (m > 0) return 2;
  if (m === 0) return 1;
  return 0;
}

function fmtAltitudeShort(m: number, units: UnitSystem): string {
  if (m === 0) return "surface";
  const d = fmtDistance(Math.abs(m), units);
  return m > 0 ? `+${d}` : `−${d}`;
}

export function AltitudeSparkline({
  altM,
  typeStr,
}: {
  altM: number | undefined;
  typeStr: string;
}) {
  const units = useUnits();
  const W = 60;
  const H = 8;
  const idx = altitudeBandIndex(altM ?? 0, typeStr);
  const segW = W / BANDS.length;
  const fullLabel =
    typeof altM === "number"
      ? `${BANDS[idx].label} · ${fmtAltitudeShort(altM, units)}`
      : BANDS[idx].label;
  return (
    <Tooltip title={`Altitude: ${fullLabel}`} placement="top">
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          flexShrink: 0,
        }}
      >
        <svg width={W} height={H} style={{ display: "block" }}>
          {BANDS.map((b, i) => {
            const isActive = i === idx;
            return (
              <rect
                key={b.key}
                x={i * segW + 0.5}
                y={H / 2 - 2}
                width={segW - 1}
                height={4}
                rx={1}
                fill={isActive ? b.color : "rgba(255,255,255,0.08)"}
                stroke={isActive ? "rgba(255,255,255,0.4)" : "none"}
                strokeWidth={0.5}
              />
            );
          })}
        </svg>
        <Typography
          variant="caption"
          sx={{
            fontSize: 9.5,
            color: "text.secondary",
            fontFamily: "JetBrains Mono, monospace",
            minWidth: 56,
          }}
        >
          {typeof altM === "number" ? fmtAltitudeShort(altM, units) : BANDS[idx].label.toLowerCase()}
        </Typography>
      </Box>
    </Tooltip>
  );
}
