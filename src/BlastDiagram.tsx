// Visual "feel the scale" diagram for a single nuclear test or incident.
// Renders:
//   1. Header: yield + comparison to a famous test (Hiroshima / Bravo / etc.)
//   2. Side-view silhouette showing the burst environment (air / surface /
//      underground / underwater / rocket) — purely schematic, not to scale
//   3. Top-down concentric damage rings drawn to scale within the canvas
//   4. A legend table mapping ring colors to damage levels with absolute radii
//   5. Footnote with a familiar-size comparison for the largest ring

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ReplayIcon from "@mui/icons-material/Replay";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseIcon from "@mui/icons-material/Close";
import Dialog from "@mui/material/Dialog";
import Tooltip from "@mui/material/Tooltip";
import type { Case } from "./types";
import {
  computeBlastEffects,
  detonationEnv,
  fmtDistance,
  familiarSize,
  compareYield,
  type DetonationEnv,
  type UnitSystem,
} from "./blastPhysics";
import { useAnimationFrame, prefersReducedMotion } from "./useAnimationFrame";
import { useUnits } from "./units";
import { LocationMap, type BlastRing } from "./LocationMap";
// Lazy-loaded: pulls maplibre-gl (the heaviest dependency) into its own chunk
// so it only downloads when the user actually opens the 3D map.
const BlastMap3D = lazy(() => import("./BlastMap3D").then((m) => ({ default: m.BlastMap3D })));
const Map3DFallback = (
  <Box sx={{ height: "100%", minHeight: 320, display: "grid", placeItems: "center", color: "text.secondary", fontSize: 13 }}>
    Loading 3D map…
  </Box>
);
import TerrainIcon from "@mui/icons-material/Terrain";

type Props = { kase: Case };

const SVG_W = 300;
// Side-view height — damage flags now live ABOVE ground in the sky band
// (poles 18-54 px tall), and below-ground only needs the scale-ref label
// rows. 170 gives headroom for the mushroom cloud while keeping a usable
// ground band for the dirt and labels.
const SIDE_H = 170;
const RING_H = 220;
// Animation timeline length, in seconds. All blasts are compressed into the
// same duration regardless of yield (real-world timing varies hugely).
// Total animation duration includes a 4-second pre-flight phase where
// the B-52 flies across the screen at a calmer pace and drops the bomb.
// The detonation timeline itself is still 6 seconds, starting at
// t=PRE_FLIGHT_DURATION.
export const PRE_FLIGHT_DURATION = 4;
export const ANIM_DURATION = 6 + PRE_FLIGHT_DURATION;

// Real-world reference objects with verified dimensions. The diagram picks
// 2-3 of these whose heights bracket the fireball diameter to give an
// intuitive sense of scale.
export type DamageState = "intact" | "damaged" | "destroyed";

type RefObject = {
  name: string;
  // Height in meters (vertical extent on the diagram).
  heightM: number;
  // Width in meters (how wide it looks from the side).
  widthM: number;
  // SVG drawer — receives (x, baseY, pxPerMeter, state) and returns an SVG element.
  // baseY is the ground line; objects sit on it.
  draw: (x: number, baseY: number, pxPerM: number, state: DamageState) => React.ReactNode;
};

const PERSON: RefObject = {
  name: "person",
  heightM: 1.7,
  widthM: 0.5,
  draw: (x, baseY, s, state) => {
    if (state === "destroyed") return null; // vaporized
    const h = 1.7 * s;
    if (state === "damaged") {
      // Slumped, rotated
      return (
        <g key="person" transform={`rotate(70 ${x} ${baseY})`}>
          <circle cx={x} cy={baseY - h + 3 * s} r={Math.max(1, 0.25 * s)} fill="#7a8595" />
          <rect x={x - 0.2 * s} y={baseY - h + 0.5 * s} width={0.4 * s} height={1.2 * s} fill="#7a8595" />
        </g>
      );
    }
    return (
      <g key="person">
        <circle cx={x} cy={baseY - h + 3 * s} r={Math.max(1, 0.25 * s)} fill="#e6ecf2" />
        <rect x={x - 0.2 * s} y={baseY - h + 0.5 * s} width={0.4 * s} height={1.2 * s} fill="#e6ecf2" />
      </g>
    );
  },
};

const HOUSE: RefObject = {
  name: "2-story house",
  heightM: 8,
  widthM: 10,
  draw: (x, baseY, s, state) => {
    const w = 10 * s;
    const wallH = 5 * s;
    const roofH = 3 * s;
    if (state === "destroyed") {
      // Rubble pile — low jagged silhouette
      return (
        <g key="house">
          <polygon
            points={`${x - w / 2},${baseY} ${x - w * 0.3},${baseY - wallH * 0.3} ${x - w * 0.1},${baseY - wallH * 0.15} ${x + w * 0.2},${baseY - wallH * 0.4} ${x + w / 2},${baseY}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    if (state === "damaged") {
      return (
        <g key="house">
          <rect x={x - w / 2} y={baseY - wallH} width={w} height={wallH} fill="#7a8595" />
          {/* Roof tilted off */}
          <polygon
            points={`${x - w / 2 - 2 * s},${baseY - wallH + roofH * 0.3} ${x + w * 0.2},${baseY - wallH - roofH * 0.6} ${x - w * 0.1},${baseY - wallH}`}
            fill="#5a6373"
          />
          {/* Crack on wall */}
          <line x1={x - w * 0.1} x2={x + w * 0.2} y1={baseY - wallH + 1 * s} y2={baseY - 1 * s} stroke="#2a2a2a" strokeWidth={Math.max(0.5, 0.2 * s)} />
        </g>
      );
    }
    return (
      <g key="house">
        <rect x={x - w / 2} y={baseY - wallH} width={w} height={wallH} fill="#a3aebd" />
        <polygon
          points={`${x - w / 2},${baseY - wallH} ${x + w / 2},${baseY - wallH} ${x},${baseY - wallH - roofH}`}
          fill="#7a8595"
        />
      </g>
    );
  },
};

const BUILDING: RefObject = {
  name: "6-story building",
  heightM: 20,
  widthM: 18,
  draw: (x, baseY, s, state) => {
    const w = 18 * s;
    const h = 20 * s;
    if (state === "destroyed") {
      // Mostly rubble with a few jagged remnants of the lowest floor
      return (
        <g key="building">
          <polygon
            points={`${x - w / 2},${baseY} ${x - w * 0.4},${baseY - h * 0.18} ${x - w * 0.1},${baseY - h * 0.1} ${x + w * 0.15},${baseY - h * 0.25} ${x + w * 0.35},${baseY - h * 0.12} ${x + w / 2},${baseY}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    if (state === "damaged") {
      // Top 2 floors missing, jagged top
      const remainingH = h * 0.6;
      return (
        <g key="building">
          <rect x={x - w / 2} y={baseY - remainingH} width={w} height={remainingH} fill="#7a8595" />
          {/* Jagged top */}
          <polygon
            points={`${x - w / 2},${baseY - remainingH} ${x - w * 0.3},${baseY - remainingH - 2 * s} ${x - w * 0.05},${baseY - remainingH} ${x + w * 0.2},${baseY - remainingH - 3 * s} ${x + w * 0.4},${baseY - remainingH - 1 * s} ${x + w / 2},${baseY - remainingH}`}
            fill="#5a6373"
          />
          {/* Surviving windows (some broken — black squares with X) */}
          {Array.from({ length: 4 }).map((_, row) =>
            Array.from({ length: 4 }).map((_, col) => {
              const broken = (row + col) % 3 === 0;
              return (
                <rect
                  key={`${row}-${col}`}
                  x={x - w / 2 + (col + 0.5) * (w / 5) - w / 16}
                  y={baseY - remainingH + (row + 0.5) * (remainingH / 5) - h / 24}
                  width={w / 8}
                  height={h / 10}
                  fill={broken ? "#000000" : "#3a4250"}
                />
              );
            }),
          )}
        </g>
      );
    }
    return (
      <g key="building">
        <rect x={x - w / 2} y={baseY - h} width={w} height={h} fill="#7a8595" />
        {/* window grid */}
        {Array.from({ length: 6 }).map((_, row) =>
          Array.from({ length: 4 }).map((_, col) => (
            <rect
              key={`${row}-${col}`}
              x={x - w / 2 + (col + 0.5) * (w / 5) - w / 16}
              y={baseY - h + (row + 0.5) * (h / 7) - h / 20}
              width={w / 8}
              height={h / 10}
              fill="#3a4250"
            />
          )),
        )}
      </g>
    );
  },
};

const SKYSCRAPER: RefObject = {
  name: "Empire State Building",
  heightM: 381,
  widthM: 130,
  draw: (x, baseY, s, state) => {
    const w = 130 * s;
    const h = 381 * s;
    const spireH = 60 * s;
    const tier1 = 80 * s;
    if (state === "destroyed") {
      // Just the base tier left
      return (
        <g key="skyscraper">
          <rect x={x - w / 2} y={baseY - tier1 * 0.6} width={w} height={tier1 * 0.6} fill="#5a6373" />
          {/* Jagged top of base */}
          <polygon
            points={`${x - w / 2},${baseY - tier1 * 0.6} ${x - w * 0.2},${baseY - tier1 * 0.6 - 3 * s} ${x + w * 0.1},${baseY - tier1 * 0.6} ${x + w * 0.3},${baseY - tier1 * 0.6 - 5 * s} ${x + w / 2},${baseY - tier1 * 0.6}`}
            fill="#3a4250"
          />
        </g>
      );
    }
    if (state === "damaged") {
      // Spire gone, top tier broken
      return (
        <g key="skyscraper">
          <rect x={x - w / 2} y={baseY - tier1} width={w} height={tier1} fill="#7a8595" />
          {/* Middle tier (shorter) */}
          <rect x={x - w * 0.35} y={baseY - h * 0.65} width={w * 0.7} height={h * 0.65 - tier1} fill="#7a8595" />
          {/* Jagged top */}
          <polygon
            points={`${x - w * 0.35},${baseY - h * 0.65} ${x - w * 0.1},${baseY - h * 0.65 - 4 * s} ${x + w * 0.1},${baseY - h * 0.65} ${x + w * 0.35},${baseY - h * 0.65 - 2 * s}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    return (
      <g key="skyscraper">
        {/* Wide base */}
        <rect x={x - w / 2} y={baseY - tier1} width={w} height={tier1} fill="#a3aebd" />
        {/* Stepped middle */}
        <rect x={x - w * 0.35} y={baseY - h + spireH} width={w * 0.7} height={h - tier1 - spireH} fill="#a3aebd" />
        {/* Spire */}
        <rect x={x - w * 0.06} y={baseY - h + spireH - spireH * 0.7} width={w * 0.12} height={spireH * 0.7} fill="#a3aebd" />
        <line x1={x} x2={x} y1={baseY - h + spireH * 0.3} y2={baseY - h - spireH * 0.4} stroke="#a3aebd" strokeWidth={Math.max(1, 0.5 * s)} />
      </g>
    );
  },
};

const BURJ: RefObject = {
  name: "Burj Khalifa",
  heightM: 828,
  widthM: 90,
  draw: (x, baseY, s, state) => {
    const w = 90 * s;
    const h = 828 * s;
    if (state === "destroyed") {
      // Stub
      return (
        <g key="burj">
          <polygon
            points={`${x - w / 2},${baseY} ${x + w / 2},${baseY} ${x + w / 3},${baseY - h * 0.12} ${x - w / 3},${baseY - h * 0.12}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    if (state === "damaged") {
      // Top spire and upper third missing
      return (
        <g key="burj">
          <polygon
            points={`${x - w / 2},${baseY} ${x + w / 2},${baseY} ${x + w / 4},${baseY - h * 0.55} ${x - w / 4},${baseY - h * 0.55}`}
            fill="#7a8595"
          />
          {/* Jagged top */}
          <polygon
            points={`${x - w / 4},${baseY - h * 0.55} ${x - w / 8},${baseY - h * 0.55 - 3 * s} ${x},${baseY - h * 0.55} ${x + w / 8},${baseY - h * 0.55 - 5 * s} ${x + w / 4},${baseY - h * 0.55}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    return (
      <g key="burj">
        {/* Tapered tower body */}
        <polygon
          points={`${x - w / 2},${baseY} ${x + w / 2},${baseY} ${x + w / 6},${baseY - h * 0.85} ${x - w / 6},${baseY - h * 0.85}`}
          fill="#a3aebd"
        />
        {/* Spire */}
        <line x1={x} x2={x} y1={baseY - h * 0.85} y2={baseY - h} stroke="#a3aebd" strokeWidth={Math.max(1, 0.8 * s)} />
      </g>
    );
  },
};

const EVEREST: RefObject = {
  name: "Mt Everest",
  heightM: 8848,
  widthM: 5000,
  draw: (x, baseY, s, state) => {
    const w = 5000 * s;
    const h = 8848 * s;
    // Even tsar-class yields don't fundamentally "destroy" a mountain, but
    // a near-miss might scorch the peak. We only differentiate destroyed.
    if (state === "destroyed") {
      // Decapitated — peak missing
      return (
        <g key="everest">
          <polygon
            points={`${x - w / 2},${baseY} ${x + w / 2},${baseY} ${x + w * 0.18},${baseY - h * 0.6} ${x - w * 0.18},${baseY - h * 0.6}`}
            fill="#5a6373"
          />
          {/* Jagged crater rim */}
          <polygon
            points={`${x - w * 0.18},${baseY - h * 0.6} ${x - w * 0.1},${baseY - h * 0.55} ${x},${baseY - h * 0.62} ${x + w * 0.1},${baseY - h * 0.57} ${x + w * 0.18},${baseY - h * 0.6}`}
            fill="#3a4250"
          />
        </g>
      );
    }
    return (
      <g key="everest">
        <polygon
          points={`${x - w / 2},${baseY} ${x + w / 2},${baseY} ${x + w / 8},${baseY - h * 0.4} ${x},${baseY - h} ${x - w / 8},${baseY - h * 0.4}`}
          fill="#5a6373"
        />
        {/* Snow cap */}
        <polygon
          points={`${x - w / 12},${baseY - h * 0.55} ${x + w / 12},${baseY - h * 0.55} ${x + w / 8},${baseY - h * 0.4} ${x},${baseY - h} ${x - w / 8},${baseY - h * 0.4}`}
          fill="#e6ecf2"
        />
      </g>
    );
  },
};

// Mid-tier city silhouettes — fill the gap between single-family homes and
// iconic skyscrapers so the diagram reads as "a city" not "5 disconnected
// objects".

const SUBURBAN_HOUSE: RefObject = {
  name: "suburban house",
  heightM: 6,
  widthM: 12,
  draw: (x, baseY, s, state) => {
    const w = 12 * s;
    const wallH = 4 * s;
    const roofH = 2.5 * s;
    if (state === "destroyed") {
      return (
        <g key="suburban">
          <polygon
            points={`${x - w / 2},${baseY} ${x - w * 0.2},${baseY - wallH * 0.4} ${x + w * 0.1},${baseY - wallH * 0.2} ${x + w / 2},${baseY}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    if (state === "damaged") {
      return (
        <g key="suburban">
          <rect x={x - w / 2} y={baseY - wallH} width={w} height={wallH} fill="#8995a8" />
          {/* Roof partially collapsed */}
          <polygon
            points={`${x - w / 2 - 1 * s},${baseY - wallH + roofH * 0.5} ${x + w * 0.3},${baseY - wallH - roofH * 0.5} ${x},${baseY - wallH}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    return (
      <g key="suburban">
        <rect x={x - w / 2} y={baseY - wallH} width={w} height={wallH} fill="#b6c0cf" />
        <polygon
          points={`${x - w / 2},${baseY - wallH} ${x + w / 2},${baseY - wallH} ${x},${baseY - wallH - roofH}`}
          fill="#7a8595"
        />
        {/* Door */}
        <rect x={x - 0.5 * s} y={baseY - wallH * 0.6} width={1 * s} height={wallH * 0.6} fill="#3a4250" />
      </g>
    );
  },
};

const LOW_RISE: RefObject = {
  name: "5-story low-rise",
  heightM: 16,
  widthM: 22,
  draw: (x, baseY, s, state) => {
    const w = 22 * s;
    const h = 16 * s;
    if (state === "destroyed") {
      return (
        <g key="lowrise">
          <polygon
            points={`${x - w / 2},${baseY} ${x - w * 0.35},${baseY - h * 0.2} ${x},${baseY - h * 0.1} ${x + w * 0.3},${baseY - h * 0.25} ${x + w / 2},${baseY}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    if (state === "damaged") {
      const remH = h * 0.55;
      return (
        <g key="lowrise">
          <rect x={x - w / 2} y={baseY - remH} width={w} height={remH} fill="#7a8595" />
          <polygon
            points={`${x - w / 2},${baseY - remH} ${x - w * 0.2},${baseY - remH - 2 * s} ${x + w * 0.3},${baseY - remH} ${x + w * 0.45},${baseY - remH - 1.5 * s} ${x + w / 2},${baseY - remH}`}
            fill="#5a6373"
          />
          {/* Some broken windows */}
          {Array.from({ length: 3 }).map((_, row) =>
            Array.from({ length: 4 }).map((_, col) => {
              const broken = (row + col) % 2 === 0;
              return (
                <rect
                  key={`${row}-${col}`}
                  x={x - w / 2 + (col + 0.5) * (w / 5) - w / 18}
                  y={baseY - remH + (row + 0.5) * (remH / 4) - h / 26}
                  width={w / 9}
                  height={h / 12}
                  fill={broken ? "#000" : "#3a4250"}
                />
              );
            }),
          )}
        </g>
      );
    }
    return (
      <g key="lowrise">
        <rect x={x - w / 2} y={baseY - h} width={w} height={h} fill="#8c98ac" />
        {/* Window grid */}
        {Array.from({ length: 5 }).map((_, row) =>
          Array.from({ length: 4 }).map((_, col) => (
            <rect
              key={`${row}-${col}`}
              x={x - w / 2 + (col + 0.5) * (w / 5) - w / 18}
              y={baseY - h + (row + 0.5) * (h / 6) - h / 24}
              width={w / 9}
              height={h / 14}
              fill="#3a4250"
            />
          )),
        )}
        {/* Cornice */}
        <rect x={x - w / 2 - 1 * s} y={baseY - h - 1 * s} width={w + 2 * s} height={1 * s} fill="#7a8595" />
      </g>
    );
  },
};

const MID_RISE: RefObject = {
  name: "15-story mid-rise",
  heightM: 50,
  widthM: 25,
  draw: (x, baseY, s, state) => {
    const w = 25 * s;
    const h = 50 * s;
    if (state === "destroyed") {
      return (
        <g key="midrise">
          <polygon
            points={`${x - w / 2},${baseY} ${x - w * 0.35},${baseY - h * 0.18} ${x},${baseY - h * 0.08} ${x + w * 0.3},${baseY - h * 0.22} ${x + w / 2},${baseY}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    if (state === "damaged") {
      const remH = h * 0.55;
      return (
        <g key="midrise">
          <rect x={x - w / 2} y={baseY - remH} width={w} height={remH} fill="#7a8595" />
          <polygon
            points={`${x - w / 2},${baseY - remH} ${x - w * 0.15},${baseY - remH - 3 * s} ${x + w * 0.2},${baseY - remH} ${x + w * 0.4},${baseY - remH - 2 * s} ${x + w / 2},${baseY - remH}`}
            fill="#5a6373"
          />
        </g>
      );
    }
    return (
      <g key="midrise">
        <rect x={x - w / 2} y={baseY - h} width={w} height={h} fill="#b6c0cf" />
        {/* Vertical column lines */}
        {[0.25, 0.5, 0.75].map((f, i) => (
          <line key={i} x1={x - w / 2 + w * f} x2={x - w / 2 + w * f} y1={baseY - h} y2={baseY} stroke="#8c98ac" strokeWidth={Math.max(0.4, 0.2 * s)} />
        ))}
        {/* Window strips */}
        {Array.from({ length: 12 }).map((_, row) => (
          <rect key={row} x={x - w / 2 + 1 * s} y={baseY - h + (row + 1) * (h / 13)} width={w - 2 * s} height={h / 40} fill="#3a4250" />
        ))}
      </g>
    );
  },
};

const OFFICE_TOWER: RefObject = {
  name: "40-story office tower",
  heightM: 150,
  widthM: 40,
  draw: (x, baseY, s, state) => {
    const w = 40 * s;
    const h = 150 * s;
    if (state === "destroyed") {
      return (
        <g key="office">
          <rect x={x - w / 2} y={baseY - h * 0.12} width={w} height={h * 0.12} fill="#5a6373" />
          <polygon
            points={`${x - w / 2},${baseY - h * 0.12} ${x - w * 0.2},${baseY - h * 0.18} ${x + w * 0.1},${baseY - h * 0.12} ${x + w * 0.4},${baseY - h * 0.16} ${x + w / 2},${baseY - h * 0.12}`}
            fill="#3a4250"
          />
        </g>
      );
    }
    if (state === "damaged") {
      const remH = h * 0.5;
      return (
        <g key="office">
          <rect x={x - w / 2} y={baseY - remH} width={w} height={remH} fill="#7a8595" />
          <polygon
            points={`${x - w / 2},${baseY - remH} ${x - w * 0.1},${baseY - remH - 4 * s} ${x + w * 0.1},${baseY - remH} ${x + w * 0.35},${baseY - remH - 2 * s} ${x + w / 2},${baseY - remH}`}
            fill="#5a6373"
          />
          {/* Smoke */}
          <ellipse cx={x + w * 0.2} cy={baseY - remH - 6 * s} rx={w * 0.3} ry={2 * s} fill="#3a3a3a" opacity={0.6} />
        </g>
      );
    }
    return (
      <g key="office">
        {/* Glass-curtain look */}
        <rect x={x - w / 2} y={baseY - h} width={w} height={h} fill="#5fa8d3" opacity={0.4} />
        <rect x={x - w / 2} y={baseY - h} width={w} height={h} fill="none" stroke="#a3aebd" strokeWidth={Math.max(0.4, 0.2 * s)} />
        {/* Horizontal floor lines */}
        {Array.from({ length: 20 }).map((_, row) => (
          <line key={row} x1={x - w / 2} x2={x + w / 2} y1={baseY - h + (row + 1) * (h / 21)} y2={baseY - h + (row + 1) * (h / 21)} stroke="#3a4250" strokeOpacity={0.6} strokeWidth={Math.max(0.3, 0.1 * s)} />
        ))}
        {/* Vertical mullions */}
        {[0.33, 0.66].map((f, i) => (
          <line key={i} x1={x - w / 2 + w * f} x2={x - w / 2 + w * f} y1={baseY - h} y2={baseY} stroke="#3a4250" strokeOpacity={0.6} strokeWidth={Math.max(0.3, 0.15 * s)} />
        ))}
      </g>
    );
  },
};


// Color tokens — warm-to-cool gradient inner→outer matching damage severity.
const RING_COLORS: Record<keyof RingSet, string> = {
  fireball: "#ffffff",
  severeBlast: "#ff4d4d",
  thermalBurn: "#ff8a3d",
  moderateBlast: "#ffd166",
  ionizingRad: "#c084fc",
  lightBlast: "#7ab8ff",
};

type RingSet = {
  fireball: number;
  severeBlast: number;
  thermalBurn: number;
  moderateBlast: number;
  ionizingRad: number;
  lightBlast: number;
};

const RING_DEFS: Array<{
  key: keyof RingSet;
  label: string;
  effect: string;
}> = [
  { key: "lightBlast",    label: "1 psi",       effect: "Windows shatter; light injuries" },
  { key: "ionizingRad",   label: "500 rem",     effect: "Lethal ionizing radiation dose" },
  { key: "moderateBlast", label: "5 psi",       effect: "Most residential buildings collapse" },
  { key: "thermalBurn",   label: "Thermal",     effect: "3rd-degree burns to exposed skin" },
  { key: "severeBlast",   label: "20 psi",      effect: "Reinforced concrete destroyed" },
  { key: "fireball",      label: "Fireball",    effect: "Everything within is vaporized" },
];

export function BlastDiagram({ kase }: Props) {
  const env = detonationEnv(kase.subtype, kase.type);
  const yieldKt = kase.yieldKt ?? null;

  // Animation state — drives the side-view scene over time. The rings + legend
  // are static reference data and do not animate. Default-paused if the user
  // has prefers-reduced-motion on (they can still hit Play).
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Top-down view mode: abstract concentric rings (default, no permission
  // needed) vs "on the map" using the browser's geolocation API to center
  // an OpenStreetMap tile on the user's current location.
  const [topDownMode, setTopDownMode] = useState<"abstract" | "location" | "map3d">("abstract");
  // Scenario for the primary tilted animation: as-detonated uses the actual
  // test conditions (env, HOB); optimal-hob substitutes an air burst at the
  // physics-derived optimal HOB so the user can compare with peak effect.
  const [scenario, setScenario] = useState<"as-detonated" | "optimal-hob">("as-detonated");
  const [geo, setGeo] = useState<{
    status: "idle" | "asking" | "granted" | "denied" | "unsupported";
    coords?: { lat: number; lng: number };
    error?: string;
  }>({ status: "idle" });
  // Hovered legend row → highlights the matching ring on both the abstract
  // SVG and the leaflet location map. Drives a bidirectional cross-highlight
  // so the user can read "what does this ring mean" without scanning.
  const [hoveredRingKey, setHoveredRingKey] = useState<string | null>(null);
  const [mapModalOpen, setMapModalOpen] = useState(false);
  // Live measurement of the tilted-stage wrapper's rendered width — used
  // to compute the right pixels-per-meter for the Leaflet map so it
  // shares scale with the SVG rings rendered on top.
  const tiltStageRef = useRef<HTMLDivElement>(null);
  const [tiltStageWidth, setTiltStageWidth] = useState(0);
  useEffect(() => {
    if (!tiltStageRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setTiltStageWidth(w);
    });
    ro.observe(tiltStageRef.current);
    return () => ro.disconnect();
  }, []);
  // Unit system is global now — driven by the navbar toggle via the shared
  // units store. Reading it here keeps the blast viz in sync with the rest of
  // the app (m/km ↔ ft/mi) without a per-diagram control.
  const units = useUnits();

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "unsupported" });
      return;
    }
    setGeo({ status: "asking" });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGeo({
          status: "granted",
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        }),
      (err) => setGeo({ status: "denied", error: err.message }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }, []);

  const onTick = useCallback((dt: number) => {
    setTime((t) => {
      const next = t + dt;
      if (next >= ANIM_DURATION) {
        setPlaying(false);
        return ANIM_DURATION;
      }
      return next;
    });
  }, []);
  useAnimationFrame(playing, speed, onTick);

  const handlePlay = useCallback(() => {
    // If we're at the end, restart from 0
    setTime((t) => (t >= ANIM_DURATION ? 0 : t));
    setPlaying((p) => !p);
  }, []);
  const handleRestart = useCallback(() => {
    setTime(0);
    setPlaying(true);
  }, []);
  const handleScrub = useCallback((newT: number) => {
    setPlaying(false);
    setTime(Math.max(0, Math.min(ANIM_DURATION, newT)));
  }, []);

  const yieldUpper = kase.yieldKtUpper;
  const yieldDisplay = yieldKt == null
    ? "Yield unknown"
    : yieldUpper && yieldUpper !== yieldKt
      ? `${fmtYield(yieldKt)}–${fmtYield(yieldUpper)}`
      : fmtYield(yieldKt);

  const effects = useMemo(() => (yieldKt ? computeBlastEffects(yieldKt) : null), [yieldKt]);
  const comparison = useMemo(() => (yieldKt ? compareYield(yieldKt) : null), [yieldKt]);

  // Incidents are not blasts — show a contextual card instead of rings.
  if (env === "incident") {
    return (
      <DiagramCard title="Nuclear incident" subtitle="Not a blast" env={env}>
        <Box sx={{ px: 1, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.5 }}>
            This record documents a nuclear-related accident or release, not a
            planned detonation. Blast-radius modeling does not apply — refer to
            the description and source for specifics on contamination, casualties,
            and cleanup.
          </Typography>
        </Box>
      </DiagramCard>
    );
  }

  if (!effects) {
    return (
      <DiagramCard title="Nuclear test" subtitle="Yield not declassified" env={env}>
        <Box sx={{ px: 1, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.5 }}>
            The published source does not include this test's yield. Blast
            radius cannot be computed.
          </Typography>
        </Box>
      </DiagramCard>
    );
  }

  // Determine which rings make sense for this environment.
  // Underground & underwater contain most of the blast — only show fireball-
  // equivalent cavity radius. Atmospheric/surface show the full set.
  const ringSet: RingSet = {
    fireball: effects.fireballM,
    severeBlast: effects.severeBlastM,
    thermalBurn: env === "atmospheric" || env === "surface" || env === "barge" ? effects.thermalBurnM : 0,
    moderateBlast: effects.moderateBlastM,
    ionizingRad: effects.ionizingRadM,
    lightBlast: env === "atmospheric" || env === "surface" || env === "barge" ? effects.lightBlastM : 0,
  };
  const activeRings = RING_DEFS.filter((d) => ringSet[d.key] > 0);
  const maxRadiusM = Math.max(...activeRings.map((d) => ringSet[d.key]));

  // Scale rings so the largest fills ~85% of the ring panel
  const ringMaxPx = (RING_H * 0.42);
  const scale = ringMaxPx / Math.max(1, maxRadiusM);
  const familiar = familiarSize(maxRadiusM);

  return (
    <DiagramCard
      title={yieldDisplay}
      subtitle={comparison ? compareLabel(comparison) : ""}
      env={env}
    >
      {/* PRIMARY ANIMATION — tilted axonometric view. A single panel
          replaces the previous dual side-view layout. A scenario toggle
          in the header lets the user flip between "as detonated" and a
          "same yield at optimal HOB" comparison (the same animation
          parameters that the second side-view panel previously rendered). */}
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 9,
            color: "text.secondary",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Scenario
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={scenario}
          onChange={(_, v) => v && setScenario(v)}
          sx={{ "& .MuiToggleButton-root": { px: 0.85, py: 0.2, fontSize: 9, gap: 0.5, textTransform: "none" } }}
        >
          <ToggleButton value="as-detonated">As detonated · {envLabel(env)}</ToggleButton>
          <ToggleButton value="optimal-hob">Optimal HOB · air burst</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {scenario === "optimal-hob" && (env === "atmospheric" || env === "rocket") && (
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            bgcolor: "rgba(122,184,255,0.04)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 10, fontStyle: "italic" }}>
            This test was already an air burst near optimal HOB — the two scenarios render identically.
          </Typography>
        </Box>
      )}
      <Box
        ref={tiltStageRef}
        sx={{ position: "relative", width: "100%" }}
        style={{ aspectRatio: `${TILT_W} / ${TILT_H}` }}
      >
        {/* Map background — Leaflet tiles rendered with an axonometric
            scaleY transform (matching the SVG's TILT_RATIO) so the map
            and SVG rings share the same projection. The map is told to
            render at exactly the same pixels-per-meter as the SVG so
            streets actually align with the ring radii. */}
        {geo.status === "granted" && geo.coords && (() => {
          // SVG's effective scale (viewBox units per meter), matching
          // TiltedView's scaleByDepth formula for the depth-constrained case.
          // burstY = horizonY + groundH * 0.45 (= 306.75 with TILT_H=480, HORIZON=165)
          // maxRy = min(burstY - horizonY - 8, TILT_H - burstY - 16)
          const burstYvb = TILT_HORIZON_Y + (TILT_H - TILT_HORIZON_Y) * 0.45;
          const maxRy = Math.min(burstYvb - TILT_HORIZON_Y - 8, TILT_H - burstYvb - 16);
          const maxRx = (TILT_W - 80) / 2;
          const scaleByDepth = maxRy / (maxRadiusM * TILT_RATIO);
          const scaleByWidth = maxRx / maxRadiusM;
          const scaleVB = Math.min(scaleByDepth, scaleByWidth);
          // Convert viewBox-unit scale to actual screen pixels per meter
          const actualW = tiltStageWidth || TILT_W;
          const pxPerMeter = scaleVB * (actualW / TILT_W);
          // Wrapper height in screen pixels (it has aspectRatio TILT_W/TILT_H)
          const wrapperH = actualW * TILT_H / TILT_W;
          // Where the burst sits in the wrapper as a fraction (0 = top, 1 = bottom).
          // Burst is at (HORIZON_Y + groundH × 0.45) in viewBox; expressed
          // as a fraction of total wrapper height.
          const burstFrac = TILT_HORIZON_Y / TILT_H + (1 - TILT_HORIZON_Y / TILT_H) * 0.45;
          // Map height (pre-transform) sized so that after scaleY(TILT_RATIO)
          // anchored at the TOP of the map, the visible content fills the
          // entire wrapper AND the map's center (= burst lat/lng) lands at
          // burstFrac × wrapperH on screen.
          //   post-scale burst y = (mapHeight / 2) × TILT_RATIO
          //   we want post-scale burst y = burstFrac × wrapperH
          //   so mapHeight = 2 × burstFrac × wrapperH / TILT_RATIO
          const fullPreH = (2 * burstFrac * wrapperH) / TILT_RATIO;
          return (
            <Box
              sx={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                overflow: "hidden",
                pointerEvents: "none",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  height: fullPreH,
                  transform: `scaleY(${TILT_RATIO})`,
                  // Origin at the top means scaling compresses the map
                  // toward y=0; visible content runs from 0 down to
                  // fullPreH × TILT_RATIO = 2 × burstFrac × wrapperH.
                  // The outer Box clips at wrapperH so we see the full
                  // viewport, with burst centered at burstFrac.
                  transformOrigin: "center top",
                  overflow: "hidden",
                }}
              >
                <LocationMap
                  lat={geo.coords.lat}
                  lng={geo.coords.lng}
                  rings={[]}
                  pixelsPerMeter={pxPerMeter}
                />
              </Box>
              {/* Very subtle sky tint at the very top — just enough
                  to ground the cloud and plane in "sky" without
                  obscuring the map underneath. */}
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(to bottom, rgba(15,26,42,0.35) 0%, rgba(15,26,42,0.1) 10%, rgba(15,26,42,0) 22%)",
                  pointerEvents: "none",
                }}
              />
            </Box>
          );
        })()}
        <svg
          viewBox={`0 0 ${TILT_W} ${TILT_H}`}
          width="100%"
          height="100%"
          style={{ display: "block", position: "relative", zIndex: 1 }}
        >
        <TiltedView
          env={scenario === "optimal-hob" ? "atmospheric" : env}
          hobM={
            scenario === "optimal-hob"
              ? effects.optimalHobM
              : (env === "atmospheric" || env === "rocket"
                  ? effects.optimalHobM
                  : 0)
          }
          fireballM={effects.fireballM}
          time={time}
          shockwavePeakM={effects.lightBlastM}
          damageRings={activeRings.map((d) => ({
            key: d.key,
            label: d.label,
            radiusM: ringSet[d.key],
            color: RING_COLORS[d.key],
          }))}
          hoveredRingKey={hoveredRingKey}
          units={units}
          mapEnabled={geo.status === "granted"}
        />
        </svg>
        {/* "Add your map for scale" CTA — shown whenever the geolocation
            isn't yet granted (idle, denied, unsupported, or asking).
            Asking the user to opt in to seeing their actual neighborhood
            under the rings is the central scale-reference move now. */}
        {geo.status !== "granted" && (
          <Box
            sx={{
              position: "absolute",
              left: "50%",
              bottom: "8%",
              transform: "translateX(-50%)",
              zIndex: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            <Button
              variant="contained"
              size="small"
              startIcon={<MyLocationIcon />}
              onClick={requestLocation}
              disabled={geo.status === "asking" || geo.status === "unsupported"}
              sx={{
                textTransform: "none",
                bgcolor: "rgba(207,227,255,0.95)",
                color: "#0a0d12",
                fontWeight: 700,
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                "&:hover": { bgcolor: "#cfe3ff" },
              }}
            >
              {geo.status === "asking"
                ? "Requesting location…"
                : geo.status === "denied"
                  ? "Retry — add your map for scale"
                  : geo.status === "unsupported"
                    ? "Geolocation not supported"
                    : "Add your map for scale"}
            </Button>
            {geo.status === "denied" && (
              <Typography
                variant="caption"
                sx={{
                  bgcolor: "rgba(10,13,18,0.85)",
                  color: "text.secondary",
                  px: 1,
                  py: 0.25,
                  borderRadius: 0.5,
                  fontSize: 10,
                }}
              >
                Location access was previously denied — enable in browser settings.
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {/* Animation control bar — drives BOTH panels simultaneously */}
      <AnimationControls
        time={time}
        duration={ANIM_DURATION}
        playing={playing}
        speed={speed}
        onPlay={handlePlay}
        onScrub={handleScrub}
        onRestart={handleRestart}
        onSpeedChange={setSpeed}
      />

      {/* Top-down ring panel — abstract concentric rings by default, or
          overlaid on a real OpenStreetMap of the user's current location. */}
      <Box
        sx={{
          display: "flex",
          gap: 0.5,
          px: 1.5,
          py: 0.75,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          alignItems: "center",
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 9,
            color: "text.secondary",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            flexGrow: 1,
          }}
        >
          Top-down · to scale
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={topDownMode}
          onChange={(_, v) => {
            if (!v) return;
            setTopDownMode(v);
            if ((v === "location" || v === "map3d") && geo.status === "idle") {
              requestLocation();
            }
          }}
          sx={{ "& .MuiToggleButton-root": { px: 0.85, py: 0.2, fontSize: 9, gap: 0.5 } }}
        >
          <ToggleButton value="abstract">
            <RadioButtonUncheckedIcon sx={{ fontSize: 12 }} />
            Abstract
          </ToggleButton>
          <ToggleButton value="location">
            <MyLocationIcon sx={{ fontSize: 12 }} />
            Your map
          </ToggleButton>
          <ToggleButton value="map3d">
            <TerrainIcon sx={{ fontSize: 12 }} />
            3D map
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Open large view">
          <IconButton
            size="small"
            onClick={() => {
              // Fullscreen opens in 3D — make sure we have a location for it.
              if (geo.status === "idle") requestLocation();
              setMapModalOpen(true);
            }}
            sx={{ p: 0.5, color: "text.secondary" }}
            aria-label="Expand map view"
          >
            <OpenInFullIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {topDownMode === "map3d" ? (
        <Box>
          {geo.status === "asking" && (
            <Box sx={{ p: 2, textAlign: "center", color: "text.secondary", fontSize: 12 }}>
              Requesting browser geolocation…
            </Box>
          )}
          {(geo.status === "denied" || geo.status === "unsupported") && (
            <Box sx={{ p: 2, textAlign: "center", color: "text.secondary", fontSize: 12 }}>
              Location unavailable — the 3D map needs your location to center the rings.
            </Box>
          )}
          {geo.status === "granted" && geo.coords && (
            <Box sx={{ width: "100%", aspectRatio: `${TILT_W} / ${TILT_H}`, minHeight: 360, maxHeight: "70vh" }}>
              <Suspense fallback={Map3DFallback}>
                <BlastMap3D
                  lat={geo.coords.lat}
                  lng={geo.coords.lng}
                  env={env}
                  hobM={env === "atmospheric" || env === "rocket" ? effects.optimalHobM : 0}
                  fireballM={effects.fireballM}
                  shockwavePeakM={effects.lightBlastM}
                  hoveredRingKey={hoveredRingKey}
                  units={units}
                  damageRings={activeRings.map((d) => ({
                    key: d.key,
                    label: d.label,
                    radiusM: ringSet[d.key],
                    color: RING_COLORS[d.key],
                  }))}
                />
              </Suspense>
            </Box>
          )}
        </Box>
      ) : topDownMode === "location" ? (
        <Box>
          {geo.status === "asking" && (
            <Box sx={{ p: 2, textAlign: "center", color: "text.secondary", fontSize: 12 }}>
              Requesting browser geolocation…
            </Box>
          )}
          {geo.status === "denied" && (
            <Box sx={{ p: 2, textAlign: "center", color: "text.secondary", fontSize: 12 }}>
              <Typography variant="caption" sx={{ display: "block", mb: 1 }}>
                Location access denied. Showing abstract rings instead.
              </Typography>
              <Typography variant="caption" sx={{ display: "block", fontSize: 10, color: "text.disabled" }}>
                ({geo.error})
              </Typography>
            </Box>
          )}
          {geo.status === "unsupported" && (
            <Box sx={{ p: 2, textAlign: "center", color: "text.secondary", fontSize: 12 }}>
              Geolocation not available in this browser.
            </Box>
          )}
          {geo.status === "granted" && geo.coords && (
            <Box
              sx={{
                width: "100%",
                // Grows with panel width — wider panel gives a taller map
                // (4:3 ratio reads as a generous "map portion of page"
                // without dominating the legend below). Min-height keeps it
                // usable even on narrow panels.
                aspectRatio: "4 / 3",
                minHeight: 320,
                maxHeight: "60vh",
              }}
            >
              <LocationMap
                lat={geo.coords.lat}
                lng={geo.coords.lng}
                hoveredLabel={hoveredRingKey ? activeRings.find((r) => r.key === hoveredRingKey)?.label : null}
                rings={activeRings.map<BlastRing>((d) => ({
                  radiusM: ringSet[d.key],
                  color: RING_COLORS[d.key],
                  label: d.label,
                }))}
              />
            </Box>
          )}
          {/* Fall back to the abstract view if geolocation failed */}
          {(geo.status === "denied" || geo.status === "unsupported") && (
            <svg viewBox={`0 0 ${SVG_W} ${RING_H}`} width="100%" height="auto" style={{ display: "block" }}>
              {[...activeRings]
                .sort((a, b) => ringSet[b.key] - ringSet[a.key])
                .map((d) => {
                  const r = ringSet[d.key] * scale;
                  const isHovered = hoveredRingKey === d.key;
                  return (
                    <circle
                      key={d.key}
                      cx={SVG_W / 2}
                      cy={RING_H / 2}
                      r={r}
                      fill={RING_COLORS[d.key]}
                      fillOpacity={isHovered ? (d.key === "fireball" ? 1 : 0.32) : (d.key === "fireball" ? 0.85 : 0.14)}
                      stroke={RING_COLORS[d.key]}
                      strokeOpacity={isHovered ? 1 : (d.key === "fireball" ? 1 : 0.75)}
                      strokeWidth={isHovered ? 2.5 : (d.key === "fireball" ? 1 : 1.2)}
                    />
                  );
                })}
              <ScaleBar scale={scale} cx={SVG_W / 2} y={RING_H - 10} maxRadiusM={maxRadiusM} units={units} />
            </svg>
          )}
        </Box>
      ) : (
        <svg viewBox={`0 0 ${SVG_W} ${RING_H}`} width="100%" height="auto" style={{ display: "block" }}>
          <rect x={0} y={0} width={SVG_W} height={RING_H} fill="rgba(255,255,255,0.015)" />
          {[...activeRings]
            .sort((a, b) => ringSet[b.key] - ringSet[a.key])
            .map((d) => {
              const r = ringSet[d.key] * scale;
              const isHovered = hoveredRingKey === d.key;
              return (
                <circle
                  key={d.key}
                  cx={SVG_W / 2}
                  cy={RING_H / 2 + 8}
                  r={r}
                  fill={RING_COLORS[d.key]}
                  fillOpacity={isHovered ? (d.key === "fireball" ? 1 : 0.32) : (d.key === "fireball" ? 0.85 : 0.14)}
                  stroke={RING_COLORS[d.key]}
                  strokeOpacity={isHovered ? 1 : (d.key === "fireball" ? 1 : 0.75)}
                  strokeWidth={isHovered ? 2.5 : (d.key === "fireball" ? 1 : 1.2)}
                />
              );
            })}
          <ScaleBar scale={scale} cx={SVG_W / 2} y={RING_H / 2 + 8 + ringMaxPx + 14} maxRadiusM={maxRadiusM} units={units} />
        </svg>
      )}

      {/* Legend table — actual radii in meters/km. Hovering a row highlights
          the matching ring on both the abstract SVG and the location map. */}
      <Box sx={{ px: 1.5, pt: 1, pb: 1.5 }}>
        <Stack spacing={0.2}>
          {activeRings.map((d) => {
            const r = ringSet[d.key];
            const isHovered = hoveredRingKey === d.key;
            return (
              <Box
                key={d.key}
                onMouseEnter={() => setHoveredRingKey(d.key)}
                onMouseLeave={() => setHoveredRingKey(null)}
                sx={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 1,
                  px: 0.75,
                  py: 0.4,
                  borderRadius: 0.5,
                  cursor: "default",
                  bgcolor: isHovered ? "rgba(255,255,255,0.05)" : "transparent",
                  transition: "background-color 0.12s",
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: RING_COLORS[d.key],
                    flexShrink: 0,
                    opacity: d.key === "fireball" ? 1 : 0.7,
                    transform: isHovered ? "scale(1.3)" : "scale(1)",
                    transition: "transform 0.12s",
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 600, color: "text.primary", minWidth: 60 }}
                >
                  {d.label}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ fontFamily: "JetBrains Mono, monospace", color: "text.secondary", minWidth: 56 }}
                >
                  {fmtDistance(r, units)}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 11 }}>
                  {d.effect}
                </Typography>
              </Box>
            );
          })}
        </Stack>

        {familiar && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1, fontStyle: "italic" }}
          >
            Outer ring {familiar}.
          </Typography>
        )}

        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 1.5,
            pt: 1,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            color: "text.secondary",
            fontSize: 10,
            lineHeight: 1.5,
          }}
        >
          ⚠ Approximation for educational scale. Animation timing is compressed
          (real fireballs form in milliseconds; shockwaves travel near supersonic).
          Damage thresholds use Glasstone-Dolan scaling — see{" "}
          <a
            href="https://nuclearsecrecy.com/nukemap/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#7ab8ff" }}
          >
            NUKEMAP
          </a>{" "}
          for a more rigorous tool.
        </Typography>

        {(env === "underground" || env === "underwater") && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1, lineHeight: 1.5 }}
          >
            Most blast and thermal effects are contained by the surrounding{" "}
            {env === "underground" ? "rock" : "water"}. The displayed radii are
            what would result if the same yield were detonated at optimal
            altitude over open ground — i.e. peak destructive potential.
          </Typography>
        )}
      </Box>

      {/* Large-view modal — shows the map full-bleed with the legend to the
          right (or below, on narrow screens). Reuses the same map+legend
          state so hover highlight and "your map" continue to work. */}
      <Dialog
        open={mapModalOpen}
        onClose={() => setMapModalOpen(false)}
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: {
            width: "min(96vw, 1400px)",
            height: "min(92vh, 900px)",
            bgcolor: "background.paper",
            backgroundImage: "none",
            border: "1px solid rgba(255,255,255,0.08)",
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            height: "100%",
            position: "relative",
          }}
        >
          <IconButton
            onClick={() => setMapModalOpen(false)}
            aria-label="Close large view"
            sx={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 1000,
              bgcolor: "rgba(10,13,18,0.85)",
              border: "1px solid rgba(255,255,255,0.12)",
              "&:hover": { bgcolor: "rgba(10,13,18,0.95)" },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>

          {/* Map fills the available space on the left. Fullscreen opens in
              3D when we have the user's location; otherwise it falls back to
              the tilted SVG animation (with a prompt to enable location). */}
          <Box sx={{ flex: { xs: "1 1 60%", md: "1 1 70%" }, minHeight: 0, position: "relative" }}>
            {mapModalOpen && geo.status === "granted" && geo.coords ? (
              <Suspense fallback={Map3DFallback}>
                <BlastMap3D
                  lat={geo.coords.lat}
                  lng={geo.coords.lng}
                  env={env}
                  hobM={env === "atmospheric" || env === "rocket" ? effects.optimalHobM : 0}
                  fireballM={effects.fireballM}
                  shockwavePeakM={effects.lightBlastM}
                  hoveredRingKey={hoveredRingKey}
                  units={units}
                  damageRings={activeRings.map((d) => ({
                    key: d.key,
                    label: d.label,
                    radiusM: ringSet[d.key],
                    color: RING_COLORS[d.key],
                  }))}
                />
              </Suspense>
            ) : (
              // No location yet — show the tilted SVG animation, and offer to
              // enable location so the view can go 3D over the real map.
              <Box sx={{ height: "100%", display: "grid", placeItems: "center", p: 2, position: "relative" }}>
                <svg viewBox={`0 0 ${TILT_W} ${TILT_H}`} width="100%" height="100%" style={{ display: "block", maxHeight: "100%" }}>
                  <TiltedView
                    env={scenario === "optimal-hob" ? "atmospheric" : env}
                    hobM={
                      scenario === "optimal-hob"
                        ? effects.optimalHobM
                        : (env === "atmospheric" || env === "rocket"
                            ? effects.optimalHobM
                            : 0)
                    }
                    fireballM={effects.fireballM}
                    time={time}
                    shockwavePeakM={effects.lightBlastM}
                    damageRings={activeRings.map((d) => ({
                      key: d.key,
                      label: d.label,
                      radiusM: ringSet[d.key],
                      color: RING_COLORS[d.key],
                    }))}
                    hoveredRingKey={hoveredRingKey}
                    units={units}
                  />
                </svg>
                {geo.status !== "granted" && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<MyLocationIcon />}
                    onClick={requestLocation}
                    disabled={geo.status === "asking" || geo.status === "unsupported"}
                    sx={{
                      position: "absolute",
                      bottom: "8%",
                      left: "50%",
                      transform: "translateX(-50%)",
                      textTransform: "none",
                      bgcolor: "rgba(207,227,255,0.95)",
                      color: "#0a0d12",
                      fontWeight: 700,
                      "&:hover": { bgcolor: "#cfe3ff" },
                    }}
                  >
                    {geo.status === "asking"
                      ? "Requesting location…"
                      : geo.status === "unsupported"
                        ? "Geolocation not supported"
                        : "Enable location for 3D map"}
                  </Button>
                )}
              </Box>
            )}
          </Box>

          {/* Right-side stats panel: title + legend + caveats. */}
          <Box
            sx={{
              flex: { xs: "1 1 40%", md: "1 1 30%" },
              minWidth: { md: 320 },
              maxWidth: { md: 420 },
              borderLeft: { md: "1px solid rgba(255,255,255,0.08)" },
              borderTop: { xs: "1px solid rgba(255,255,255,0.08)", md: "none" },
              p: 3,
              overflowY: "auto",
            }}
          >
            <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: "0.1em", fontSize: 10 }}>
              {kase.dataset === "nuclear-test" ? "Nuclear test" : "Nuclear incident"}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25, mb: 0.5 }}>
              {kase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
              {yieldDisplay}{kase.incidentLocation ? ` · ${kase.incidentLocation}` : ""}
            </Typography>

            <Stack spacing={0.4}>
              {activeRings.map((d) => {
                const r = ringSet[d.key];
                const isHovered = hoveredRingKey === d.key;
                return (
                  <Box
                    key={d.key}
                    onMouseEnter={() => setHoveredRingKey(d.key)}
                    onMouseLeave={() => setHoveredRingKey(null)}
                    sx={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 1.5,
                      px: 1,
                      py: 0.75,
                      borderRadius: 0.75,
                      cursor: "default",
                      bgcolor: isHovered ? "rgba(255,255,255,0.06)" : "transparent",
                      transition: "background-color 0.12s",
                    }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: RING_COLORS[d.key],
                        flexShrink: 0,
                        opacity: d.key === "fireball" ? 1 : 0.8,
                        transform: isHovered ? "scale(1.3)" : "scale(1)",
                        transition: "transform 0.12s",
                      }}
                    />
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Stack direction="row" alignItems="baseline" spacing={1.5}>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: "text.primary" }}>
                          {d.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: "JetBrains Mono, monospace", color: "#cfe3ff", fontSize: 12 }}
                        >
                          {fmtDistance(r, units)}
                        </Typography>
                      </Stack>
                      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }}>
                        {d.effect}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Stack>

            {familiar && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 2, fontStyle: "italic" }}
              >
                Outer ring {familiar}.
              </Typography>
            )}

            <Typography
              variant="caption"
              sx={{
                display: "block",
                mt: 2,
                pt: 1.5,
                borderTop: "1px solid rgba(255,255,255,0.06)",
                color: "text.secondary",
                fontSize: 10.5,
                lineHeight: 1.6,
              }}
            >
              ⚠ Approximation for educational scale. Damage thresholds use
              Glasstone-Dolan scaling — see{" "}
              <a
                href="https://nuclearsecrecy.com/nukemap/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#7ab8ff" }}
              >
                NUKEMAP
              </a>{" "}
              for a more rigorous tool.
            </Typography>
          </Box>
        </Box>
      </Dialog>
    </DiagramCard>
  );
}

function AnimationControls({
  time,
  duration,
  playing,
  speed,
  onPlay,
  onScrub,
  onRestart,
  onSpeedChange,
}: {
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  onPlay: () => void;
  onScrub: (t: number) => void;
  onRestart: () => void;
  onSpeedChange: (s: number) => void;
}) {
  const reducedMotion = prefersReducedMotion();
  const pct = (time / duration) * 100;
  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        gap: 1,
      }}
    >
      <IconButton size="small" onClick={onPlay} sx={{ color: "text.primary", p: 0.5 }}>
        {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
      </IconButton>
      <Box sx={{ flexGrow: 1, position: "relative", height: 18, display: "flex", alignItems: "center" }}>
        {/* Track */}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 4,
            bgcolor: "rgba(255,255,255,0.08)",
            borderRadius: 2,
          }}
        />
        {/* Progress fill */}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            width: `${pct}%`,
            height: 4,
            bgcolor: "#ffd166",
            borderRadius: 2,
            transition: playing ? "none" : "width 0.15s linear",
          }}
        />
        {/* Hidden range input drives scrubbing */}
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={time}
          onChange={(e) => onScrub(parseFloat(e.target.value))}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
            width: "100%",
            margin: 0,
          }}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontFamily: "JetBrains Mono, monospace",
          color: "text.secondary",
          minWidth: 50,
          textAlign: "right",
          fontSize: 10,
        }}
      >
        {time.toFixed(1)}s / {duration}s
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={speed}
        onChange={(_, v) => v && onSpeedChange(v)}
        sx={{ "& .MuiToggleButton-root": { px: 0.75, py: 0.25, fontSize: 10, minWidth: 26 } }}
      >
        <ToggleButton value={0.25}>¼×</ToggleButton>
        <ToggleButton value={1}>1×</ToggleButton>
        <ToggleButton value={2}>2×</ToggleButton>
      </ToggleButtonGroup>
      <IconButton size="small" onClick={onRestart} sx={{ color: "text.primary", p: 0.5 }} title="Restart">
        <ReplayIcon fontSize="small" />
      </IconButton>
      {reducedMotion && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 9, ml: 0.5 }}>
          reduced motion
        </Typography>
      )}
    </Box>
  );
}

function DiagramCard({
  title,
  subtitle,
  env,
  children,
  headerExtra,
}: {
  title: string;
  subtitle: string;
  env: DetonationEnv;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        bgcolor: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 1.5,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "baseline",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, fontSize: 18 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
            {subtitle}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {headerExtra}
        <EnvBadge env={env} />
      </Box>
      {children}
    </Box>
  );
}

function EnvBadge({ env }: { env: DetonationEnv }) {
  const labels: Record<DetonationEnv, string> = {
    atmospheric: "AIR BURST",
    surface: "SURFACE",
    underground: "UNDERGROUND",
    underwater: "UNDERWATER",
    barge: "BARGE / WATER",
    rocket: "HIGH ALTITUDE",
    incident: "INCIDENT",
  };
  return (
    <Typography
      variant="caption"
      sx={{
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        color: "text.secondary",
        bgcolor: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        px: 0.75,
        py: 0.25,
        borderRadius: 0.5,
        letterSpacing: "0.08em",
      }}
    >
      {labels[env]}
    </Typography>
  );
}

// Animation timing constants (in seconds within the 6s timeline). All real
// blast phenomena are time-compressed: the actual fireball forms in milliseconds
// and the shockwave reaches 1km in ~2.3s, but we stretch and slow these for
// human visibility.
const T_FLASH_PEAK = 0.05;      // initial blinding white peak
const T_FLASH_DIM = 0.14;       // Teller-Ulam dim (opaque-shell phase)
const T_FLASH_SECOND = 0.32;    // second-flash peak (fireball "wins")
const T_FLASH_END = 0.45;       // flash fully dissipated; fireball remains
const T_FIREBALL_PEAK = 0.5;    // fireball fully expanded by this time

// White detonation-flash opacity (Teller-Ulam double flash). Shared by the
// bounded side-view rect and BlastMap3D's full-bleed map flash so both follow
// the exact same timing/intensity curve. Returns 0 outside the flash window.
export function detonationFlashOpacity(time: number): number {
  if (time < 0 || time >= T_FLASH_END) return 0;
  return time < T_FLASH_DIM
    ? 0.85 * (1 - progress(time, 0, T_FLASH_DIM))
    : 0.45 * easeOutQuad(progress(time, T_FLASH_DIM, T_FLASH_SECOND)) *
        (1 - progress(time, T_FLASH_SECOND, T_FLASH_END));
}
const T_SHOCKWAVE_START = 0.4;  // shockwave separates from fireball
const T_SHOCKWAVE_END = 5.0;    // shockwave reaches its full peak radius
const T_WILSON_START = 0.5;     // condensation cloud forms
const T_WILSON_PEAK = 0.95;     // Wilson cloud at max visibility
const T_WILSON_END = 1.8;       // dissipates
const T_STEM_START = 0.8;       // mushroom stem starts growing
const T_STEM_END = 4.0;
const T_CAP_START = 2.0;
const T_CAP_END = 5.2;
const T_ANVIL_START = 3.8;      // cap reaches tropopause, flattens
const T_FIREBALL_FADE_START = 1.6;
const T_FIREBALL_FADE_END = 4.0;
const T_END = 6.0;

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}
function easeOutBack(t: number): number {
  // Snappy overshoot — useful for "pop" reveal effects (flags planting).
  const c = Math.max(0, Math.min(1, t));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}
function easeOutQuad(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) * (1 - c);
}
function progress(t: number, start: number, end: number): number {
  if (t <= start) return 0;
  if (t >= end) return 1;
  return (t - start) / (end - start);
}

// Fireball color shifts through the temperature sequence: hot white → yellow
// → orange → ember as the post-detonation fireball cools.
// Blackbody radiation color approximation. Maps temperature in Kelvin to an
// RGB string. Based on Tanner Helland's blackbody chart, simplified for
// the 1000K–10000K range that nuclear fireballs traverse as they cool.
// Used both for fireball fill and to drive sky reaction tint.
function blackbodyColor(kelvin: number): string {
  const k = Math.max(1000, Math.min(10000, kelvin)) / 100;
  const r =
    k <= 66 ? 255 : Math.max(0, Math.min(255, 329.7 * Math.pow(k - 60, -0.1332)));
  const g =
    k <= 66
      ? Math.max(0, Math.min(255, 99.47 * Math.log(k) - 161.12))
      : Math.max(0, Math.min(255, 288.12 * Math.pow(k - 60, -0.0755)));
  const b =
    k >= 66
      ? 255
      : k <= 19
        ? 0
        : Math.max(0, Math.min(255, 138.52 * Math.log(k - 10) - 305.04));
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// Fireball surface temperature as a function of time, in Kelvin. Real cooling
// is a fast exponential decay punctuated by the Teller-Ulam double-flash
// signature: bright peak, brief dim as the opaque shock front blocks the
// interior, then second peak as the shell becomes transparent and the
// hotter interior dominates.
function fireballTemperature(time: number): number {
  if (time < T_FLASH_PEAK) return 8000;
  if (time < T_FLASH_DIM) {
    // Falling from 8000K → ~3500K as opaque shell forms
    const t = (time - T_FLASH_PEAK) / (T_FLASH_DIM - T_FLASH_PEAK);
    return 8000 - 4500 * t;
  }
  if (time < T_FLASH_SECOND) {
    // Rising 3500K → ~7000K as shell becomes transparent (second flash)
    const t = (time - T_FLASH_DIM) / (T_FLASH_SECOND - T_FLASH_DIM);
    return 3500 + 3500 * easeOutCubic(t);
  }
  if (time < 1.5) {
    // Exponential cooling 7000K → 2500K
    const t = (time - T_FLASH_SECOND) / (1.5 - T_FLASH_SECOND);
    return 7000 * Math.exp(-t * 1.4) + 2500 * (1 - Math.exp(-t * 1.4));
  }
  if (time < 4.0) {
    // Slow afterglow cooling 2500K → 1500K
    return 1500 + 1000 * Math.exp(-(time - 1.5) * 0.7);
  }
  return 1400;
}

// Luminosity envelope (0..1) — drives the bloom intensity of the fireball
// and the sky reaction. Captures the double-flash signature: peak at
// detonation, dim, second peak, then exponential decay.
export function fireballLuminosity(time: number): number {
  if (time < T_FLASH_PEAK) return 1;
  if (time < T_FLASH_DIM) {
    // First-flash decay
    const t = (time - T_FLASH_PEAK) / (T_FLASH_DIM - T_FLASH_PEAK);
    return 1 - 0.6 * t; // dim to ~0.4
  }
  if (time < T_FLASH_SECOND) {
    // Rising to second-flash peak
    const t = (time - T_FLASH_DIM) / (T_FLASH_SECOND - T_FLASH_DIM);
    return 0.4 + 0.55 * easeOutQuad(t); // rises to ~0.95
  }
  if (time < 1.0) {
    // Slow decay from second peak
    const t = (time - T_FLASH_SECOND) / (1.0 - T_FLASH_SECOND);
    return 0.95 - 0.45 * t;
  }
  // Exponential afterglow
  return Math.max(0, 0.5 * Math.exp(-(time - 1.0) * 1.1));
}

// To-scale side-view: draws the fireball alongside familiar reference objects
// (person, house, building, skyscraper, Burj Khalifa, Mt Everest) at the same
// scale. Auto-picks the references whose heights bracket the fireball diameter.
// When the bomb has no yield (incidents), falls back to a schematic indicator.
// `time` drives the animation; at t=0 we render the pre-detonation state.
// Legacy SideView — kept as exported dead code so its body remains for
// reference / potential reuse. TiltedView now owns its own complete defs
// block (sky/cloud/fireball/filter gradients) so SideView is no longer
// required at runtime.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SideView({
  env,
  hobM,
  fireballM,
  time,
  shockwavePeakM,
  damageRings,
  hoveredRingKey,
  units,
}: {
  env: DetonationEnv;
  hobM: number;
  fireballM: number;
  time: number;
  shockwavePeakM: number;
  /** Optional ring set to overlay as ground-projected half-ellipses, so
   *  the user can see what falls inside each damage radius at this scale. */
  damageRings?: Array<{ key: string; label: string; radiusM: number; color: string }>;
  /** Currently-hovered ring key (from the legend) — highlights matching arc. */
  hoveredRingKey?: string | null;
  /** Distance unit system for in-canvas labels. */
  units?: UnitSystem;
}) {
  const u: UnitSystem = units ?? "metric";
  const w = SVG_W;
  const h = SIDE_H;

  // Pick references that bracket the fireball diameter (so it's neither
  // larger than all of them nor smaller than all of them). We always show
  // at least one smaller and one larger reference for context.
  const fireballDiameter = fireballM * 2 || 1;
  const refs = pickReferences(fireballDiameter);

  // World-units that need to fit horizontally:
  //   Total width = sum(ref widths) + spacing between objects + fireball width
  // The tallest object's height (or fireball diameter) bounds vertical scale.
  // We use the more constrained scale (width or height) so everything fits.
  const padding = 24; // px on each side
  const gap = 8;      // px between objects
  const usableW = w - padding * 2;
  const ground = h - 24; // ground line y position

  const tallest = Math.max(
    fireballDiameter,
    ...refs.map((r) => r.heightM),
  );
  // Available vertical = ground - top margin (16 for label)
  const usableH = ground - 16;

  // Pixels per meter — pick whichever is more constraining.
  const refsTotalWidthM = refs.reduce((sum, r) => sum + r.widthM, 0);
  const fireballWidthM = fireballDiameter;
  const totalContentWidthM = refsTotalWidthM + fireballWidthM;
  // Subtract pixel-space gaps; convert via current scale guess (iterate twice)
  let scale = Math.min(
    (usableW - gap * (refs.length + 1)) / Math.max(1, totalContentWidthM),
    usableH / Math.max(1, tallest),
  );
  // Don't allow absurdly tiny scale that makes everything invisible
  scale = Math.max(scale, 0.0001);

  // Layout: fireball on the LEFT, refs to the right in ascending height order.
  // This way the eye reads: "here's the bomb → here's how it compares".
  const sortedRefs = [...refs].sort((a, b) => a.heightM - b.heightM);

  // Layout positions left-to-right
  let cursor = padding;
  const fireballPxR = (fireballDiameter / 2) * scale;
  const fireballCx = cursor + fireballPxR;
  // Fireball center y in screen-space — depends on burst environment. Lifted
  // out of the fireball-IIFE so labels (HOB, FIREBALL) can reference it
  // without recomputing.
  const fireballCy: number = (() => {
    if (env === "underground") return ground + fireballPxR * 0.6;
    if (env === "underwater") return ground + fireballPxR * 0.7;
    if (env === "atmospheric" || env === "rocket") {
      const hobPx = Math.min(usableH - fireballPxR - 4, hobM * scale);
      return ground - Math.max(fireballPxR, hobPx);
    }
    return ground;
  })();
  cursor += fireballDiameter * scale + gap;

  const refPositions: { ref: RefObject; cx: number }[] = [];
  for (const r of sortedRefs) {
    const widthPx = r.widthM * scale;
    refPositions.push({ ref: r, cx: cursor + widthPx / 2 });
    cursor += widthPx + gap;
  }

  // Environment-driven background treatment
  const isWater = env === "underwater" || env === "barge";
  const isUnderground = env === "underground";
  const groundColor = isWater ? "#13283d" : isUnderground ? "#3d342a" : "#3d342a";
  const skyId = isUnderground ? "underground-grad" : isWater ? "ocean-grad" : "sky-grad";

  return (
    <g>
      <defs>
        <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2942" />
          <stop offset="100%" stopColor="#0f1a2a" />
        </linearGradient>
        <linearGradient id="ocean-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2942" />
          <stop offset="100%" stopColor="#0f1a2a" />
        </linearGradient>
        <linearGradient id="underground-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2942" />
          <stop offset="100%" stopColor="#0f1a2a" />
        </linearGradient>
        <radialGradient id="flash" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="30%" stopColor="#fff4a8" stopOpacity="0.95" />
          <stop offset="65%" stopColor="#ffaa3d" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
        </radialGradient>
        {/* Cloud color stops — extended palette covering the full mushroom
            anatomy: bright top-lit crowns, mid-tone convective billows,
            shadowed undersides, charcoal cores, dusty browns at the foot,
            and pale anvil ice at the tropopause. */}
        <radialGradient id="puff-light" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#ece6d8" stopOpacity="1" />
          <stop offset="55%" stopColor="#beb6a6" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#9a9285" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-mid" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#8e887d" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#5d574f" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#3a352f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-dark" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#3a3833" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#1f1d1a" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0c0b0a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-charcoal" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#211e1a" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#100e0b" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#100e0b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-dustbrown" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#7a5c40" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#3e2d1d" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#3e2d1d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-ice" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#f4f0e6" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#d4cebf" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#a8a194" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-hot" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#ffe9b3" stopOpacity="1" />
          <stop offset="45%" stopColor="#e8893a" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#7a3010" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-warmglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#ff7833" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#c34a14" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#5a1a08" stopOpacity="0" />
        </radialGradient>
        {/* Wilson cloud — pale blue-white toroidal condensation that briefly
            envelops the shockwave when atmospheric water vapor flash-condenses
            in the rarefaction behind the front. Iconic nuclear marker. */}
        <radialGradient id="wilson-cloud" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#eef4f8" stopOpacity="0" />
          <stop offset="42%" stopColor="#eef4f8" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#dde7ee" stopOpacity="0.6" />
          <stop offset="72%" stopColor="#eef4f8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#eef4f8" stopOpacity="0" />
        </radialGradient>
        {/* Sky reaction tint — fades on during peak fireball, off as it cools.
            Drawn as an overlay rect on top of sky-grad. */}
        <radialGradient id="sky-glow" cx="50%" cy="100%" r="120%">
          <stop offset="0%"  stopColor="#ffaa3d" stopOpacity="0.55" />
          <stop offset="35%" stopColor="#c44a1a" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#0f1a2a" stopOpacity="0" />
        </radialGradient>
        {/* Top-lit cap gradient — desaturated, like real footage where the
            sun-lit top is dusty-cream and the underside is shadow-grey. */}
        <linearGradient id="cap-toplit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d8d2c2" stopOpacity="0.92" />
          <stop offset="35%" stopColor="#9a958a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#1a1815" stopOpacity="0.75" />
        </linearGradient>
        {/* Fireball corona — much wider than the visible fireball, giving
            the glow a presence in the surrounding air. */}
        <radialGradient id="fireball-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="25%" stopColor="#ffe9b3" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#e8893a" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#7a3010" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="fireball-corona" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffaa3d" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#e8893a" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#7a3010" stopOpacity="0" />
        </radialGradient>
        {/* Turbulence filter for organic cloud edges — distorts the
            ellipses into billowing convective shapes. Higher octaves +
            stronger displacement than before, so individual puffs blend
            into one another instead of reading as discrete circles. */}
        <filter id="cloud-turb" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="18" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
        {/* Coarser turbulence — for big cap billows that should read as
            massive convective cells, not fine granular noise. */}
        <filter id="cloud-turb-coarse" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="11" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="28" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="0.4" />
        </filter>
        {/* Subtle blur only — used when we want soft edges without distortion. */}
        <filter id="cloud-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.0" />
        </filter>
        {/* Wilson cloud filter — softer warp that reads as moist condensation
            rather than dusty smoke. */}
        <filter id="wilson-filter" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="13" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
        {/* Heavy blur for the fireball corona to make it glow into the
            surrounding atmosphere. */}
        <filter id="hot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        {/* Building smoke filter — gentle warp + slight blur for the wisps
            rising from destroyed silhouettes. */}
        <filter id="smoke-wisp" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="17" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="0.4" />
        </filter>
      </defs>

      <rect x={0} y={0} width={w} height={h} fill={`url(#${skyId})`} />

      {/* SKY REACTION — the entire scene lights up during the fireball peak.
          Real bursts illuminate the horizon orange-red for several seconds;
          we drive that with a luminosity-modulated overlay rect. The glow
          is anchored at the bottom (ground + fireball position) and falls
          off radially toward the top of the canvas. */}
      {(() => {
        const lum = fireballLuminosity(time);
        if (lum < 0.02 || fireballM === 0) return null;
        return (
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            fill="url(#sky-glow)"
            opacity={lum * 0.85}
            style={{ mixBlendMode: "screen" }}
          />
        );
      })()}

      {/* Ground or water band */}
      <rect x={0} y={ground} width={w} height={h - ground} fill={groundColor} />
      <line
        x1={0}
        x2={w}
        y1={ground}
        y2={ground}
        stroke={isWater ? "#5fa8d3" : "#a3aebd"}
        strokeOpacity={0.6}
        strokeWidth={1.5}
      />

      {/* DAMAGE FLAGS — each ring's radius metric appears as a little flag
          (pole + labeled pill) at the ring's edge. The flag pops up when
          the shockwave reaches that distance, so the viewer sees the blast
          plant its damage markers as it sweeps outward. Inner rings pop
          early; outer rings pop later. */}
      {damageRings && damageRings.length > 0 && shockwavePeakM > 0 && (() => {
        // Inside-out so closer flags get earlier stagger levels (taller
        // poles for outer flags reads as wave-fronts moving outward).
        const rings = [...damageRings].sort((a, b) => a.radiusM - b.radiusM);
        // Invert the shockwave's easeOutCubic curve so each ring knows when
        // the shock front would have reached its radius:
        //   y = 1 − (1 − x)^3  ⇒  x = 1 − (1 − y)^(1/3)
        const popTime = (radiusM: number): number => {
          const frac = Math.min(1, radiusM / shockwavePeakM);
          const x = 1 - Math.pow(1 - frac, 1 / 3);
          return T_SHOCKWAVE_START + x * (T_SHOCKWAVE_END - T_SHOCKWAVE_START);
        };
        // Stagger pole heights when flags cluster horizontally. Walking
        // inside-out, each flag picks the lowest level where it doesn't
        // overlap a previously placed flag.
        const levelEndX: number[] = [];
        return (
          <g pointerEvents="none">
            {rings.map((r) => {
              const rx = r.radiusM * scale;
              if (rx < 4) return null;

              // Has the shockwave reached this ring yet?
              const tArrival = popTime(r.radiusM);
              const sinceArrival = time - tArrival;
              if (sinceArrival < 0) return null;
              // Pop animation — flag snaps up over ~0.25s with overshoot.
              const popScale = easeOutBack(Math.min(1, sinceArrival / 0.25));
              if (popScale < 0.02) return null;

              const isHovered = hoveredRingKey === r.key;
              const leftX = fireballCx - rx;
              const rightX = fireballCx + rx;
              const labelText = `${r.label} · ${fmtMeter(r.radiusM, u)}`;
              // Pill width: char count × monospace width + horizontal padding
              // (4 SVG units on each side ≈ 8-10 px on screen).
              const flagW = labelText.length * 2.5 + 8;

              // Anchor flag to right-tick if on-canvas, else left-tick.
              // Skip entirely if both endpoints are off-canvas.
              let anchorX = rightX;
              if (rightX > w - flagW / 2 || rightX < flagW / 2) {
                anchorX = leftX;
              }
              if (anchorX < flagW / 2 + 2 || anchorX > w - flagW / 2 - 2) return null;

              // Pick the lowest non-overlapping level for this flag
              let level = 0;
              while (
                level < levelEndX.length &&
                levelEndX[level] > anchorX - flagW / 2 - 3
              ) {
                level++;
              }
              if (level === levelEndX.length) levelEndX.push(0);
              levelEndX[level] = anchorX + flagW / 2;

              // Pole height — bigger for higher levels so flags stack into
              // the sky band above silhouettes. Base height plus stagger.
              const fullPoleHeight = 20 + level * 14;
              const poleHeight = fullPoleHeight * popScale;
              const flagH = 9.5; // taller pill with breathing room above/below text
              const flagY = ground - poleHeight; // top of pole = flag center y

              return (
                <g key={r.key}>
                  {/* Ground tick — small mark at the ring edge */}
                  <line
                    x1={anchorX}
                    x2={anchorX}
                    y1={ground - 3}
                    y2={ground + 3}
                    stroke={r.color}
                    strokeOpacity={isHovered ? 1 : 0.85}
                    strokeWidth={isHovered ? 2 : 1.3}
                  />
                  {/* Pole growing up from the tick */}
                  <line
                    x1={anchorX}
                    x2={anchorX}
                    y1={ground}
                    y2={flagY + flagH / 2}
                    stroke={r.color}
                    strokeOpacity={isHovered ? 1 : 0.85}
                    strokeWidth={isHovered ? 1.5 : 1}
                  />
                  {/* Flag pill — dark background + ring-colored border */}
                  <rect
                    x={anchorX - (flagW * popScale) / 2}
                    y={flagY - flagH / 2}
                    width={flagW * popScale}
                    height={flagH}
                    rx={1.5}
                    fill="#0a0d12"
                    fillOpacity={isHovered ? 0.97 : 0.92}
                    stroke={r.color}
                    strokeOpacity={isHovered ? 1 : 0.9}
                    strokeWidth={isHovered ? 1 : 0.7}
                  />
                  {/* Label text — pops in with the pill. dominantBaseline
                      centers it on the pill's vertical midline. */}
                  {popScale > 0.6 && (
                    <text
                      x={anchorX}
                      y={flagY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={r.color}
                      fontSize={4.5}
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight={700}
                      opacity={Math.min(1, (popScale - 0.6) / 0.4)}
                    >
                      {labelText}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })()}

      {/* Scorched ground band removed — the dark shaded region was being
          read as part of the rings and was crowding silhouettes. The
          fireball corona at the base of the stem already conveys "heat
          and damage at the burst point" without obscuring the readable
          damage radii. */}

      {/* Reference objects on the ground — damage state depends on shockwave
          radius at current animation time. Only the human-scale anchor and
          the iconic landmark get labels; mid-tier buildings are visually
          obvious without one, keeping the label row uncrowded.

          Labels stagger vertically when they would overlap horizontally.
          At wide scales (high-yield bursts that need to show city blocks)
          adjacent reference objects can squish together, so we walk
          left-to-right and bump each conflicting label to the next row. */}
      {(() => {
        const shockwaveRadiusM = (() => {
          if (time <= T_SHOCKWAVE_START) return 0;
          if (time >= T_SHOCKWAVE_END) return shockwavePeakM;
          const t = (time - T_SHOCKWAVE_START) / (T_SHOCKWAVE_END - T_SHOCKWAVE_START);
          return shockwavePeakM * easeOutCubic(t);
        })();
        const moderateBlastM = shockwavePeakM / 2.5;
        const severeBlastM = shockwavePeakM / 7.5;
        const ALWAYS_LABELED = new Set([
          "person",
          "6-story building",
          "Empire State Building",
          "Burj Khalifa",
          "Mt Everest",
        ]);

        // First pass: assign label-row indices so overlapping labels stack.
        // We approximate label width at 5.5px per char (fontSize 8, monospace).
        type LabelPlacement = { cx: number; text: string; row: number; halfWidth: number };
        const labels: LabelPlacement[] = [];
        const rowTops: number[] = []; // rightmost x consumed on each row so far
        const sortedRefs = [...refPositions]
          .filter(({ ref }) => ALWAYS_LABELED.has(ref.name))
          .sort((a, b) => a.cx - b.cx);
        for (const { ref, cx } of sortedRefs) {
          const text = refShortLabel(ref);
          const halfWidth = text.length * 2.75 + 4; // +4 for breathing room
          let row = 0;
          while (row < rowTops.length && rowTops[row] > cx - halfWidth) row++;
          if (row === rowTops.length) rowTops.push(0);
          rowTops[row] = cx + halfWidth;
          labels.push({ cx, text, row, halfWidth });
        }
        const labelByName = new Map<string, LabelPlacement>();
        labels.forEach((l, i) => labelByName.set(sortedRefs[i].ref.name, l));

        const elements: React.ReactElement[] = [];
        // Track destroyed positions so we can draw smoke wisps in a later pass
        const destroyedPositions: { cx: number; size: number; destroyedAt: number }[] = [];
        for (const { ref, cx } of refPositions) {
          const distanceM = Math.abs(cx - fireballCx) / scale;
          let state: DamageState = "intact";
          if (distanceM <= shockwaveRadiusM) {
            if (distanceM < severeBlastM) state = "destroyed";
            else if (distanceM < moderateBlastM) state = "destroyed";
            else if (distanceM < shockwavePeakM) state = "damaged";
          }
          // Estimate when shockwave reached this distance (for smoke birth time)
          let destroyedAt = -1;
          if (state === "destroyed") {
            // Invert easeOutCubic(t) = distance/peak → t
            const t = 1 - Math.pow(1 - distanceM / shockwavePeakM, 1 / 3);
            destroyedAt = T_SHOCKWAVE_START + t * (T_SHOCKWAVE_END - T_SHOCKWAVE_START);
            destroyedPositions.push({ cx, size: ref.heightM * scale, destroyedAt });
          }
          const placement = labelByName.get(ref.name);
          elements.push(
            <g key={ref.name}>
              {ref.draw(cx, ground, scale, state)}
              {placement && (
                <text
                  x={cx}
                  y={ground + 8 + placement.row * 7}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.65)"
                  fontSize={5}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {placement.text}
                </text>
              )}
            </g>,
          );
        }
        // SMOKE WISPS — thin streaks rising from destroyed silhouettes.
        // Each wisp appears as the shockwave passes, rises and drifts,
        // fades over ~3 seconds. Drawn as a final pass on top of refs.
        for (const { cx: dcx, size, destroyedAt } of destroyedPositions) {
          if (time < destroyedAt + 0.1) continue;
          const sinceDestroyed = time - destroyedAt;
          const wispOp = Math.max(0, 1 - sinceDestroyed / 3.5);
          if (wispOp < 0.05) continue;
          const wispH = Math.min(40, sinceDestroyed * 16);
          const wispW = Math.max(2, size * 0.18);
          elements.push(
            <ellipse
              key={`smoke-${dcx}`}
              cx={dcx + Math.sin(sinceDestroyed * 1.6) * 2}
              cy={ground - wispH / 2}
              rx={wispW}
              ry={wispH / 2}
              fill="url(#puff-dark)"
              opacity={wispOp * 0.55}
              filter="url(#smoke-wisp)"
              pointerEvents="none"
            />,
          );
        }
        return elements;
      })()}

      {/* Animated shockwave ring expanding across the ground from burst point.
          Drawn before silhouettes/fireball so it sits behind them.
          For underground/underwater bursts, we don't show the shockwave —
          it's contained. */}
      {time > T_SHOCKWAVE_START && shockwavePeakM > 0 &&
        env !== "underground" && env !== "underwater" && (
          <ShockwaveRing
            cx={fireballCx}
            groundY={ground}
            time={time}
            peakRadiusM={shockwavePeakM}
            scale={scale}
          />
      )}

      {/* EMBERS — bright orange specks rising from the fireball region in
          the first few seconds. Real high-speed photography of nuclear
          tests captures these as glowing particles tracking upward through
          the dust column. They cool (turn redder) and fade as they rise. */}
      {fireballM > 0 && time > 0.3 && time < 4.5 &&
        env !== "underground" && env !== "underwater" && (() => {
          // 10 deterministic embers with seeded positions/timings
          const embers: { dx: number; dxDrift: number; birth: number; speed: number; size: number }[] = [
            { dx: -0.7, dxDrift: -0.15, birth: 0.3, speed: 1.0, size: 1.6 },
            { dx: -0.4, dxDrift:  0.05, birth: 0.45, speed: 1.2, size: 1.3 },
            { dx:  0.0, dxDrift:  0.10, birth: 0.5, speed: 1.4, size: 1.8 },
            { dx:  0.3, dxDrift: -0.05, birth: 0.6, speed: 1.1, size: 1.5 },
            { dx:  0.6, dxDrift:  0.20, birth: 0.65, speed: 1.3, size: 1.4 },
            { dx: -0.55, dxDrift: 0.05, birth: 0.9, speed: 1.5, size: 1.2 },
            { dx: -0.2, dxDrift: -0.10, birth: 1.1, speed: 1.0, size: 1.4 },
            { dx:  0.15, dxDrift: 0.05, birth: 1.3, speed: 1.3, size: 1.7 },
            { dx:  0.45, dxDrift: -0.15, birth: 1.5, speed: 1.1, size: 1.3 },
            { dx: -0.35, dxDrift: 0.10, birth: 1.8, speed: 1.4, size: 1.5 },
          ];
          return embers.map((e, i) => {
            if (time < e.birth) return null;
            const age = time - e.birth;
            // Embers rise from fireball center, accelerating then settling
            const riseY = age * 35 * e.speed + age * age * 6;
            const x = fireballCx + e.dx * fireballPxR + e.dxDrift * age * 8;
            const y = fireballCy - riseY;
            // Cool from yellow-white through orange to deep red as they age
            const cool = Math.min(1, age / 2.5);
            const r = Math.round(255 - cool * 50);
            const g = Math.round(220 - cool * 160);
            const b = Math.round(140 - cool * 130);
            const color = `rgb(${r},${g},${b})`;
            const opacity = Math.max(0, (1 - age / 3) * 0.9);
            return (
              <circle
                key={`ember-${i}`}
                cx={x}
                cy={y}
                r={e.size * (1 - age * 0.15)}
                fill={color}
                opacity={opacity}
                pointerEvents="none"
              />
            );
          });
        })()}

      {/* WILSON CONDENSATION CLOUD — pale toroidal vapor ring that briefly
          appears behind the leading shock front in humid atmospheres.
          Its iconic visual signature instantly reads "nuclear test."
          The ring expands with the shockwave, peaks near 1s, dissipates by ~2s. */}
      {time > T_WILSON_START && time < T_WILSON_END && fireballM > 0 &&
        env !== "underground" && env !== "underwater" && (() => {
          const t = (time - T_WILSON_START) / (T_WILSON_END - T_WILSON_START);
          // Radius grows from ~1.5× fireball to ~4.5× fireball over the
          // visible window. Visualizes the rarefaction sphere behind the shock.
          const radius = fireballPxR * (1.5 + 3.0 * easeOutCubic(t));
          // Opacity follows a smooth in/out — peak around T_WILSON_PEAK.
          const peakNorm = (T_WILSON_PEAK - T_WILSON_START) / (T_WILSON_END - T_WILSON_START);
          const op =
            t < peakNorm
              ? (t / peakNorm) * 0.85
              : (1 - (t - peakNorm) / (1 - peakNorm)) * 0.85;
          return (
            <circle
              cx={fireballCx}
              cy={fireballCy}
              r={radius}
              fill="url(#wilson-cloud)"
              opacity={Math.max(0, op)}
              filter="url(#wilson-filter)"
              pointerEvents="none"
            />
          );
        })()}

      {/* Animated mushroom cloud — stem + cap. Hidden for contained bursts. */}
      {time > T_STEM_START && fireballM > 0 &&
        env !== "underground" && env !== "underwater" && env !== "rocket" && (
          <MushroomCloud
            cx={fireballCx}
            groundY={ground}
            time={time}
            fireballM={fireballM}
            scale={scale}
            maxHeightPx={ground - 16}
          />
      )}

      {/* Fireball at scale. Position depends on environment. */}
      {fireballM > 0 && (
        <g>
          {(() => {
            // Animated radius — rapid initial expansion, slowing as fireball
            // reaches its peak diameter near T_FIREBALL_PEAK.
            const expandT = easeOutCubic(progress(time, 0, T_FIREBALL_PEAK));
            const animatedR = fireballPxR * expandT;

            // Blackbody-driven color from cooling temperature curve. Replaces
            // the old 5-stop step function with a smooth physical
            // interpolation between 8000K (white) and 1400K (deep red).
            const temp = fireballTemperature(time);
            const color = blackbodyColor(temp);
            const luminosity = fireballLuminosity(time);

            // Overall envelope — combines luminosity (drives brightness)
            // and the slow fade-out after the second flash.
            const fadeOpacity =
              1 - easeOutQuad(progress(time, T_FIREBALL_FADE_START, T_FIREBALL_FADE_END));

            const cy = fireballCy;

            // Subsurface hot spots — bright knots of plasma inside the
            // fireball. Positions are deterministic per seed so they don't
            // shuffle between frames. Each spot has its own micro-flicker
            // pulse driven by sin(time × freq).
            const hotSpots: { dx: number; dy: number; r: number; freq: number; phase: number }[] = [
              { dx: -0.35, dy: -0.20, r: 0.28, freq: 7.0, phase: 0.0 },
              { dx:  0.20, dy:  0.30, r: 0.22, freq: 5.5, phase: 1.4 },
              { dx:  0.40, dy: -0.30, r: 0.20, freq: 9.0, phase: 2.7 },
              { dx: -0.15, dy:  0.10, r: 0.18, freq: 6.3, phase: 0.9 },
              { dx:  0.05, dy: -0.40, r: 0.15, freq: 8.2, phase: 2.0 },
            ];

            return (
              <>
                {/* CORONA — wide soft glow that bleeds into surrounding sky.
                    Brightness pulses with luminosity envelope (so it dims at
                    the Teller-Ulam dip and rebrightens at the second flash). */}
                <circle
                  cx={fireballCx}
                  cy={cy}
                  r={animatedR * (2.2 + luminosity * 1.6)}
                  fill="url(#fireball-corona)"
                  opacity={luminosity * 0.85}
                  filter="url(#hot-glow)"
                />

                {/* MID PLASMA — visible fireball boundary. Color is the
                    blackbody-driven mid-temperature tint. */}
                <circle
                  cx={fireballCx}
                  cy={cy}
                  r={animatedR}
                  fill="url(#fireball-core)"
                  opacity={Math.max(luminosity, fadeOpacity * 0.7)}
                />

                {/* TEMPERATURE OVERLAY — paint the blackbody color over the
                    plasma so the fireball visibly shifts from white-hot to
                    yellow to orange to deep red as it cools. */}
                <circle
                  cx={fireballCx}
                  cy={cy}
                  r={animatedR * 0.92}
                  fill={color}
                  opacity={fadeOpacity * 0.55}
                />

                {/* SUBSURFACE HOT SPOTS — small bright knots inside the
                    fireball, suggesting turbulent plasma rather than a
                    uniform sphere. Visible only while fireball is hot
                    enough to read as glowing (luminosity > 0.15). */}
                {luminosity > 0.15 && animatedR > 8 && hotSpots.map((hs, i) => {
                  const pulse = 0.7 + 0.3 * Math.sin(time * hs.freq + hs.phase);
                  return (
                    <circle
                      key={i}
                      cx={fireballCx + hs.dx * animatedR}
                      cy={cy + hs.dy * animatedR}
                      r={animatedR * hs.r * pulse}
                      fill="#ffe7b0"
                      opacity={luminosity * 0.55 * pulse}
                      filter="url(#hot-glow)"
                    />
                  );
                })}

                {/* INNER WHITE-HOT CORE — only during the first ~600ms while
                    fireball plasma is above ~5000K. Drives the eye to the
                    brightest center even as the outer layers cool. */}
                {luminosity > 0.3 && (
                  <circle
                    cx={fireballCx}
                    cy={cy}
                    r={animatedR * 0.45}
                    fill="#ffffff"
                    opacity={Math.min(1, luminosity * 1.3)}
                  />
                )}

                {/* HOB indicator line for atmospheric bursts */}
                {(env === "atmospheric" || env === "rocket") && hobM > 0 && (() => {
                  const hobPx = Math.min(usableH - fireballPxR - 4, hobM * scale);
                  return hobPx > fireballPxR + 6 ? (
                    <line
                      x1={fireballCx}
                      x2={fireballCx}
                      y1={cy + animatedR}
                      y2={ground}
                      stroke="#e8893a"
                      strokeOpacity={0.4}
                      strokeWidth={1}
                      strokeDasharray="2 3"
                    />
                  ) : null;
                })()}

                {/* DETONATION FLASH — full-canvas blinding burst at t=0,
                    with Teller-Ulam double-flash structure:
                      • First peak: pure white wash, dims rapidly
                      • Dim valley around T_FLASH_DIM
                      • Second peak as fireball "wins" through opaque shell
                    Drives both a full-canvas tint AND an outer corona pulse. */}
                {time < T_FLASH_END && (
                  <>
                    <rect
                      x={0}
                      y={0}
                      width={SVG_W}
                      height={SIDE_H}
                      fill="#ffffff"
                      opacity={
                        // First flash: bright at t=0, fades to FLASH_DIM
                        time < T_FLASH_DIM
                          ? 0.85 * (1 - progress(time, 0, T_FLASH_DIM))
                          // Second flash: rises again through T_FLASH_SECOND
                          : 0.45 * easeOutQuad(progress(time, T_FLASH_DIM, T_FLASH_SECOND)) *
                              (1 - progress(time, T_FLASH_SECOND, T_FLASH_END))
                      }
                      pointerEvents="none"
                    />
                    <circle
                      cx={fireballCx}
                      cy={cy}
                      r={Math.max(animatedR * 6, 80)}
                      fill="url(#fireball-corona)"
                      opacity={
                        time < T_FLASH_DIM
                          ? 1 - progress(time, 0, T_FLASH_DIM)
                          : easeOutQuad(progress(time, T_FLASH_DIM, T_FLASH_SECOND)) *
                              (1 - progress(time, T_FLASH_SECOND, T_FLASH_END))
                      }
                      filter="url(#hot-glow)"
                    />
                  </>
                )}
              </>
            );
          })()}
          {/* Fireball label — sits ABOVE the fireball when there's sky room,
              else INSIDE the fireball circle. Never below ground (that's
              scale-ref territory). Reduced font size: SVG viewBox is only
              300 wide so fontSize 5-6 reads ~10-12px at typical panel widths. */}
          <text
            x={fireballCx}
            y={Math.max(10, fireballCy - fireballPxR - 4)}
            textAnchor="middle"
            fill="rgba(255,200,120,0.95)"
            fontSize={5}
            fontFamily="JetBrains Mono, monospace"
            fontWeight={700}
          >
            ☢ FIREBALL · {fmtMeter(fireballDiameter / 2, u)} r
          </text>
        </g>
      )}

      {/* Top-right pixel scale legend */}
      <text
        x={w - 6}
        y={8}
        textAnchor="end"
        fill="rgba(255,255,255,0.35)"
        fontSize={5}
        fontFamily="JetBrains Mono, monospace"
      >
        1 px ≈ {fmtMeter(1 / scale, u)}
      </text>

      {/* HOB label beside the fireball at the actual burst altitude. */}
      {(env === "atmospheric" || env === "rocket") && hobM > 0 && (
        <text
          x={fireballCx + fireballPxR + 4}
          y={Math.max(14, Math.min(ground - 4, fireballCy + 2))}
          fill="rgba(255,209,102,0.85)"
          fontSize={5}
          fontFamily="JetBrains Mono, monospace"
        >
          {fmtMeter(hobM, u)} HOB
        </text>
      )}

    </g>
  );
}

// Animated shockwave: an expanding ring on the ground that propagates outward
// from the burst point. Drawn as a paired line+arc that fades as it expands.
function ShockwaveRing({
  cx,
  groundY,
  time,
  peakRadiusM,
  scale,
}: {
  cx: number;
  groundY: number;
  time: number;
  peakRadiusM: number;
  scale: number;
}) {
  const t = progress(time, T_SHOCKWAVE_START, T_SHOCKWAVE_END);
  if (t <= 0) return null;
  const radiusM = peakRadiusM * easeOutCubic(t);
  const radiusPx = radiusM * scale;
  // Fade as it expands so it doesn't dominate the scene at peak
  const opacity = 1 - t * 0.6;
  return (
    <g>
      {/* Visible arc on the ground (sweeping outward both directions) */}
      <line
        x1={cx - radiusPx}
        x2={cx - radiusPx}
        y1={groundY - 4}
        y2={groundY}
        stroke="#ffd166"
        strokeWidth={2}
        opacity={opacity}
      />
      <line
        x1={cx + radiusPx}
        x2={cx + radiusPx}
        y1={groundY - 4}
        y2={groundY}
        stroke="#ffd166"
        strokeWidth={2}
        opacity={opacity}
      />
      {/* Pressure-wave indicator: a thin arc above the ground at the shockwave front */}
      <path
        d={`M ${cx - radiusPx} ${groundY} Q ${cx - radiusPx} ${groundY - 8} ${cx - radiusPx + 6} ${groundY - 6}`}
        fill="none"
        stroke="#ffd166"
        strokeWidth={1}
        opacity={opacity * 0.6}
      />
      <path
        d={`M ${cx + radiusPx} ${groundY} Q ${cx + radiusPx} ${groundY - 8} ${cx + radiusPx - 6} ${groundY - 6}`}
        fill="none"
        stroke="#ffd166"
        strokeWidth={1}
        opacity={opacity * 0.6}
      />
    </g>
  );
}


// Mushroom cloud — coherent silhouette approach. Rather than rendering as
// hundreds of independent puff particles (which read as cotton balls), we
// build a single mushroom-shaped path (cap + stem + foot) and warp it with
// an SVG turbulence filter so the edges feel organic and billowing. A
// handful of subtle internal billows on top add surface texture without
// fragmenting the silhouette. Animation drives the silhouette's growth and
// late-stage dissipation continuously.
// Mushroom cloud — particle system of independent convective puffs. Each
// puff has its own birth time, rise rate, drift, color gradient, and
// turbulence seed. Compose them into stem braid + cap convective cells +
// underside shadow + outer skirt + anvil ice cap + foot dust skirt. The
// goal is to capture the *system* of a real mushroom cloud rather than
// approximate it with a single warped silhouette path.
//
// All offsets in puff defs are in cap-radius units, scaled per-yield.
type PuffDef = {
  id: string;
  baseDx: number;
  baseDy: number; // negative = above origin
  baseRx: number;
  baseRy: number;
  birthT: number;
  peakT: number;
  decayT?: number;
  riseMult: number; // 0 = static at base, 1 = rises with stem, >1 = faster
  driftX: number; // pixels of horizontal drift per second (in cap-radius units)
  gradient:
    | "puff-light"
    | "puff-mid"
    | "puff-dark"
    | "puff-charcoal"
    | "puff-dustbrown"
    | "puff-ice"
    | "puff-warmglow";
  filter?: "cloud-turb" | "cloud-turb-coarse";
};

// Cap puffs — distributed across the dome. The ordering matters for visual
// depth: shadow underside first (drawn behind), mid billows, top crown,
// then anvil overlay. Each draws as a single ellipse warped by turbulence.
const CAP_PUFFS_BACK: PuffDef[] = [
  // BACKDROP MASS — a single very large dark puff that fills the cap's
  // overall envelope. Without this, the smaller convective puffs read as
  // a disconnected cluster of bubbles; with this they blend into a
  // coherent silhouette with internal structure.
  { id: "backdrop",  baseDx:  0.00, baseDy: -0.05, baseRx: 1.40, baseRy: 1.00, birthT: 2.0, peakT: 3.3, riseMult: 0.95, driftX:  0.00, gradient: "puff-mid", filter: "cloud-turb-coarse" },
  // Underside shadow ring — drawn after backdrop so the cap reads with
  // proper dimensionality. These are the darkest, largest, drape lowest.
  { id: "shadow-l",  baseDx: -0.75, baseDy:  0.50, baseRx: 0.80, baseRy: 0.65, birthT: 2.3, peakT: 3.6, riseMult: 0.9,  driftX: -0.04, gradient: "puff-charcoal", filter: "cloud-turb-coarse" },
  { id: "shadow-c",  baseDx:  0.00, baseDy:  0.60, baseRx: 0.95, baseRy: 0.65, birthT: 2.2, peakT: 3.5, riseMult: 0.85, driftX:  0.00, gradient: "puff-charcoal", filter: "cloud-turb-coarse" },
  { id: "shadow-r",  baseDx:  0.75, baseDy:  0.50, baseRx: 0.80, baseRy: 0.65, birthT: 2.3, peakT: 3.6, riseMult: 0.9,  driftX:  0.04, gradient: "puff-charcoal", filter: "cloud-turb-coarse" },
  // Outer skirt — droops below equator, slightly outside cap radius
  { id: "skirt-fl", baseDx: -1.25, baseDy:  0.40, baseRx: 0.60, baseRy: 0.55, birthT: 2.6, peakT: 4.0, decayT: 5.5, riseMult: 0.85, driftX: -0.10, gradient: "puff-dark", filter: "cloud-turb" },
  { id: "skirt-fr", baseDx:  1.25, baseDy:  0.40, baseRx: 0.60, baseRy: 0.55, birthT: 2.6, peakT: 4.0, decayT: 5.5, riseMult: 0.85, driftX:  0.10, gradient: "puff-dark", filter: "cloud-turb" },
];

const CAP_PUFFS_FRONT: PuffDef[] = [
  // Mid convective cells — biggest visible features (now 45% wider so
  // adjacent billows overlap heavily, blending into a single mass).
  { id: "billow-fl", baseDx: -1.00, baseDy: -0.05, baseRx: 0.80, baseRy: 0.75, birthT: 2.0, peakT: 3.3, riseMult: 1.0,  driftX: -0.06, gradient: "puff-mid", filter: "cloud-turb-coarse" },
  { id: "billow-cl", baseDx: -0.40, baseDy: -0.20, baseRx: 0.80, baseRy: 0.80, birthT: 1.9, peakT: 3.2, riseMult: 1.05, driftX: -0.02, gradient: "puff-mid", filter: "cloud-turb-coarse" },
  { id: "billow-cc", baseDx:  0.00, baseDy: -0.30, baseRx: 0.80, baseRy: 0.80, birthT: 1.95, peakT: 3.25, riseMult: 1.08, driftX:  0.00, gradient: "puff-mid", filter: "cloud-turb-coarse" },
  { id: "billow-cr", baseDx:  0.40, baseDy: -0.20, baseRx: 0.80, baseRy: 0.80, birthT: 1.9, peakT: 3.2, riseMult: 1.05, driftX:  0.02, gradient: "puff-mid", filter: "cloud-turb-coarse" },
  { id: "billow-fr", baseDx:  1.00, baseDy: -0.05, baseRx: 0.80, baseRy: 0.75, birthT: 2.0, peakT: 3.3, riseMult: 1.0,  driftX:  0.06, gradient: "puff-mid", filter: "cloud-turb-coarse" },
  // Top crowns — brightest, on the upper surface, also bigger and lapping
  { id: "crown-l",  baseDx: -0.65, baseDy: -0.70, baseRx: 0.65, baseRy: 0.55, birthT: 2.4, peakT: 3.7, riseMult: 1.1,  driftX: -0.04, gradient: "puff-light", filter: "cloud-turb" },
  { id: "crown-c",  baseDx:  0.00, baseDy: -0.85, baseRx: 0.75, baseRy: 0.60, birthT: 2.3, peakT: 3.6, riseMult: 1.15, driftX:  0.00, gradient: "puff-light", filter: "cloud-turb" },
  { id: "crown-r",  baseDx:  0.65, baseDy: -0.70, baseRx: 0.65, baseRy: 0.55, birthT: 2.4, peakT: 3.7, riseMult: 1.1,  driftX:  0.04, gradient: "puff-light", filter: "cloud-turb" },
];

// Anvil layer — appears AFTER cap hits tropopause. These spread horizontally,
// stay flat, and carry the cool blue-white tint of ice crystals.
const ANVIL_PUFFS: PuffDef[] = [
  { id: "anvil-fl", baseDx: -1.30, baseDy: -0.95, baseRx: 0.45, baseRy: 0.20, birthT: 4.0, peakT: 5.5, riseMult: 0.55, driftX: -0.15, gradient: "puff-ice", filter: "cloud-turb" },
  { id: "anvil-cl", baseDx: -0.55, baseDy: -1.10, baseRx: 0.55, baseRy: 0.22, birthT: 3.8, peakT: 5.3, riseMult: 0.65, driftX: -0.05, gradient: "puff-ice", filter: "cloud-turb" },
  { id: "anvil-cr", baseDx:  0.55, baseDy: -1.10, baseRx: 0.55, baseRy: 0.22, birthT: 3.8, peakT: 5.3, riseMult: 0.65, driftX:  0.05, gradient: "puff-ice", filter: "cloud-turb" },
  { id: "anvil-fr", baseDx:  1.30, baseDy: -0.95, baseRx: 0.45, baseRy: 0.20, birthT: 4.0, peakT: 5.5, riseMult: 0.55, driftX:  0.15, gradient: "puff-ice", filter: "cloud-turb" },
];

// Stem puffs — vertical braid of dust/smoke. dy is measured in stem-radius
// units from the GROUND (positive = above ground). Multiple offset puffs at
// each elevation create the braided/twisting look of real stems.
const STEM_PUFFS: PuffDef[] = [
  // BACKDROP COLUMN — wide-but-tall ellipse spanning the full stem, so
  // the puffs below blend into a coherent column rather than reading as
  // discrete pearls on a string.
  { id: "stem-back",   baseDx:  0.00, baseDy: -2.0, baseRx: 0.45, baseRy: 2.0,  birthT: 1.0, peakT: 2.6, riseMult: 0.55, driftX: 0,     gradient: "puff-dark",     filter: "cloud-turb-coarse" },
  { id: "stem-base-c", baseDx:  0.00, baseDy: -0.4, baseRx: 0.70, baseRy: 0.45, birthT: 0.6, peakT: 1.4, riseMult: 0,    driftX: 0,     gradient: "puff-warmglow", filter: "cloud-turb" },
  { id: "stem-1l",     baseDx: -0.22, baseDy: -0.9, baseRx: 0.45, baseRy: 0.65, birthT: 0.9, peakT: 2.0, riseMult: 0.20, driftX: -0.02, gradient: "puff-dark",     filter: "cloud-turb" },
  { id: "stem-1r",     baseDx:  0.22, baseDy: -0.9, baseRx: 0.45, baseRy: 0.65, birthT: 1.0, peakT: 2.1, riseMult: 0.20, driftX:  0.02, gradient: "puff-dark",     filter: "cloud-turb" },
  { id: "stem-2c",     baseDx:  0.00, baseDy: -1.7, baseRx: 0.50, baseRy: 0.75, birthT: 1.3, peakT: 2.4, riseMult: 0.45, driftX:  0,    gradient: "puff-dark",     filter: "cloud-turb" },
  { id: "stem-3l",     baseDx: -0.18, baseDy: -2.6, baseRx: 0.48, baseRy: 0.75, birthT: 1.6, peakT: 2.8, riseMult: 0.65, driftX: -0.04, gradient: "puff-mid",      filter: "cloud-turb" },
  { id: "stem-3r",     baseDx:  0.18, baseDy: -2.6, baseRx: 0.48, baseRy: 0.75, birthT: 1.7, peakT: 2.9, riseMult: 0.65, driftX:  0.04, gradient: "puff-mid",      filter: "cloud-turb" },
  { id: "stem-4c",     baseDx:  0.02, baseDy: -3.6, baseRx: 0.55, baseRy: 0.75, birthT: 2.0, peakT: 3.2, riseMult: 0.85, driftX:  0,    gradient: "puff-mid",      filter: "cloud-turb" },
];

// Foot puffs — wide dust skirt at ground level, expands outward over the
// first 2 seconds and slowly settles. Persists longer than the fireball.
const FOOT_PUFFS: PuffDef[] = [
  { id: "foot-fl", baseDx: -1.6, baseDy: 0.05, baseRx: 0.7, baseRy: 0.30, birthT: 0.5, peakT: 1.7, decayT: 5.5, riseMult: 0, driftX: -0.5, gradient: "puff-dustbrown", filter: "cloud-turb" },
  { id: "foot-cl", baseDx: -0.7, baseDy: 0.05, baseRx: 0.75, baseRy: 0.30, birthT: 0.4, peakT: 1.4, decayT: 5.5, riseMult: 0, driftX: -0.22, gradient: "puff-dustbrown", filter: "cloud-turb" },
  { id: "foot-c",  baseDx:  0.0, baseDy: 0.10, baseRx: 0.85, baseRy: 0.32, birthT: 0.35, peakT: 1.3, decayT: 5.5, riseMult: 0, driftX:  0,   gradient: "puff-dustbrown", filter: "cloud-turb" },
  { id: "foot-cr", baseDx:  0.7, baseDy: 0.05, baseRx: 0.75, baseRy: 0.30, birthT: 0.4, peakT: 1.4, decayT: 5.5, riseMult: 0, driftX:  0.22, gradient: "puff-dustbrown", filter: "cloud-turb" },
  { id: "foot-fr", baseDx:  1.6, baseDy: 0.05, baseRx: 0.7, baseRy: 0.30, birthT: 0.5, peakT: 1.7, decayT: 5.5, riseMult: 0, driftX:  0.5, gradient: "puff-dustbrown", filter: "cloud-turb" },
];

// Render a single puff. Returns null if the puff isn't visible yet or has
// fully decayed. Position/size/opacity are all functions of time. Does NOT
// apply the filter inline — caller groups puffs by filter type so SVG only
// creates one offscreen buffer per filter (instead of one per ellipse,
// which would crater frame rate on mobile with ~25 puffs).
function renderPuff(
  puff: PuffDef,
  cxOrigin: number,
  cyOrigin: number,
  unitR: number,
  riseAmount: number,
  time: number,
  globalDissipate: number,
): React.ReactElement | null {
  if (time < puff.birthT) return null;
  const sinceBirth = time - puff.birthT;
  const grow = Math.min(1, sinceBirth / (puff.peakT - puff.birthT));
  const fadeIn = easeOutQuad(grow);
  let fadeOut = 1;
  if (puff.decayT !== undefined && time > puff.decayT) {
    fadeOut = Math.max(0, 1 - (time - puff.decayT) / 1.5);
  }
  const op = fadeIn * fadeOut * globalDissipate;
  if (op <= 0.005) return null;

  const cx = cxOrigin + puff.baseDx * unitR + puff.driftX * unitR * sinceBirth;
  const cy = cyOrigin + puff.baseDy * unitR - riseAmount * puff.riseMult;
  const rx = puff.baseRx * unitR * easeOutCubic(grow);
  const ry = puff.baseRy * unitR * easeOutCubic(grow);

  return (
    <ellipse
      key={puff.id}
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      fill={`url(#${puff.gradient})`}
      opacity={op}
    />
  );
}

// Helper: render a list of puffs into ONE group per filter type. SVG
// applies the filter to the merged group output, so we pay one offscreen
// buffer cost instead of one per ellipse.
function renderPuffGroup(
  puffs: PuffDef[],
  cxOrigin: number,
  cyOrigin: number,
  unitR: number,
  riseAmount: number,
  time: number,
  globalDissipate: number,
  groupKey: string,
): React.ReactElement[] {
  const byFilter = new Map<string, React.ReactElement[]>();
  for (const p of puffs) {
    const el = renderPuff(p, cxOrigin, cyOrigin, unitR, riseAmount, time, globalDissipate);
    if (!el) continue;
    const filterKey = p.filter ?? "no-filter";
    const arr = byFilter.get(filterKey) ?? [];
    arr.push(el);
    byFilter.set(filterKey, arr);
  }
  const groups: React.ReactElement[] = [];
  byFilter.forEach((elements, filterKey) => {
    groups.push(
      <g
        key={`${groupKey}-${filterKey}`}
        filter={filterKey === "no-filter" ? undefined : `url(#${filterKey})`}
      >
        {elements}
      </g>,
    );
  });
  return groups;
}

function MushroomCloud({
  cx,
  groundY,
  time,
  fireballM,
  scale,
  maxHeightPx,
}: {
  cx: number;
  groundY: number;
  time: number;
  fireballM: number;
  scale: number;
  maxHeightPx: number;
}) {
  const fireballPxR = Math.max(4, fireballM * scale);
  if (time < 0.3) return null;

  // Stem rise — drives the vertical anchor for cap puffs. Stem reaches
  // ~8× fireball radius height, or clamped to canvas usable height.
  const stemFrontT = easeOutQuad(progress(time, T_STEM_START, T_STEM_END));
  const targetStemH = Math.min(maxHeightPx - 4, fireballPxR * 9);
  const stemH = targetStemH * stemFrontT;
  const stemTopY = groundY - stemH;

  // Cap formation — bloom outward as stem matures. Anvil spread phase
  // (after T_ANVIL_START) flattens the cap and lets the anvil puffs spread.
  const capT = easeOutQuad(progress(time, T_CAP_START, T_CAP_END));
  const anvilSpread = easeOutCubic(progress(time, T_ANVIL_START, T_END));

  // Cap origin sits a bit above the stem top
  const capRadius = fireballPxR * 1.6 * (capT * 0.85 + 0.15); // grows with cap maturity
  const capOriginY = stemTopY - capRadius * 0.5;
  // Anvil spread stretches cap horizontally, compresses vertically
  const capUnitR = capRadius * (1 + anvilSpread * 0.5);
  const capUnitRy = capRadius * (1 - anvilSpread * 0.25);

  // Stem unit: stem radius (smaller than cap)
  const stemUnit = fireballPxR * 1.2;
  // Stem puffs' anchor is at the ground; rise of stem itself is targetStemH
  const stemRiseAmount = stemH; // how far the *top* of stem has traveled
  // Foot puffs' anchor is the ground
  const footUnit = fireballPxR * 1.6;

  // Anvil's effective horizontal stretch — applied to cap-puff cx positions
  // via a horizontal scale around the cap center. Suppresses tropopause
  // ceiling: if the cap origin is already near the top of the canvas, force
  // anvil spread regardless of T_ANVIL_START.
  const ceilingHit = capOriginY < 12;
  const effectiveAnvil = Math.max(anvilSpread, ceilingHit ? 0.5 : 0);

  // Late-stage global dissipation — fades the whole cloud system in the last
  // half-second of the animation so it doesn't vanish abruptly.
  const globalDissipate = Math.max(0, 1 - progress(time, 5.5, T_END));

  // Wind drift — slow horizontal drift of the cap as it rises and
  // matures. Stems are anchored at the ground (less drift); cap and
  // anvil drift more. Strength scales gently with time so the cloud
  // visibly leans downwind by the end of the animation.
  const windDriftPx = easeOutQuad(progress(time, 1.5, T_END)) * stemUnit * 1.2;

  return (
    <g>
      {/* FOOT DUST — kicked-up debris ring around the base. Drawn first so
          everything else sits in front of it. Persists past fireball fade. */}
      {renderPuffGroup(FOOT_PUFFS, cx, groundY, footUnit, 0, time, globalDissipate, "foot")}

      {/* STEM — vertical braid rising from ground. Each puff has its own
          rise rate and slight horizontal drift, so the column visibly
          twists rather than reading as a clean rectangle. Small wind
          drift in the upper stem leans into the cloud's overall drift. */}
      <g transform={`translate(${windDriftPx * 0.25} 0)`}>
        {renderPuffGroup(STEM_PUFFS, cx, groundY, stemUnit, stemRiseAmount, time, globalDissipate, "stem")}
      </g>

      {/* CAP BACK LAYER — underside shadow + outer skirt. Drawn behind the
          front billows so the cap has visible 3D structure. Wind drift
          applied to the whole cap so it leans downwind. */}
      <g
        transform={
          (effectiveAnvil > 0
            ? `translate(${cx + windDriftPx} ${capOriginY}) scale(${1 + effectiveAnvil * 0.6} ${1 - effectiveAnvil * 0.3}) translate(${-cx} ${-capOriginY})`
            : `translate(${windDriftPx} 0)`)
        }
      >
        {renderPuffGroup(CAP_PUFFS_BACK, cx, capOriginY, capRadius, 0, time, globalDissipate, "capback")}
      </g>

      {/* CAP FRONT LAYER — convective billows + bright top crowns. */}
      <g
        transform={
          effectiveAnvil > 0
            ? `translate(${cx + windDriftPx} ${capOriginY}) scale(${1 + effectiveAnvil * 0.6} ${1 - effectiveAnvil * 0.3}) translate(${-cx} ${-capOriginY})`
            : `translate(${windDriftPx} 0)`
        }
      >
        {renderPuffGroup(CAP_PUFFS_FRONT, cx, capOriginY, capRadius, 0, time, globalDissipate, "capfront")}
      </g>

      {/* ANVIL ICE CAP — pale blue-white spread at the top when the cloud
          hits the tropopause. Only renders once the cap has matured.
          Drift is slightly stronger up here (winds aloft are faster). */}
      {capT > 0.7 && (
        <g transform={`translate(${windDriftPx * 1.4} 0)`}>
          {renderPuffGroup(ANVIL_PUFFS, cx, capOriginY, capUnitR, 0, time, globalDissipate, "anvil")}
        </g>
      )}

      {/* RESIDUAL GROUND GLOW — the fireball's afterglow at the base of the
          stem after the bright flash is gone. Fades over ~3s. */}
      {(() => {
        const heatGlow = Math.max(0, 1 - progress(time, 1.4, 4.0));
        if (heatGlow < 0.02) return null;
        return (
          <g opacity={heatGlow * globalDissipate}>
            <circle
              cx={cx}
              cy={groundY - fireballPxR * 0.15}
              r={fireballPxR * 1.9}
              fill="url(#fireball-corona)"
              filter="url(#hot-glow)"
            />
            <circle
              cx={cx}
              cy={groundY - fireballPxR * 0.25}
              r={fireballPxR * 0.7}
              fill="#e8893a"
              opacity={0.45}
            />
          </g>
        );
      })()}

      {/* Reference touch — silence the unused-var warning. capUnitRy
          influences the cap front layer's vertical visual extent via the
          containing transform's scale-y; capRadius and stemTopY likewise
          feed the puff origins above. */}
      {capUnitRy ? null : null}
    </g>
  );
}

// Compose a "city block" silhouette set: always 5-7 mixed buildings + one
// landmark sized to the fireball, so the diagram reads as a populated place
// rather than a few isolated reference objects. The composition includes:
//   • a person (human scale anchor)
//   • 1-2 single-family residences
//   • 1-2 low-rise apartment/office buildings
//   • 1 mid-rise tower
//   • 1 landmark scaled to the fireball (Empire State for kilotons,
//     Burj/Everest for megaton-class)
function pickReferences(diameterM: number): RefObject[] {
  // Person + houses are always there for human/residential scale
  const base: RefObject[] = [PERSON, HOUSE, SUBURBAN_HOUSE, LOW_RISE];

  // Add mid-rise + office tower so the city skyline reads as a real metro
  // rather than a couple of isolated houses next to a landmark
  base.push(MID_RISE);
  base.push(OFFICE_TOWER);

  // Pick ONE landmark for "iconic scale" based on fireball size
  if (diameterM < 200) {
    base.push(BUILDING);
  } else if (diameterM < 1000) {
    base.push(SKYSCRAPER);
  } else if (diameterM < 6000) {
    base.push(BURJ);
  } else {
    base.push(EVEREST);
  }

  return base;
}

// Compact label for tight side-view placement (just the short name, no height).
function refShortLabel(r: RefObject): string {
  // Map full names → short forms that fit under the silhouette
  const shortMap: Record<string, string> = {
    "person": "person",
    "2-story house": "house",
    "6-story building": "building",
    "Empire State Building": "Empire State",
    "Burj Khalifa": "Burj Khalifa",
    "Mt Everest": "Mt Everest",
  };
  return shortMap[r.name] ?? r.name;
}

function envLabel(env: DetonationEnv): string {
  switch (env) {
    case "atmospheric": return "Air burst";
    case "surface":     return "Surface burst";
    case "underground": return "Contained underground";
    case "underwater":  return "Underwater burst";
    case "barge":       return "Surface over water";
    case "rocket":      return "High-altitude burst";
    case "incident":    return "Incident";
  }
}

// Compact meter formatter for inline use. Differs from fmtDistance in being
// more concise (no decimal padding on round numbers). Accepts a unit system
// — when "imperial", emits in/ft/mi instead of cm/m/km.
function fmtMeter(m: number, units: UnitSystem = "metric"): string {
  if (units === "imperial") {
    if (m < 0.3048) return `${Math.round(m * 39.37)} in`;
    const ft = m * 3.28084;
    if (ft < 1000) return `${ft < 10 ? ft.toFixed(1) : Math.round(ft)} ft`;
    const mi = m * 0.000621371;
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }
  if (m < 1) return `${(m * 100).toFixed(0)} cm`;
  if (m < 100) return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

function ScaleBar({
  scale,
  cx,
  y,
  maxRadiusM,
  units,
}: {
  scale: number;
  cx: number;
  y: number;
  maxRadiusM: number;
  units: UnitSystem;
}) {
  // Pick a round-number reference length (in meters) whose pixel width is
  // between 30 and 120; the label renders in the active unit system.
  const candidates = [100, 500, 1000, 5000, 10_000, 50_000, 100_000, 500_000];
  let chosen = candidates[0];
  for (const c of candidates) {
    const px = c * scale;
    if (px >= 30 && px <= 120) { chosen = c; break; }
    if (c < maxRadiusM) chosen = c;
  }
  const px = chosen * scale;
  const x0 = cx - px / 2;
  const x1 = cx + px / 2;
  return (
    <g>
      <line x1={x0} x2={x1} y1={y} y2={y} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
      <line x1={x0} x2={x0} y1={y - 4} y2={y + 4} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
      <line x1={x1} x2={x1} y1={y - 4} y2={y + 4} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
      <text
        x={cx}
        y={y + 14}
        textAnchor="middle"
        fill="rgba(255,255,255,0.55)"
        fontSize={10}
        fontFamily="JetBrains Mono, monospace"
      >
        {fmtMeter(chosen, units)}
      </text>
    </g>
  );
}

function fmtYield(kt: number): string {
  if (kt < 1) return `${(kt * 1000).toFixed(0)} tons`;
  if (kt < 1000) return `${kt < 10 ? kt.toFixed(1) : Math.round(kt)} kt`;
  return `${(kt / 1000).toFixed(kt >= 10_000 ? 0 : 1)} Mt`;
}

// ============================================================================
// TILTED AXONOMETRIC VIEW
// ============================================================================
// A 2.5D perspective on the blast: tilted ground plate at the bottom,
// vertical sky band at the top, mushroom cloud and fireball rising from
// the burst point vertically (no tilt) so the cloud reads naturally
// while the damage rings spread out as foreshortened ellipses on the
// ground plane.
//
// Projection model:
//   - Horizontal (X) is unchanged: world meters scale to screen pixels
//     at a single px/m factor.
//   - Depth (Y on ground) is foreshortened by TILT_RATIO (0.45 → ~60°
//     tilt from horizontal). A world-circle of radius R projects to an
//     ellipse with rx=R*scale, ry=R*scale*TILT_RATIO.
//   - Vertical (sky direction) is unchanged: the cloud rises at full
//     scale into the sky band above the horizon.

export const TILT_RATIO = 0.45;
export const TILT_W = 800;
export const TILT_H = 480;
// Horizon sits in the top quarter of the canvas — gives the impression
// that we're looking down at a tilted ground plane from low altitude.
export const TILT_HORIZON_Y = 120;        // sky/ground boundary at 25% from top

export function TiltedView({
  env,
  hobM,
  fireballM,
  time: rawTime,
  shockwavePeakM,
  damageRings,
  hoveredRingKey,
  units,
  mapEnabled,
  phenomenaOnly,
}: {
  env: DetonationEnv;
  hobM: number;
  fireballM: number;
  time: number;
  shockwavePeakM: number;
  damageRings?: Array<{ key: string; label: string; radiusM: number; color: string }>;
  hoveredRingKey?: string | null;
  units?: UnitSystem;
  /** When true, skips the ground-plate fill so a Leaflet map layered
   *  behind the SVG shows through. The vignette + grid still render. */
  mapEnabled?: boolean;
  /** When true, renders ONLY the animated phenomena (bomber, flash, fireball,
   *  shockwave, mushroom cloud) — no static ground plane (grid, vignette,
   *  damage-ring ellipses, ring flags, burst-point, corner legends). Used when
   *  a real map draws the rings as geographic geometry underneath. `damageRings`
   *  is still consulted for scale/cloud sizing. */
  phenomenaOnly?: boolean;
}) {
  const u: UnitSystem = units ?? "metric";
  const W = TILT_W;
  const H = TILT_H;
  const horizonY = TILT_HORIZON_Y;
  const groundH = H - horizonY;

  // Bomb-effect time — shifted so the detonation starts at rawTime =
  // PRE_FLIGHT_DURATION (after the plane has crossed the screen).
  // All cloud/fireball/shockwave/flag timing uses this shifted `time`.
  // Pre-flight phase (rawTime < PRE_FLIGHT) has time clamped to 0 so
  // nothing bomb-related renders yet.
  const time = Math.max(0, rawTime - PRE_FLIGHT_DURATION);
  // Bomb effects only render during/after the detonation. During the
  // pre-flight phase (plane crossing the screen), cloud / fireball /
  // sky reaction / flash / flags all stay invisible.
  const bombActive = rawTime >= PRE_FLIGHT_DURATION;

  // Burst sits in the middle of the ground plate, slightly back (toward
  // horizon) so rings fan forward toward viewer with room above for the
  // mushroom cloud.
  const burstX = W / 2;
  const burstY = horizonY + groundH * 0.45;

  // Compute scale (px/m) from outermost ring. Constrain by whichever fits
  // more tightly: horizontal width or vertical (foreshortened) extent.
  const outerR = damageRings && damageRings.length > 0
    ? Math.max(...damageRings.map((r) => r.radiusM), 1)
    : Math.max(fireballM * 4, 1);
  const padding = 40;
  const maxRx = (W - padding * 2) / 2;            // half-width minus padding
  const maxRy = Math.min(burstY - horizonY - 8,    // room toward horizon
                         H - burstY - 16);         // room toward foreground
  const scaleByWidth = maxRx / outerR;
  const scaleByDepth = maxRy / (outerR * TILT_RATIO);
  const scale = Math.min(scaleByWidth, scaleByDepth);

  // Sky background — same gradient as side view + sky-glow reaction overlay
  // during peak fireball, so the entire scene lights up.
  const skyLum = fireballLuminosity(time);

  return (
    <g>
      {/* All defs — sky/ground/cloud/fireball gradients + filters. Includes
          the legacy SideView defs (sky-grad, fireball-core, cloud-turb, etc.)
          so MushroomCloud and the fireball layer render correctly. */}
      <defs>
        <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2942" />
          <stop offset="100%" stopColor="#0f1a2a" />
        </linearGradient>
        <linearGradient id="tilt-ground-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#1a1612" stopOpacity="0.92" />
          <stop offset="35%" stopColor="#2a2520" stopOpacity="1" />
          <stop offset="100%" stopColor="#3d352e" stopOpacity="1" />
        </linearGradient>
        <radialGradient id="tilt-burst-vignette" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#000000" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#000000" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        {/* Cloud puff gradients */}
        <radialGradient id="puff-light" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#ece6d8" stopOpacity="1" />
          <stop offset="55%" stopColor="#beb6a6" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#9a9285" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-mid" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#8e887d" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#5d574f" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#3a352f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-dark" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#3a3833" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#1f1d1a" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0c0b0a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-charcoal" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#211e1a" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#100e0b" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#100e0b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-dustbrown" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#7a5c40" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#3e2d1d" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#3e2d1d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-ice" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#f4f0e6" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#d4cebf" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#a8a194" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-hot" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#ffe9b3" stopOpacity="1" />
          <stop offset="45%" stopColor="#e8893a" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#7a3010" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="puff-warmglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#ff7833" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#c34a14" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#5a1a08" stopOpacity="0" />
        </radialGradient>
        {/* Wilson cloud + sky reaction gradients */}
        <radialGradient id="wilson-cloud" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#eef4f8" stopOpacity="0" />
          <stop offset="42%" stopColor="#eef4f8" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#dde7ee" stopOpacity="0.6" />
          <stop offset="72%" stopColor="#eef4f8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#eef4f8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sky-glow" cx="50%" cy="100%" r="120%">
          <stop offset="0%"  stopColor="#ffaa3d" stopOpacity="0.55" />
          <stop offset="35%" stopColor="#c44a1a" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#0f1a2a" stopOpacity="0" />
        </radialGradient>
        {/* Fireball gradients */}
        <radialGradient id="fireball-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="25%" stopColor="#ffe9b3" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#e8893a" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#7a3010" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="fireball-corona" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffaa3d" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#e8893a" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#7a3010" stopOpacity="0" />
        </radialGradient>
        {/* Filters */}
        <filter id="cloud-turb" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="18" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
        <filter id="cloud-turb-coarse" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="11" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="28" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="0.4" />
        </filter>
        <filter id="cloud-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.0" />
        </filter>
        <filter id="wilson-filter" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="13" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
        <filter id="hot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* SKY + GROUND backgrounds + horizon — only when the map is NOT
          enabled. Sky covers the top quarter (above horizonY), ground
          fills the rest. The burst point sits well below the horizon,
          deep in the ground plate, which gives the cloud lots of sky
          room to rise into. */}
      {!mapEnabled && (
        <>
          <rect x={0} y={0} width={W} height={horizonY} fill="url(#sky-grad)" />
          <rect x={0} y={horizonY} width={W} height={H - horizonY} fill="url(#tilt-ground-grad)" />
          {/* Horizon line — at the sky/ground boundary near the top */}
          <line
            x1={0}
            x2={W}
            y1={horizonY}
            y2={horizonY}
            stroke="#a3aebd"
            strokeOpacity={0.4}
            strokeWidth={0.8}
          />
        </>
      )}

      {/* GRID — concentric depth lines at scaled distances showing the
          tilted plane. Drawn at 5 depth intervals from horizon to viewer
          so the surface reads as a foreshortened plane. */}
      {!phenomenaOnly && (() => {
        const lines: React.ReactElement[] = [];
        // 6 horizontal lines + 9 vertical lines establishing the tilted plane
        for (let i = 1; i <= 6; i++) {
          const depthFrac = i / 7;
          const lineY = horizonY + (H - horizonY) * depthFrac;
          lines.push(
            <line
              key={`grid-h-${i}`}
              x1={0}
              x2={W}
              y1={lineY}
              y2={lineY}
              stroke="#a3aebd"
              strokeOpacity={0.06}
              strokeWidth={0.5}
            />,
          );
        }
        // Vertical lines fanning slightly toward horizon for axonometric feel
        for (let i = 0; i <= 8; i++) {
          const x = (W / 8) * i;
          // Slight perspective: vertical lines lean toward horizon center
          const topX = W / 2 + (x - W / 2) * 0.85; // 15% inward at horizon
          lines.push(
            <line
              key={`grid-v-${i}`}
              x1={topX}
              y1={horizonY}
              x2={x}
              y2={H}
              stroke="#a3aebd"
              strokeOpacity={0.06}
              strokeWidth={0.5}
            />,
          );
        }
        return <g pointerEvents="none">{lines}</g>;
      })()}

      {/* BURST-POINT VIGNETTE — radial dark gradient centered at burst */}
      {!phenomenaOnly && (
        <ellipse
          cx={burstX}
          cy={burstY}
          rx={Math.min(W * 0.45, outerR * scale * 1.2)}
          ry={Math.min(W * 0.45, outerR * scale * 1.2) * TILT_RATIO}
          fill="url(#tilt-burst-vignette)"
        />
      )}

      {/* DAMAGE RINGS — foreshortened ellipses on the ground plane.
          Outer rings drawn first so inner draw on top. */}
      {!phenomenaOnly && damageRings && damageRings.length > 0 && (
        <g pointerEvents="none">
          {[...damageRings]
            .sort((a, b) => b.radiusM - a.radiusM)
            .map((r) => {
              const rx = r.radiusM * scale;
              const ry = rx * TILT_RATIO;
              if (rx < 3) return null;
              const isHovered = hoveredRingKey === r.key;
              // Map mode needs heavier strokes so rings stand out over
              // busy map tiles. An additional dark "halo" stroke renders
              // first to give the colored ring contrast against light tiles.
              const baseWidth = isHovered ? 2.4 : 1.2;
              const mapWidth = isHovered ? 3.2 : 2;
              const strokeW = mapEnabled ? mapWidth : baseWidth;
              const baseOpacity = isHovered ? 1 : 0.65;
              const mapOpacity = isHovered ? 1 : 0.95;
              const strokeOpacity = mapEnabled ? mapOpacity : baseOpacity;
              return (
                <ellipse
                  key={r.key}
                  cx={burstX}
                  cy={burstY}
                  rx={rx}
                  ry={ry}
                  fill="none"
                  stroke={r.color}
                  strokeOpacity={strokeOpacity}
                  strokeWidth={strokeW}
                  strokeDasharray={isHovered ? "0" : "5 4"}
                />
              );
            })}
        </g>
      )}

      {/* BURST POINT INDICATOR — a small bright cross on the ground at
          the burst location. Visible at all times so the user can locate
          the burst when the cloud or fireball obscures it. */}
      {!phenomenaOnly && (
        <g pointerEvents="none">
          <circle cx={burstX} cy={burstY} r={2} fill="#ffffff" opacity={0.85} />
          <circle cx={burstX} cy={burstY} r={5} fill="none" stroke="#ffffff" strokeOpacity={0.3} strokeWidth={0.5} />
        </g>
      )}

      {/* Altitude axis removed — the B-52 below now serves as the
          altitude reference, with its trailing label showing the current
          cruise altitude in the active unit system. */}


      {/* B-52 STRATOFORTRESS — the plane is now the altitude marker.
          It enters from the left during a 1.5s pre-detonation lead-in,
          passes directly over the burst point at t=0 (bomb release),
          and continues flying right (escaping the blast) through the
          animation. The trailing label shows the cruise altitude in
          the active unit system.

          B-52 silhouette: long thin fuselage (48m), swept wings (56m
          span, 35° sweep), 4 engine pods (2 per wing, each holding
          a pair of engines), tall vertical tail. */}
      {(() => {
        const cruiseAltM = 10_500; // 10.5 km — B-52 cruise altitude
        const idealPlaneY = burstY - cruiseAltM * scale;
        const minPlaneY = 14;
        const planeY = Math.max(minPlaneY, idealPlaneY);
        const altitudeClamped = idealPlaneY < minPlaneY;

        // Plane timing: B-52 flies LEFT → RIGHT during the pre-flight
        // phase (rawTime 0 → PRE_FLIGHT_DURATION). At rawTime = PRE_FLIGHT
        // it reaches the right side, dropping the bomb just as the
        // detonation timeline (time=0) begins.
        // After PRE_FLIGHT, the plane is off-canvas — it has escaped.
        const planeStartX = -50;
        const planeEndX = W + 50;
        const planeFlightFrac = Math.min(1, rawTime / PRE_FLIGHT_DURATION);
        const planeX = planeStartX + planeFlightFrac * (planeEndX - planeStartX);
        // Hide once plane has exited frame (after PRE_FLIGHT plus tiny grace)
        if (planeX > W + 40) return null;

        // B-52 dimensions: fuselage 48m long, wingspan 56m
        // We scale by actual world scale (px/m) but enforce minimum
        // pixel sizes so the plane is always at least faintly readable.
        const bodyL = Math.max(34, 48 * scale);
        const bodyW = Math.max(3, bodyL * 0.06);
        const wingSpan = Math.max(40, 56 * scale);
        const wingHalf = wingSpan / 2;
        const podL = bodyL * 0.14;
        const podW = bodyL * 0.035;

        const fill = "#e6ecf2";
        const dark = "#7a8595";
        const cockpit = "#5a6373";

        // Coord shorthand: bx = position along flight axis (right = forward),
        // wy = lateral position on a wing as a fraction of wingHalf.
        const bx = (frac: number) => planeX + bodyL * frac;
        const by = (frac: number) => planeY + bodyW * frac;
        const wy = (sideFrac: number) => planeY + wingHalf * sideFrac;

        return (
          <g pointerEvents="none" opacity={0.92}>
            {/* FALLING BOMB — appears after the plane crosses the burst
                column (drops the bomb) and animates the bomb falling
                from cruise altitude down to the burst point. Reaches
                ground exactly at rawTime = PRE_FLIGHT_DURATION (when
                detonation begins). Accelerates via easeInQuad to suggest
                gravity-driven fall. */}
            {(() => {
              // Drop time = when plane crosses burstX
              const tDrop = PRE_FLIGHT_DURATION * (burstX - planeStartX) / (planeEndX - planeStartX);
              if (rawTime < tDrop) return null; // bomb not yet released
              if (rawTime > PRE_FLIGHT_DURATION + 0.1) return null; // bomb has detonated
              const fallProgress = Math.min(1, (rawTime - tDrop) / (PRE_FLIGHT_DURATION - tDrop));
              const fallEase = fallProgress * fallProgress; // easeInQuad — accelerates
              const bombY = planeY + (burstY - planeY) * fallEase;
              return (
                <g>
                  {/* Falling trail — dashed line from drop point to bomb */}
                  <line
                    x1={burstX}
                    y1={planeY + bodyW / 2}
                    x2={burstX}
                    y2={bombY}
                    stroke="rgba(255,255,255,0.5)"
                    strokeWidth={0.8}
                    strokeDasharray="2 3"
                  />
                  {/* Falling bomb — small dark ellipse */}
                  <ellipse
                    cx={burstX}
                    cy={bombY}
                    rx={2}
                    ry={3.5}
                    fill="#cfd8e0"
                    stroke="#0a0d12"
                    strokeWidth={0.4}
                  />
                </g>
              );
            })()}

            {/* MAIN WINGS — large swept-back trapezoids with the B-52's
                characteristic ~35° sweep. Drawn first so engine pods +
                fuselage layer on top. */}
            <polygon
              points={[
                `${bx(0.10)},${by(0)}`,
                `${bx(-0.32)},${wy(0.95)}`,
                `${bx(-0.40)},${wy(0.95)}`,
                `${bx(-0.18)},${by(0)}`,
              ].join(" ")}
              fill={fill}
            />
            <polygon
              points={[
                `${bx(0.10)},${by(0)}`,
                `${bx(-0.32)},${wy(-0.95)}`,
                `${bx(-0.40)},${wy(-0.95)}`,
                `${bx(-0.18)},${by(0)}`,
              ].join(" ")}
              fill={fill}
            />

            {/* ENGINE PODS — 4 pods (2 per wing). Each pod holds 2 engines.
                Positioned along the wing with the B-52's iconic "pods slung
                forward of the wing" look. Each pod has a shadow + body + highlight. */}
            {[-1, 1].flatMap((side) =>
              [0.32, 0.62].map((distFrac) => {
                const podCx = bx(0.10) + (bx(-0.32) - bx(0.10)) * distFrac;
                const podCy = wy(side * 0.95 * distFrac);
                return (
                  <g key={`${side}-${distFrac}`}>
                    <ellipse
                      cx={podCx + 0.3}
                      cy={podCy + 0.5}
                      rx={podL / 2}
                      ry={podW / 2}
                      fill="rgba(0,0,0,0.35)"
                    />
                    <ellipse
                      cx={podCx}
                      cy={podCy}
                      rx={podL / 2}
                      ry={podW / 2}
                      fill={dark}
                    />
                    <ellipse
                      cx={podCx - podL * 0.12}
                      cy={podCy - podW * 0.15}
                      rx={podL * 0.28}
                      ry={podW * 0.22}
                      fill={fill}
                      opacity={0.6}
                    />
                  </g>
                );
              }),
            )}

            {/* FUSELAGE — long slender cigar with rounded nose and
                tapered tail. Uses a path rather than a plain ellipse to
                capture the bomber's profile. */}
            <path
              d={[
                `M ${bx(0.50)} ${by(0)}`,
                `Q ${bx(0.45)} ${by(-0.55)}, ${bx(0.20)} ${by(-0.6)}`,
                `L ${bx(-0.42)} ${by(-0.45)}`,
                `Q ${bx(-0.50)} ${by(-0.2)}, ${bx(-0.50)} ${by(0)}`,
                `Q ${bx(-0.50)} ${by(0.2)}, ${bx(-0.42)} ${by(0.45)}`,
                `L ${bx(0.20)} ${by(0.6)}`,
                `Q ${bx(0.45)} ${by(0.55)}, ${bx(0.50)} ${by(0)}`,
                `Z`,
              ].join(" ")}
              fill={fill}
            />

            {/* COCKPIT — small darker bubble near the nose */}
            <ellipse
              cx={bx(0.36)}
              cy={by(0)}
              rx={bodyL * 0.04}
              ry={bodyW * 0.4}
              fill={cockpit}
              opacity={0.75}
            />

            {/* HORIZONTAL STABILIZERS — smaller swept wings at the tail */}
            <polygon
              points={[
                `${bx(-0.36)},${by(0)}`,
                `${bx(-0.45)},${wy(0.28)}`,
                `${bx(-0.50)},${wy(0.28)}`,
                `${bx(-0.42)},${by(0)}`,
              ].join(" ")}
              fill={fill}
            />
            <polygon
              points={[
                `${bx(-0.36)},${by(0)}`,
                `${bx(-0.45)},${wy(-0.28)}`,
                `${bx(-0.50)},${wy(-0.28)}`,
                `${bx(-0.42)},${by(0)}`,
              ].join(" ")}
              fill={fill}
            />

            {/* VERTICAL TAIL — from top-down it shows as a small dark
                triangular spine along the centerline at the rear. */}
            <polygon
              points={[
                `${bx(-0.38)},${by(0)}`,
                `${bx(-0.49)},${by(-0.4)}`,
                `${bx(-0.49)},${by(0.4)}`,
              ].join(" ")}
              fill={dark}
            />

            {/* TRAILING LABEL — bigger text, uniform padding all around. */}
            {planeX > 130 && planeX < W + 20 && (() => {
              const labelText = `B-52 · ${altitudeClamped ? `↑ ${fmtMeter(cruiseAltM, u)}` : fmtMeter(cruiseAltM, u)}`;
              const fontSize = 8;
              const padX = 6;     // uniform horizontal padding
              const padY = 5;     // uniform vertical padding
              const textW = labelText.length * fontSize * 0.6; // monospace
              const pillW = textW + padX * 2;
              const pillH = fontSize + padY * 2;
              const pillRight = planeX - bodyL * 0.5 - 6;
              const pillX = pillRight - pillW;
              const pillY = planeY - pillH / 2;
              return (
                <g>
                  <line
                    x1={pillRight}
                    y1={planeY}
                    x2={planeX - bodyL * 0.5}
                    y2={planeY}
                    stroke="rgba(207,216,224,0.55)"
                    strokeWidth={0.6}
                    strokeDasharray="1.5 1.5"
                  />
                  <rect
                    x={pillX}
                    y={pillY}
                    width={pillW}
                    height={pillH}
                    rx={3}
                    fill="rgba(10,13,18,0.92)"
                    stroke="rgba(207,216,224,0.6)"
                    strokeWidth={0.6}
                  />
                  <text
                    x={pillX + pillW / 2}
                    y={pillY + pillH / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#e6ecf2"
                    fontSize={fontSize}
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight={700}
                  >
                    {labelText}
                  </text>
                </g>
              );
            })()}
          </g>
        );
      })()}

      {/* SKY REACTION — orange wash during peak luminosity (mirrors side view).
          Skipped in phenomenaOnly mode: a bounded rect would reveal the scene's
          rectangular edges over a map; BlastMap3D draws a full-bleed flash
          instead. */}
      {!phenomenaOnly && bombActive && skyLum > 0.02 && fireballM > 0 && (
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="url(#sky-glow)"
          opacity={skyLum * 0.75}
          style={{ mixBlendMode: "screen" }}
          pointerEvents="none"
        />
      )}

      {/* MUSHROOM CLOUD — reused unchanged, anchored to burst point so it
          rises straight up into the sky band. The same particle system,
          colors, and timing as the side view. */}
      {bombActive && time > 0.3 && fireballM > 0 &&
        env !== "underground" && env !== "underwater" && env !== "rocket" && (
          <MushroomCloud
            cx={burstX}
            groundY={burstY}
            time={time}
            fireballM={fireballM}
            scale={scale}
            maxHeightPx={burstY - 8}
          />
      )}

      {/* FIREBALL — same multi-layer render as side view, anchored to
          (burstX, burstY-hobOffset). Only renders post-detonation. */}
      {bombActive && fireballM > 0 && (() => {
        const fireballPxR = Math.max(4, fireballM * scale);
        const expandT = easeOutCubic(progress(time, 0, T_FIREBALL_PEAK));
        const animatedR = fireballPxR * expandT;
        const temp = fireballTemperature(time);
        const color = blackbodyColor(temp);
        const luminosity = fireballLuminosity(time);
        const fadeOpacity = 1 - easeOutQuad(progress(time, T_FIREBALL_FADE_START, T_FIREBALL_FADE_END));
        // Compute fireball center y, accounting for HOB and clamping
        let cy = burstY;
        if (env === "atmospheric" || env === "rocket") {
          const hobPx = Math.min(burstY - horizonY - fireballPxR - 4, hobM * scale);
          cy = burstY - Math.max(fireballPxR, hobPx);
        }
        return (
          <g pointerEvents="none">
            <circle
              cx={burstX}
              cy={cy}
              r={animatedR * (2.2 + luminosity * 1.6)}
              fill="url(#fireball-corona)"
              opacity={luminosity * 0.85}
              filter="url(#hot-glow)"
            />
            <circle
              cx={burstX}
              cy={cy}
              r={animatedR}
              fill="url(#fireball-core)"
              opacity={Math.max(luminosity, fadeOpacity * 0.7)}
            />
            <circle
              cx={burstX}
              cy={cy}
              r={animatedR * 0.92}
              fill={color}
              opacity={fadeOpacity * 0.55}
            />
            {luminosity > 0.3 && (
              <circle
                cx={burstX}
                cy={cy}
                r={animatedR * 0.45}
                fill="#ffffff"
                opacity={Math.min(1, luminosity * 1.3)}
              />
            )}
            {/* HOB indicator line down to ground (foreshortened-projected
                onto the burst point on the tilted plane) */}
            {(env === "atmospheric" || env === "rocket") && hobM > 0 && cy < burstY - fireballPxR && (
              <line
                x1={burstX}
                x2={burstX}
                y1={cy + animatedR}
                y2={burstY}
                stroke="#e8893a"
                strokeOpacity={0.4}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            )}
          </g>
        );
      })()}

      {/* DETONATION FLASH — same Teller-Ulam double flash as side view.
          Skipped in phenomenaOnly mode: a bounded white rect would reveal the
          scene's rectangular edges over a map; BlastMap3D draws a full-bleed
          white flash (same detonationFlashOpacity curve) instead. */}
      {!phenomenaOnly && bombActive && time < T_FLASH_END && fireballM > 0 && (
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="#ffffff"
          opacity={detonationFlashOpacity(time)}
          pointerEvents="none"
        />
      )}

      {/* DAMAGE FLAGS — pop up from the front edge (6 o'clock position)
          of each ring as the shockwave reaches that radius. Front-edge
          placement puts flags closest to viewer with no obstruction. */}
      {!phenomenaOnly && damageRings && damageRings.length > 0 && shockwavePeakM > 0 && (() => {
        const rings = [...damageRings].sort((a, b) => a.radiusM - b.radiusM);
        const popTime = (radiusM: number): number => {
          const frac = Math.min(1, radiusM / shockwavePeakM);
          const x = 1 - Math.pow(1 - frac, 1 / 3);
          return T_SHOCKWAVE_START + x * (T_SHOCKWAVE_END - T_SHOCKWAVE_START);
        };
        // Distribute flags around the ring at different angles based on
        // ring index so they don't all stack at the same x. Angle 0 = right,
        // PI/2 = front (closest to viewer), PI = left, 3*PI/2 = back.
        // We use a fan of angles between PI/4 and 3*PI/4 (front semicircle).
        return (
          <g pointerEvents="none">
            {rings.map((r, idx) => {
              const rx = r.radiusM * scale;
              const ry = rx * TILT_RATIO;
              if (rx < 6) return null;

              const tArrival = popTime(r.radiusM);
              const sinceArrival = time - tArrival;
              if (sinceArrival < 0) return null;
              const popScale = easeOutBack(Math.min(1, sinceArrival / 0.25));
              if (popScale < 0.02) return null;

              const isHovered = hoveredRingKey === r.key;
              const labelText = `${r.label} · ${fmtMeter(r.radiusM, u)}`;
              const flagW = labelText.length * 4 + 10;
              const flagH = 14;

              // Fan flags across front semicircle: angle 50° to 130° from
              // right (i.e. front-right to front-left of ring). Inner rings
              // get sharper angles, outer rings flatter.
              const totalRings = rings.length;
              const angleStart = (50 * Math.PI) / 180;
              const angleEnd = (130 * Math.PI) / 180;
              const angle = angleStart + (idx / Math.max(1, totalRings - 1)) * (angleEnd - angleStart);
              const flagX = burstX + rx * Math.cos(angle);
              const flagGroundY = burstY + ry * Math.sin(angle);

              // Pole height: stagger by inverse ring index so outer rings
              // get taller poles (further from viewer in foreshortened sense)
              const fullPoleHeight = 32 + (totalRings - idx) * 4;
              const poleHeight = fullPoleHeight * popScale;
              const flagY = flagGroundY - poleHeight;

              // Don't draw if flag would be off-canvas
              if (flagX < flagW / 2 || flagX > W - flagW / 2) return null;

              return (
                <g key={r.key}>
                  {/* Ground tick — small mark on the ring where the flag plants */}
                  <circle
                    cx={flagX}
                    cy={flagGroundY}
                    r={isHovered ? 3 : 2}
                    fill={r.color}
                    opacity={isHovered ? 1 : 0.85}
                  />
                  {/* Pole growing up from the tick */}
                  <line
                    x1={flagX}
                    x2={flagX}
                    y1={flagGroundY}
                    y2={flagY + flagH / 2}
                    stroke={r.color}
                    strokeOpacity={isHovered ? 1 : 0.85}
                    strokeWidth={isHovered ? 1.8 : 1.2}
                  />
                  {/* Flag pill */}
                  <rect
                    x={flagX - (flagW * popScale) / 2}
                    y={flagY - flagH / 2}
                    width={flagW * popScale}
                    height={flagH}
                    rx={2.5}
                    fill="#0a0d12"
                    fillOpacity={isHovered ? 0.97 : 0.92}
                    stroke={r.color}
                    strokeOpacity={isHovered ? 1 : 0.9}
                    strokeWidth={isHovered ? 1.4 : 1}
                  />
                  {popScale > 0.6 && (
                    <text
                      x={flagX}
                      y={flagY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={r.color}
                      fontSize={7}
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight={700}
                      opacity={Math.min(1, (popScale - 0.6) / 0.4)}
                    >
                      {labelText}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })()}

      {/* Top-right pixel-scale legend */}
      {!phenomenaOnly && (
        <text
          x={W - 12}
          y={14}
          textAnchor="end"
          fill="rgba(255,255,255,0.45)"
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
        >
          1 px ≈ {fmtMeter(1 / scale, u)}
        </text>
      )}

      {/* Bottom-left orientation label */}
      {!phenomenaOnly && (
        <text
          x={12}
          y={H - 10}
          fill="rgba(255,255,255,0.35)"
          fontSize={8}
          fontFamily="JetBrains Mono, monospace"
          fontStyle="italic"
        >
          Tilted view · rings foreshortened to scale
        </text>
      )}
    </g>
  );
}

function compareLabel(comp: { label: string; ratio: number }): string {
  const r = comp.ratio;
  if (r >= 0.7 && r <= 1.4) return `≈ ${comp.label}`;
  if (r > 1.4) return `${r >= 100 ? Math.round(r) : r.toFixed(r >= 10 ? 0 : 1)}× ${comp.label}`;
  return `${(1 / r).toFixed(1)}× smaller than ${comp.label}`;
}
