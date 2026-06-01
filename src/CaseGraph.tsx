// Network graph for the correlation viewer: collected cases (numbered, colored
// by dataset) linked to the people/places they share. A small deterministic
// force layout runs once in a memo — no animation loop, so it's stable and
// renders identically every time. This is the "network" view of the same
// shared-entity data shown in the SHARED CONNECTIONS list.

import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { Case } from "./types";
import type { Entity } from "./entities";

type Pt = { i: number; c: Case };
type Shared = { entity: Entity; idxs: number[] };

const W = 300;
const H = 340;

type Node = { id: string; kind: "case" | "person" | "place"; label: string; color: string; ci?: number; eid?: string; x: number; y: number; vx: number; vy: number };

function layout(nodes: Node[], edges: [number, number][]): void {
  const n = nodes.length;
  if (!n) return;
  // Deterministic ring init (no RNG, so the picture is reproducible).
  nodes.forEach((nd, i) => {
    const a = (i / n) * Math.PI * 2;
    nd.x = W / 2 + Math.cos(a) * W * 0.32;
    nd.y = H / 2 + Math.sin(a) * H * 0.32;
    nd.vx = 0;
    nd.vy = 0;
  });
  const k = Math.sqrt((W * H) / n);
  const ITERS = 300;
  for (let it = 0; it < ITERS; it++) {
    const cool = 1 - it / ITERS;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const rep = ((k * k) / d) * 0.045;
        dx /= d; dy /= d;
        a.vx += dx * rep; a.vy += dy * rep;
        b.vx -= dx * rep; b.vy -= dy * rep;
      }
    for (const [s, t] of edges) {
      const a = nodes[s], b = nodes[t];
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const att = ((d * d) / k) * 0.012;
      dx /= d; dy /= d;
      a.vx += dx * att; a.vy += dy * att;
      b.vx -= dx * att; b.vy -= dy * att;
    }
    for (const nd of nodes) {
      nd.vx += (W / 2 - nd.x) * 0.003;
      nd.vy += (H / 2 - nd.y) * 0.003;
      nd.x += Math.max(-10, Math.min(10, nd.vx)) * cool;
      nd.y += Math.max(-10, Math.min(10, nd.vy)) * cool;
      nd.vx *= 0.86; nd.vy *= 0.86;
      nd.x = Math.max(18, Math.min(W - 18, nd.x));
      // Entity nodes carry a label above them — keep extra top margin so it
      // never clips the frame.
      const topPad = nd.kind === "case" ? 16 : 26;
      nd.y = Math.max(topPad, Math.min(H - 16, nd.y));
    }
  }
}

export function CaseGraph({
  pts,
  shared,
  onOpen,
  onEntity,
  caseColor,
}: {
  pts: Pt[];
  shared: Shared[];
  onOpen: (c: Case) => void;
  onEntity?: (id: string) => void;
  caseColor: (c: Case) => string;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const idxToNode = new Map<number, number>();
    for (const p of pts) {
      idxToNode.set(p.i, nodes.length);
      nodes.push({ id: `c${p.i}`, kind: "case", label: String(p.i), color: caseColor(p.c), ci: p.i, x: 0, y: 0, vx: 0, vy: 0 });
    }
    const edges: [number, number][] = [];
    for (const s of shared) {
      const eNode = nodes.length;
      nodes.push({ id: s.entity.id, kind: s.entity.type, label: s.entity.name, color: s.entity.type === "place" ? "#7aa7d6" : "#9aa5b1", eid: s.entity.id, x: 0, y: 0, vx: 0, vy: 0 });
      for (const idx of s.idxs) {
        const cn = idxToNode.get(idx);
        if (cn != null) edges.push([cn, eNode]);
      }
    }
    layout(nodes, edges);
    return { nodes, edges };
  }, [pts, shared, caseColor]);

  if (shared.length === 0) {
    return (
      <Box sx={{ height: "100%", display: "grid", placeItems: "center", p: 2 }}>
        <Typography variant="caption" color="text.disabled" sx={{ textAlign: "center" }}>
          No shared people or places to graph yet — collect cases that overlap.
        </Typography>
      </Box>
    );
  }

  const byIdx = new Map(pts.map((p) => [p.i, p.c]));

  return (
    <Box sx={{ height: "100%", minHeight: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block" }}>
        {edges.map(([s, t], i) => (
          <line key={i} x1={nodes[s].x} y1={nodes[s].y} x2={nodes[t].x} y2={nodes[t].y} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
        ))}
        {/* Entity nodes first, then case nodes on top, so numbered case dots
            never hide behind an entity's label backing. */}
        {[...nodes].sort((a, b) => (a.kind === "case" ? 1 : 0) - (b.kind === "case" ? 1 : 0)).map((nd) =>
          nd.kind === "case" ? (
            <g key={nd.id} style={{ cursor: "pointer" }} onClick={() => nd.ci != null && byIdx.get(nd.ci) && onOpen(byIdx.get(nd.ci)!)}>
              <circle cx={nd.x} cy={nd.y} r={11} fill={nd.color} stroke="#0a0d12" strokeWidth={1.5} />
              <text x={nd.x} y={nd.y} textAnchor="middle" dominantBaseline="central" fill="#0a0d12" fontSize={10} fontWeight={800} fontFamily="JetBrains Mono, monospace" pointerEvents="none">
                {nd.label}
              </text>
            </g>
          ) : (
            <g key={nd.id} style={{ cursor: onEntity ? "pointer" : "default" }} onClick={() => onEntity && nd.eid && onEntity(nd.eid)}>
              <circle cx={nd.x} cy={nd.y} r={6} fill={nd.color} fillOpacity={0.5} stroke={nd.color} strokeWidth={1.5} />
              {(() => {
                // Anchor labels so they never clip the viewBox edges: beside
                // the node near the left/right margins, above it otherwise. A
                // dark backing rect keeps the label readable over edges and
                // when entity labels crowd together.
                const left = nd.x < W * 0.28, right = nd.x > W * 0.72;
                const anchor = left ? "start" : right ? "end" : "middle";
                const lx = left ? nd.x + 9 : right ? nd.x - 9 : nd.x;
                const ly = left || right ? nd.y + 3 : nd.y - 10;
                const text = nd.label.length > 16 ? nd.label.slice(0, 16) + "…" : nd.label;
                const w = text.length * 5.2 + 6;
                const rx = anchor === "start" ? lx - 3 : anchor === "end" ? lx - w + 3 : lx - w / 2;
                return (
                  <>
                    <rect x={rx} y={ly - 8} width={w} height={11} rx={2} fill="#0d1117" fillOpacity={0.78} />
                    <text x={lx} y={ly} textAnchor={anchor} fill={nd.color} fontSize={9} fontWeight={600} pointerEvents="none">
                      {text}
                    </text>
                  </>
                );
              })()}
            </g>
          ),
        )}
      </svg>
    </Box>
  );
}
