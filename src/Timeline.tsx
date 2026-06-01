import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { CaseRow } from "./CaseList";
import { AddToCasesButton } from "./AddToCasesButton";
import { scaleTime } from "d3-scale";
import { extent } from "d3-array";
import type { Case } from "./types";
import { AGENCY_COLORS, AGENCY_SHORT } from "./theme";
import type { Dataset, DatasetId } from "./datasets";

export type AgencyGroup = {
  datasetId: DatasetId;
  datasetMeta: Dataset;
  agencies: { name: string; count: number }[];
};

type Props = {
  cases: Case[];
  groups: AgencyGroup[];
  onSelect: (c: Case) => void;
  /** Currently selected case (from anywhere in the app). The matching dot
   * pulses to make it easy to locate in time. */
  selectedCase?: Case | null;
  xDomain: [Date, Date] | null;
  onXDomainChange: (d: [Date, Date] | null) => void;
};

// A single visual row in the timeline. Either a thin dataset header strip
// or a regular agency lane that holds dots.
type Lane =
  | { kind: "header"; key: string; datasetMeta: Dataset; totalCount: number }
  | {
      kind: "agency";
      key: string;
      agency: string;
      datasetId: DatasetId;
      datasetMeta: Dataset;
      count: number;
    };

const HEADER_LANE_HEIGHT = 26;

const MIN_BRUSH_PX = 8;
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "short" });

const MARGIN = { top: 40, right: 40, bottom: 16, left: 130 };
const BRUSH_BAND_HEIGHT = 26;
// The year axis + brush band live in a sticky header SVG of this height: year
// labels sit at MARGIN.top-14 and the brush band spans MARGIN.top..+BAND.
const AXIS_H = MARGIN.top + BRUSH_BAND_HEIGHT;
// The scrolling lane body starts a hair below its own top edge (the axis is no
// longer part of the scroll content).
const BODY_TOP_PAD = 10;
const MIN_LANE_HEIGHT = 56;
const DOT_RADIUS = 5;

// Cluster circle radius grows with member count (sub-linear, capped) — same
// idea as the map's count markers.
const clusterRadius = (n: number) => Math.min(15, 6 + Math.sqrt(n) * 1.9);

// Compact label for the date span covered by a set of cases.
function dateSpanLabel(cases: Case[]): string {
  const raws = cases.map((c) => c.incidentDateRaw).filter(Boolean);
  const first = raws[0];
  const last = raws[raws.length - 1];
  if (!first) return "";
  return first === last ? first : `${first} – ${last}`;
}

export function Timeline({ cases, groups, onSelect, selectedCase, xDomain, onXDomainChange }: Props) {
  // Flatten groups into an ordered list of lanes: per dataset, one thin header
  // followed by one lane per agency. Dot lookup uses the composite key
  // `${datasetId}::${agency}` so the same agency string can appear in multiple
  // datasets without collision.
  const lanes: Lane[] = useMemo(() => {
    const out: Lane[] = [];
    for (const g of groups) {
      if (g.agencies.length === 0) continue;
      const total = g.agencies.reduce((sum, a) => sum + a.count, 0);
      out.push({
        kind: "header",
        key: `${g.datasetId}::__header`,
        datasetMeta: g.datasetMeta,
        totalCount: total,
      });
      for (const a of g.agencies) {
        out.push({
          kind: "agency",
          key: `${g.datasetId}::${a.name}`,
          agency: a.name,
          datasetId: g.datasetId,
          datasetMeta: g.datasetMeta,
          count: a.count,
        });
      }
    }
    return out;
  }, [groups]);

  // Original agency-only lane count (excluding headers) for height math.
  const agencyLaneCount = lanes.filter((l) => l.kind === "agency").length;
  const headerLaneCount = lanes.filter((l) => l.kind === "header").length;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 600 });

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

  const { width } = size;
  // Fit lanes to viewport when possible; otherwise scroll vertically.
  // Headers consume a fixed thin band; agency lanes take whatever's left
  // (clamped to MIN_LANE_HEIGHT).
  const headerBudget = headerLaneCount * HEADER_LANE_HEIGHT;
  const availableForAgencyLanes = Math.max(
    MIN_LANE_HEIGHT * Math.max(1, agencyLaneCount),
    size.height - BODY_TOP_PAD - MARGIN.bottom - headerBudget,
  );
  const laneHeight = Math.max(
    MIN_LANE_HEIGHT,
    agencyLaneCount > 0 ? availableForAgencyLanes / agencyLaneCount : MIN_LANE_HEIGHT,
  );
  const height =
    BODY_TOP_PAD +
    MARGIN.bottom +
    headerBudget +
    agencyLaneCount * laneHeight;

  // Show the full data extent when no brush is active, regardless of current filtered case list.
  // (Otherwise the visible extent would jump around every time filters change.)
  const fullDomain = useMemo<[Date, Date]>(() => {
    // Wide default that covers the PURSUE data (1945-2026)
    return [new Date("1945-01-01"), new Date("2026-12-31")];
  }, []);

  // Fall back to data extent if cases happen to exceed defaults.
  const dataDomain = useMemo<[Date, Date] | null>(() => {
    const dates = cases
      .map((c) => (c.incidentDate ? new Date(c.incidentDate) : null))
      .filter((d): d is Date => d !== null);
    const [min, max] = extent(dates);
    if (!min || !max) return null;
    const padMs = (max.getTime() - min.getTime()) * 0.02 || 30 * 86400 * 1000;
    return [new Date(min.getTime() - padMs), new Date(max.getTime() + padMs)];
  }, [cases]);

  const effectiveFull = dataDomain ?? fullDomain;

  const xScale = useMemo(() => {
    return scaleTime()
      .domain(xDomain ?? effectiveFull)
      .range([MARGIN.left, width - MARGIN.right]);
  }, [xDomain, effectiveFull, width]);

  // Custom y-positioning for the lane sequence — mixes thin header lanes and
  // taller agency lanes. Maps each lane's composite key to a {top, height}.
  const laneLayout = useMemo(() => {
    const out = new Map<string, { top: number; height: number; kind: Lane["kind"] }>();
    let y = BODY_TOP_PAD;
    for (const lane of lanes) {
      const h = lane.kind === "header" ? HEADER_LANE_HEIGHT : laneHeight;
      out.set(lane.key, { top: y, height: h, kind: lane.kind });
      y += h;
    }
    return out;
  }, [lanes, laneHeight]);

  // When the user selects a case (typically by clicking on the map), the dot
  // for that case might be in a lane that's currently scrolled out of view
  // — the US lane in particular sits way above visible when many agencies
  // are stacked. Auto-scroll the wrapper so the selected lane is visible.
  useEffect(() => {
    if (!selectedCase || !wrapRef.current) return;
    const laneKey = `${selectedCase.dataset}::${selectedCase.agency}`;
    const layout = laneLayout.get(laneKey);
    if (!layout) return;
    const wrap = wrapRef.current;
    const laneTop = layout.top;
    const laneBottom = layout.top + layout.height;
    const viewTop = wrap.scrollTop;
    const viewBottom = viewTop + wrap.clientHeight;
    // If lane is fully visible, don't disturb the user's scroll position.
    if (laneTop >= viewTop + 8 && laneBottom <= viewBottom - 8) return;
    // Otherwise center the lane in the viewport (with a small top margin so
    // the lane label stays clear of the brush band).
    const target = Math.max(0, laneTop - wrap.clientHeight / 2 + layout.height / 2);
    wrap.scrollTo({ top: target, behavior: "smooth" });
  }, [selectedCase?.id, laneLayout]);

  // Year tick generation: adapt to both date span AND available chart width.
  // Target ~80px between tick labels.
  const yearTicks = useMemo(() => {
    const [lo, hi] = xScale.domain();
    const yearLo = lo.getUTCFullYear();
    const yearHi = hi.getUTCFullYear();
    const span = Math.max(1, yearHi - yearLo);
    const chartW = Math.max(1, width - MARGIN.left - MARGIN.right);
    const maxTicks = Math.max(2, Math.floor(chartW / 80));
    const rawStep = span / maxTicks;
    const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100];
    const step = niceSteps.find((s) => s >= rawStep) ?? 100;
    const ticks: number[] = [];
    for (let y = Math.ceil(yearLo / step) * step; y <= yearHi; y += step) {
      ticks.push(y);
    }
    return ticks;
  }, [xScale, width]);

  // Per-lane color lookup (agency color, falling back to the dataset color so
  // new datasets whose agencies aren't in AGENCY_COLORS still read correctly).
  const laneColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lanes) if (l.kind === "agency") m.set(l.key, AGENCY_COLORS[l.agency] || l.datasetMeta.color);
    return m;
  }, [lanes]);

  // Group events into marks placed ON the lane centerline (no random jitter).
  // Within a lane, events whose x-positions fall within CLUSTER_PX of a cluster
  // anchor are merged into one count-bearing cluster — mirroring the map, where
  // co-located points (e.g. same-day events) collapse into a single marker that
  // lists its members. Clusters split apart as you zoom (x spreads out), but
  // truly same-day events stay grouped and are read via the member list.
  const CLUSTER_PX = 12;
  const marks = useMemo(() => {
    type Mark = { key: string; x: number; y: number; color: string; cases: Case[] };
    const xMin = MARGIN.left;
    const xMax = width - MARGIN.right;
    // Bucket valid, in-view events by lane.
    const byLane = new Map<string, { case: Case; x: number }[]>();
    for (const c of cases) {
      if (!c.incidentDate) continue;
      const laneKey = `${c.dataset}::${c.agency}`;
      const layout = laneLayout.get(laneKey);
      if (!layout || layout.kind !== "agency") continue;
      const x = xScale(new Date(c.incidentDate));
      if (x < xMin || x > xMax) continue;
      const arr = byLane.get(laneKey);
      if (arr) arr.push({ case: c, x });
      else byLane.set(laneKey, [{ case: c, x }]);
    }
    const out: Mark[] = [];
    for (const [laneKey, arr] of byLane) {
      const layout = laneLayout.get(laneKey)!;
      const cy = layout.top + layout.height / 2;
      const color = laneColor.get(laneKey) || "#7ab8ff";
      arr.sort((a, b) => a.x - b.x);
      let anchorX = -Infinity;
      let cur: { cases: Case[]; xs: number[] } | null = null;
      const flush = () => {
        if (!cur) return;
        const cx = cur.xs.reduce((s, v) => s + v, 0) / cur.xs.length;
        out.push({ key: `${laneKey}@${Math.round(cx)}#${cur.cases.length}`, x: cx, y: cy, color, cases: cur.cases });
        cur = null;
      };
      for (const d of arr) {
        if (cur && d.x - anchorX <= CLUSTER_PX) {
          cur.cases.push(d.case);
          cur.xs.push(d.x);
        } else {
          flush();
          cur = { cases: [d.case], xs: [d.x] };
          anchorX = d.x;
        }
      }
      flush();
    }
    return out;
  }, [cases, xScale, laneLayout, width, laneColor]);

  const [hovered, setHovered] = useState<{ x: number; y: number; cases: Case[] } | null>(null);
  // Persistent member list for a clicked cluster (mirrors the map's popover).
  const [clusterPopup, setClusterPopup] = useState<{ x: number; y: number; cases: Case[] } | null>(null);

  // Brush selection for zoom-to-range.
  const svgRef = useRef<SVGSVGElement>(null);
  const [brush, setBrush] = useState<{ startX: number; currentX: number } | null>(null);

  const localX = useCallback((clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return clientX - r.left;
  }, []);

  const onBrushPointerDown = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      if (e.button !== 0) return;
      setClusterPopup(null);
      const x = localX(e.clientX);
      setBrush({ startX: x, currentX: x });
    },
    [localX],
  );

  // Stale popup coordinates after a zoom — dismiss it.
  useEffect(() => {
    setClusterPopup(null);
  }, [xDomain]);

  // Track move/up at the document level so dragging off the chart still works.
  useEffect(() => {
    if (!brush) return;
    const onMove = (e: PointerEvent) => {
      const x = Math.max(MARGIN.left, Math.min(width - MARGIN.right, localX(e.clientX)));
      setBrush((b) => (b ? { ...b, currentX: x } : b));
    };
    const onUp = () => {
      setBrush((b) => {
        if (!b) return null;
        const lo = Math.min(b.startX, b.currentX);
        const hi = Math.max(b.startX, b.currentX);
        if (hi - lo >= MIN_BRUSH_PX) {
          onXDomainChange([xScale.invert(lo), xScale.invert(hi)]);
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [brush, width, xScale, localX, onXDomainChange]);

  const resetZoom = useCallback(() => onXDomainChange(null), [onXDomainChange]);

  const isZoomed = xDomain !== null;
  const brushLo = brush ? Math.min(brush.startX, brush.currentX) : 0;
  const brushHi = brush ? Math.max(brush.startX, brush.currentX) : 0;
  const brushActive = brush && brushHi - brushLo >= MIN_BRUSH_PX;

  // Date-range pickers in the sticky header drive the same xDomain as the
  // brush. Values reflect the current visible domain; bounds clamp to the full
  // data extent. Format/parse on local Y-M-D parts to dodge the UTC
  // off-by-one that new Date("yyyy-mm-dd") introduces.
  const [curLo, curHi] = xScale.domain() as [Date, Date];
  const [fullLo, fullHi] = effectiveFull;
  const toInput = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const fromInput = (s: string): Date | null => {
    const [y, m, d] = s.split("-").map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  };
  const applyFrom = (s: string) => {
    const lo = fromInput(s);
    if (lo && lo.getTime() < curHi.getTime()) onXDomainChange([lo, curHi]);
  };
  const applyTo = (s: string) => {
    const hi = fromInput(s);
    if (hi && hi.getTime() > curLo.getTime()) onXDomainChange([curLo, hi]);
  };
  const dateInputSx = {
    bgcolor: "rgba(255,255,255,0.04)",
    color: "text.primary",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 1,
    px: 0.75,
    py: 0.35,
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 12,
    colorScheme: "dark",
    outline: "none",
    "&:focus": { borderColor: "rgba(122,184,255,0.65)" },
  } as const;

  return (
    <Box
      sx={{
        position: "relative",
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Sticky control + axis header — stays pinned while the lanes scroll */}
      <Box
        sx={{
          flex: "0 0 auto",
          bgcolor: "background.default",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
            pl: `${MARGIN.left}px`,
            pr: `${MARGIN.right}px`,
            py: 0.75,
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", letterSpacing: "0.08em", fontWeight: 700 }}
          >
            RANGE
          </Typography>
          <Box
            component="input"
            type="date"
            aria-label="Range start date"
            value={toInput(curLo)}
            min={toInput(fullLo)}
            max={toInput(curHi)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => applyFrom(e.target.value)}
            sx={dateInputSx}
          />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            →
          </Typography>
          <Box
            component="input"
            type="date"
            aria-label="Range end date"
            value={toInput(curHi)}
            min={toInput(curLo)}
            max={toInput(fullHi)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => applyTo(e.target.value)}
            sx={dateInputSx}
          />
          <Box sx={{ flexGrow: 1 }} />
          {isZoomed && (
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", fontFamily: "JetBrains Mono, monospace" }}
            >
              {fmtDate(curLo)} – {fmtDate(curHi)}
            </Typography>
          )}
          <Button
            size="small"
            variant="outlined"
            startIcon={<RestartAltIcon />}
            onClick={resetZoom}
            disabled={!isZoomed}
            sx={{ textTransform: "none" }}
          >
            Reset
          </Button>
        </Box>
        <svg
          ref={svgRef}
          width={width}
          height={AXIS_H}
          style={{ display: "block", userSelect: "none" }}
        >
          {/* Year labels */}
          {yearTicks.map((y) => {
            const x = xScale(new Date(`${y}-01-01`));
            if (x < MARGIN.left || x > width - MARGIN.right) return null;
            return (
              <text
                key={y}
                x={x}
                y={MARGIN.top - 14}
                textAnchor="middle"
                fill="rgba(255,255,255,0.5)"
                fontSize={11}
                fontFamily="JetBrains Mono, monospace"
              >
                {y}
              </text>
            );
          })}
          {/* Dedicated zoom band — visible affordance for brushing */}
          <BrushBand
            x={MARGIN.left}
            y={MARGIN.top}
            width={Math.max(0, width - MARGIN.left - MARGIN.right)}
            height={BRUSH_BAND_HEIGHT}
            dragging={!!brush}
            onPointerDown={onBrushPointerDown}
            onDoubleClick={resetZoom}
          />
          {/* Selection highlight within the band while dragging */}
          {brush && (
            <rect
              x={brushLo}
              y={MARGIN.top}
              width={brushHi - brushLo}
              height={BRUSH_BAND_HEIGHT}
              fill="#7ab8ff"
              fillOpacity={0.2}
              stroke="#7ab8ff"
              strokeOpacity={brushActive ? 0.65 : 0.25}
              pointerEvents="none"
            />
          )}
        </svg>
      </Box>

      {/* Scrolling lane body */}
      <Box
        ref={wrapRef}
        sx={{
          flex: "1 1 auto",
          position: "relative",
          overflowX: "hidden",
          overflowY: "auto",
        }}
      >
        <svg
          width={width}
          height={height}
          style={{ display: "block", userSelect: "none" }}
        >
        {/* Lane backgrounds + labels — interleaves dataset headers and agency rows */}
        {lanes.map((lane, i) => {
          const layout = laneLayout.get(lane.key)!;
          const y = layout.top;
          const h = layout.height;
          if (lane.kind === "header") {
            return (
              <g key={lane.key}>
                <rect
                  x={0}
                  y={y}
                  width={width}
                  height={h}
                  fill={lane.datasetMeta.color}
                  fillOpacity={0.07}
                />
                <line
                  x1={0}
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke={lane.datasetMeta.color}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 14}
                  y={y + h / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill={lane.datasetMeta.color}
                  fontSize={11}
                  fontWeight={700}
                  letterSpacing="0.08em"
                  style={{ textTransform: "capitalize" }}
                >
                  {lane.datasetMeta.shortName}
                </text>
                <text
                  x={width - MARGIN.right + 6}
                  y={y + h / 2}
                  textAnchor="start"
                  dominantBaseline="middle"
                  fill="rgba(255,255,255,0.35)"
                  fontSize={10}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {lane.totalCount.toLocaleString()}
                </text>
              </g>
            );
          }
          // Agency lane — highlight if it contains the currently selected case
          const isSelectedLane =
            selectedCase &&
            lane.kind === "agency" &&
            lane.key === `${selectedCase.dataset}::${selectedCase.agency}`;
          return (
            <g key={lane.key}>
              <rect
                x={0}
                y={y}
                width={width}
                height={h}
                fill={
                  isSelectedLane
                    ? "rgba(207,227,255,0.05)"
                    : i % 2 === 0
                      ? "rgba(255,255,255,0.015)"
                      : "transparent"
                }
              />
              {isSelectedLane && (
                <>
                  <line
                    x1={0}
                    x2={width}
                    y1={y + 1}
                    y2={y + 1}
                    stroke="#cfe3ff"
                    strokeOpacity={0.3}
                    strokeWidth={1}
                  />
                  <line
                    x1={0}
                    x2={width}
                    y1={y + h - 1}
                    y2={y + h - 1}
                    stroke="#cfe3ff"
                    strokeOpacity={0.3}
                    strokeWidth={1}
                  />
                </>
              )}
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y + h / 2}
                y2={y + h / 2}
                stroke="rgba(255,255,255,0.04)"
                strokeDasharray="2 4"
              />
              <text
                x={MARGIN.left - 14}
                y={y + h / 2 - 6}
                textAnchor="end"
                dominantBaseline="middle"
                fill={AGENCY_COLORS[lane.agency] || "#e6ecf2"}
                fontSize={13}
                fontWeight={600}
              >
                {AGENCY_SHORT[lane.agency] || lane.agency}
              </text>
              <text
                x={MARGIN.left - 14}
                y={y + h / 2 + 9}
                textAnchor="end"
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.35)"
                fontSize={10}
                fontFamily="JetBrains Mono, monospace"
              >
                {lane.count.toLocaleString()} plotted
              </text>
            </g>
          );
        })}

        {/* Year gridlines (labels live in the sticky header) */}
        {yearTicks.map((y) => {
          const x = xScale(new Date(`${y}-01-01`));
          if (x < MARGIN.left || x > width - MARGIN.right) return null;
          return (
            <line
              key={y}
              x1={x}
              x2={x}
              y1={0}
              y2={height - MARGIN.bottom + 4}
              stroke="rgba(255,255,255,0.04)"
            />
          );
        })}

        {/* Brush rectangle (visual feedback while dragging) — spans the full
            scrolling lane body vertically */}
        {brush && (
          <rect
            x={brushLo}
            y={0}
            width={brushHi - brushLo}
            height={height}
            fill="#7ab8ff"
            fillOpacity={0.14}
            stroke="#7ab8ff"
            strokeOpacity={brushActive ? 0.65 : 0.25}
            pointerEvents="none"
          />
        )}

        {/* Marks — single events render as dots; co-located events render as a
            count cluster that lists its members on hover/click. All sit on the
            lane centerline (deterministic, never bleeding into other lanes). */}
        {marks.map((m) => {
          const n = m.cases.length;
          const containsSelected = selectedCase ? m.cases.some((c) => c.id === selectedCase.id) : false;
          if (n === 1) {
            const c = m.cases[0];
            return (
              <g key={m.key}>
                {containsSelected && (
                  <circle cx={m.x} cy={m.y} r={DOT_RADIUS + 4} fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={2} pointerEvents="none">
                    <animate attributeName="r" values={`${DOT_RADIUS + 3};${DOT_RADIUS + 9};${DOT_RADIUS + 3}`} dur="1.8s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" values="0.9;0.2;0.9" dur="1.8s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={DOT_RADIUS}
                  fill={m.color}
                  fillOpacity={c.sourceUrl ? 0.85 : 0.4}
                  stroke={m.color}
                  strokeOpacity={0.8}
                  strokeWidth={1}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHovered({ x: m.x, y: m.y, cases: m.cases })}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onSelect(c)}
                />
              </g>
            );
          }
          // Cluster
          const r = clusterRadius(n);
          return (
            <g key={m.key} style={{ cursor: "pointer" }}>
              {containsSelected && (
                <circle cx={m.x} cy={m.y} r={r + 4} fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={2} pointerEvents="none" />
              )}
              <circle
                cx={m.x}
                cy={m.y}
                r={r}
                fill={m.color}
                fillOpacity={0.28}
                stroke={m.color}
                strokeOpacity={0.95}
                strokeWidth={1.5}
                onMouseEnter={() => setHovered({ x: m.x, y: m.y, cases: m.cases })}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  setHovered(null);
                  // Store viewport coords so the popup stays on-screen regardless
                  // of scroll position.
                  setClusterPopup({ x: e.clientX, y: e.clientY, cases: m.cases });
                }}
              />
              <text
                x={m.x}
                y={m.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ffffff"
                fontSize={Math.min(11, r)}
                fontWeight={700}
                fontFamily="JetBrains Mono, monospace"
                pointerEvents="none"
              >
                {n}
              </text>
            </g>
          );
        })}
      </svg>

      {hovered && !brush && !clusterPopup && (() => {
        const TIP_W = 320;
        const TIP_GAP = 14;
        const flipLeft = hovered.x + TIP_GAP + TIP_W > width - 8;
        const left = flipLeft
          ? Math.max(8, hovered.x - TIP_GAP - TIP_W)
          : Math.min(hovered.x + TIP_GAP, width - TIP_W - 8);
        const top = Math.min(hovered.y + TIP_GAP, height - 100);
        const n = hovered.cases.length;
        const head = hovered.cases[0];
        const shown = hovered.cases.slice(0, 6);
        return (
          <Box
            sx={{
              position: "absolute",
              left,
              top,
              pointerEvents: "none",
              bgcolor: "#0a0d12",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 1,
              px: 1.5,
              py: 1,
              width: TIP_W,
              boxSizing: "border-box",
              zIndex: 10,
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {n === 1 ? `${head.incidentDateRaw} · ${head.agency}` : `${n} events · ${dateSpanLabel(hovered.cases)}`}
            </Typography>
            {n === 1 ? (
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3, mt: 0.5 }}>
                {head.title}
              </Typography>
            ) : (
              <Box sx={{ mt: 0.5 }}>
                {shown.map((c) => (
                  <Typography key={c.id} variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3, mb: 0.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    • {c.title}
                  </Typography>
                ))}
                {n > shown.length && (
                  <Typography variant="caption" color="text.secondary">+{n - shown.length} more — click to list</Typography>
                )}
              </Box>
            )}
          </Box>
        );
      })()}
      </Box>

      {/* Cluster member list — uses the same CaseRow as the map's popover so
          the two selection menus are visually identical. */}
      {clusterPopup && (() => {
        const POP_W = 340;
        const POP_MAXH = 380;
        const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        const flipLeft = clusterPopup.x + 14 + POP_W > vw - 8;
        const left = flipLeft ? Math.max(8, clusterPopup.x - 14 - POP_W) : Math.min(clusterPopup.x + 14, vw - POP_W - 8);
        const top = Math.max(8, Math.min(clusterPopup.y - 20, vh - POP_MAXH - 8));
        const sorted = [...clusterPopup.cases].sort((a, b) => (a.incidentDate || "9999").localeCompare(b.incidentDate || "9999"));
        // Can we separate this cluster by zooming? Only if its events span more
        // than one date (same-day events stay grouped, like co-located points).
        const msList = sorted.map((c) => (c.incidentDate ? new Date(c.incidentDate).getTime() : NaN)).filter((n) => !Number.isNaN(n));
        const minMs = Math.min(...msList);
        const maxMs = Math.max(...msList);
        const canZoom = msList.length > 1 && maxMs > minMs;
        return (
          <>
            {/* backdrop to dismiss */}
            <Box onClick={() => setClusterPopup(null)} sx={{ position: "fixed", inset: 0, zIndex: 11 }} />
            <Box
              sx={{
                position: "fixed",
                left,
                top,
                bgcolor: "background.paper",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 1,
                width: POP_W,
                maxWidth: 360,
                maxHeight: POP_MAXH,
                display: "flex",
                flexDirection: "column",
                p: 1.5,
                boxSizing: "border-box",
                zIndex: 12,
                boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.25 }}>
                {sorted.length} event{sorted.length === 1 ? "" : "s"} · {dateSpanLabel(sorted)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                {canZoom ? "Click an event to open it, or zoom in to separate." : "Click an event to open it."}
              </Typography>
              <Stack spacing={0.5} sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {sorted.map((c) => (
                  <CaseRow
                    key={c.id}
                    kase={c}
                    location={c.incidentLocation || undefined}
                    onSelect={(x) => { onSelect(x); setClusterPopup(null); }}
                    trailing={<AddToCasesButton kase={c} />}
                  />
                ))}
              </Stack>
              {canZoom && (
                <Box sx={{ mt: 1, pt: 1, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <Button
                    size="small"
                    fullWidth
                    variant="outlined"
                    onClick={() => {
                      const pad = Math.max((maxMs - minMs) * 0.15, 7 * 86400 * 1000);
                      onXDomainChange([new Date(minMs - pad), new Date(maxMs + pad)]);
                      setClusterPopup(null);
                    }}
                    sx={{ textTransform: "none", fontSize: 11 }}
                  >
                    Zoom in further
                  </Button>
                </Box>
              )}
            </Box>
          </>
        );
      })()}
    </Box>
  );
}

function BrushBand({
  x,
  y,
  width,
  height,
  dragging,
  onPointerDown,
  onDoubleClick,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<SVGRectElement>) => void;
  onDoubleClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const active = dragging || hover;
  return (
    <g style={{ cursor: "ew-resize" }}>
      {/* Background */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={active ? "rgba(122,184,255,0.12)" : "rgba(122,184,255,0.05)"}
        stroke="rgba(122,184,255,0.35)"
        strokeWidth={1}
        rx={4}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      {/* Grip handles on each side */}
      {[x + 8, x + width - 8].map((gx, i) => (
        <g key={i} pointerEvents="none">
          <line x1={gx} x2={gx} y1={y + 6} y2={y + height - 6} stroke="rgba(122,184,255,0.45)" strokeWidth={1} />
          <line x1={gx + 3} x2={gx + 3} y1={y + 6} y2={y + height - 6} stroke="rgba(122,184,255,0.45)" strokeWidth={1} />
        </g>
      ))}
      {/* Label — adapts to band width */}
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={active ? "#cfe3ff" : "rgba(207,227,255,0.6)"}
        fontSize={11}
        fontWeight={600}
        letterSpacing="0.06em"
        pointerEvents="none"
        style={{ textTransform: "capitalize" }}
      >
        {dragging
          ? "Release to zoom"
          : width > 360
            ? "↔  Drag here to set time range"
            : width > 180
              ? "↔  Drag to zoom"
              : "↔"}
      </text>
    </g>
  );
}
