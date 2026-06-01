// "Your Cases" — the combined view. Opened from the header counter.
//
// Layout: a narrow LEFT rail with a two-up vertical stack — a small map fit to
// all cases (with links between correlated pairs) on top, a compact timeline
// below — and a wide MAIN area where the cases stack horizontally as side-by-
// side study cards, each showing its full synopsis and which other cases it
// correlates with. Distance/time sliders re-draw the links (same haversine +
// day-delta math as proximity.ts).

import { useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Slider from "@mui/material/Slider";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { scaleTime } from "d3-scale";
import type { Case } from "./types";
import { AGENCY_COLORS, AGENCY_SHORT } from "./theme";
import { DATASETS } from "./datasets";
import { getLatLng, haversineKm, formatDaysDelta } from "./proximity";
import { fmtDistance } from "./blastPhysics";
import { useUnits } from "./units";
import { YieldSparkline, AltitudeSparkline } from "./Sparklines";
import { casesStore, useCaseIds } from "./collection";
import { CaseGraph } from "./CaseGraph";
import type { EntityIndex, Entity } from "./entities";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";

const MS_DAY = 86_400_000;
const dotColor = (c: Case) => AGENCY_COLORS[c.agency] || DATASETS[c.dataset]?.color || "#7ab8ff";

type Props = {
  open: boolean;
  onClose: () => void;
  allCases: Case[];
  onSelect: (c: Case) => void;
  entityIndex: EntityIndex;
  onEntity?: (entityId: string) => void;
};

// A person/place shared by two or more of the collected cases.
type SharedEntity = { entity: Entity; idxs: number[] };

type Pt = { i: number; c: Case; ll: { lat: number; lng: number } | null; t: number | null };
type Link = { a: Pt; b: Pt; km: number; days: number; score: number };

export function CasesOverlay({ open, onClose, allCases, onSelect, entityIndex, onEntity }: Props) {
  const ids = useCaseIds();
  const units = useUnits();
  const [maxKm, setMaxKm] = useState(500);
  const [maxYears, setMaxYears] = useState(5);
  const [leftView, setLeftView] = useState<"map" | "graph">("map");

  const byId = useMemo(() => new Map(allCases.map((c) => [c.id, c])), [allCases]);
  const cases = useMemo(
    () =>
      ids
        .map((id) => byId.get(id))
        .filter((c): c is Case => !!c)
        .sort((a, b) => (a.incidentDate || "9999").localeCompare(b.incidentDate || "9999")),
    [ids, byId],
  );

  const pts: Pt[] = useMemo(
    () => cases.map((c, i) => ({ i: i + 1, c, ll: getLatLng(c), t: c.incidentDate ? new Date(c.incidentDate).getTime() : null })),
    [cases],
  );

  const links: Link[] = useMemo(() => {
    const out: Link[] = [];
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        if (!a.ll || !b.ll || a.t == null || b.t == null) continue;
        const km = haversineKm(a.ll, b.ll);
        const days = Math.abs(a.t - b.t) / MS_DAY;
        if (km <= maxKm && days / 365.25 <= maxYears) out.push({ a, b, km, days, score: km / maxKm + days / 365.25 / maxYears });
      }
    return out.sort((x, y) => x.score - y.score);
  }, [pts, maxKm, maxYears]);

  // Network correlations: entities (people / places) shared by ≥2 collected
  // cases — the cross-dataset connective tissue the proximity links can't see.
  const shared: SharedEntity[] = useMemo(() => {
    const m = new Map<string, SharedEntity>();
    for (const p of pts) {
      for (const e of entityIndex.forCase(p.c)) {
        const cur = m.get(e.id) || { entity: e, idxs: [] };
        if (!cur.idxs.includes(p.i)) cur.idxs.push(p.i);
        m.set(e.id, cur);
      }
    }
    return [...m.values()]
      .filter((x) => x.idxs.length >= 2)
      .sort((a, b) => b.idxs.length - a.idxs.length);
  }, [pts, entityIndex]);

  const times = pts.map((p) => p.t).filter((t): t is number => t != null);
  const span = times.length > 1 ? `${new Date(Math.min(...times)).getUTCFullYear()}–${new Date(Math.max(...times)).getUTCFullYear()}` : times.length === 1 ? `${new Date(times[0]).getUTCFullYear()}` : "—";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{ paper: { sx: { bgcolor: "#0d1117", border: "1px solid rgba(255,255,255,0.12)", width: "min(1400px, 95vw)", maxWidth: "95vw", height: "min(88vh, 880px)", m: 1 } } }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.25, borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>🗂 Your Cases · {cases.length}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
          {span} · <b style={{ color: "#ffb454" }}>{links.length}</b> proximity ·{" "}
          <b style={{ color: "#7aa7d6" }}>{shared.length}</b> shared
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Slider2 label="distance ≤" value={maxKm} min={25} max={2000} step={25} unit="km" displayValue={fmtDistance(maxKm * 1000, units)} onChange={setMaxKm} />
        <Slider2 label="time ≤" value={maxYears} min={1} max={20} step={1} unit="yr" onChange={setMaxYears} />
        <Button size="small" startIcon={<DeleteOutlineIcon sx={{ fontSize: 16 }} />} onClick={() => casesStore.clear()} sx={{ textTransform: "none", color: "text.secondary" }}>Clear</Button>
        <IconButton size="small" onClick={onClose} aria-label="Close"><CloseIcon fontSize="small" /></IconButton>
      </Box>

      {cases.length === 0 ? (
        <Box sx={{ display: "grid", placeItems: "center", flexGrow: 1, color: "text.secondary", textAlign: "center", p: 4 }}>
          <Box>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No cases yet</Typography>
            <Typography variant="body2" color="text.secondary">Use <b>＋ Add Case</b> on any case — on the map, the timeline, or in its detail panel — to collect it here.</Typography>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
          {/* LEFT rail — two-up vertical: map (top) + timeline (bottom) */}
          <Box sx={{ width: { xs: 240, md: 320 }, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Box sx={{ flex: "1 1 auto", minHeight: 180, display: "flex", flexDirection: "column", p: 1.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Label sx={{ flexGrow: 1 }}>{leftView === "map" ? "MAP — fit to all · links = pairs" : "NETWORK — shared people & places"}</Label>
                <Box sx={{ display: "flex", gap: 0.5 }}>
                  {(["map", "graph"] as const).map((v) => (
                    <Box
                      key={v}
                      onClick={() => setLeftView(v)}
                      sx={{
                        fontSize: 10,
                        fontFamily: "JetBrains Mono, monospace",
                        px: 0.75,
                        py: 0.25,
                        borderRadius: 0.75,
                        cursor: "pointer",
                        color: leftView === v ? "#0a0d12" : "text.secondary",
                        bgcolor: leftView === v ? "#7aa7d6" : "rgba(255,255,255,0.06)",
                        "&:hover": { bgcolor: leftView === v ? "#7aa7d6" : "rgba(255,255,255,0.12)" },
                      }}
                    >
                      {v === "map" ? "Map" : "Network"}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box sx={{ flexGrow: 1, minHeight: 0, mt: 0.5 }}>
                {leftView === "map" ? (
                  <MiniMap pts={pts} links={links} />
                ) : (
                  <CaseGraph pts={pts} shared={shared} onOpen={(c) => { onSelect(c); onClose(); }} onEntity={onEntity} caseColor={dotColor} />
                )}
              </Box>
            </Box>
            <Box sx={{ flexShrink: 0, p: 1.5, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <Label>TIMELINE — these {cases.length} cases</Label>
              <Box sx={{ mt: 0.5 }}><MiniTimeline pts={pts} /></Box>
            </Box>
            <Box sx={{ flexShrink: 0, p: 1.5, borderTop: "1px solid rgba(255,255,255,0.08)", maxHeight: 220, overflowY: "auto" }}>
              <Label>SHARED CONNECTIONS — {shared.length}</Label>
              {shared.length === 0 ? (
                <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
                  No shared people or places yet — collect cases that overlap.
                </Typography>
              ) : (
                <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                  {shared.map((s) => (
                    <SharedRow key={s.entity.id} s={s} pts={pts} onEntity={onEntity} />
                  ))}
                </Stack>
              )}
            </Box>
          </Box>

          {/* MAIN — case studies side by side */}
          <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Label sx={{ px: 2, pt: 1.25 }}>CASE STUDIES ({cases.length}) — scroll horizontally →</Label>
            <Box sx={{ flexGrow: 1, minHeight: 0, overflowX: "auto", overflowY: "hidden", display: "flex", gap: 1.5, p: 1.5 }}>
              {pts.map((p) => (
                <CaseCard key={p.c.id} pt={p} links={links} onOpen={(c) => { onSelect(c); onClose(); }} />
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Dialog>
  );
}

function Label({ children, sx }: { children: React.ReactNode; sx?: object }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.04em", display: "block", ...sx }}>
      {children}
    </Typography>
  );
}

// --- Case study card ---------------------------------------------------------

function CaseCard({ pt, links, onOpen }: { pt: Pt; links: Link[]; onOpen: (c: Case) => void }) {
  const c = pt.c;
  const units = useUnits();
  const color = dotColor(c);
  const meta = [c.incidentDateRaw || "undated", AGENCY_SHORT[c.agency] || c.agency, c.incidentLocation].filter(Boolean).join(" · ");
  const showSparks = typeof c.yieldKt === "number" || (c.dataset === "nuclear-test" && !!(c.subtype || c.type));
  const myLinks = links
    .filter((l) => l.a.i === pt.i || l.b.i === pt.i)
    .map((l) => ({ other: l.a.i === pt.i ? l.b : l.a, km: l.km, days: l.days }))
    .sort((a, b) => a.km - b.km);

  return (
    <Box
      sx={{
        width: 290,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        bgcolor: "#11161e",
        border: "1px solid rgba(255,255,255,0.08)",
        borderTop: `3px solid ${color}`,
        borderRadius: 1.5,
        overflow: "hidden",
      }}
    >
      {/* header */}
      <Box sx={{ p: 1.5, pb: 1, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
          <Box sx={{ width: 18, height: 18, borderRadius: "50%", bgcolor: color, color: "#0a0d12", fontSize: 10, fontWeight: 800, fontFamily: "JetBrains Mono, monospace", display: "grid", placeItems: "center", flexShrink: 0 }}>{pt.i}</Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9.5, flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</Typography>
          <IconButton size="small" onClick={() => casesStore.remove(c.id)} aria-label="Remove" sx={{ color: "text.disabled", p: 0.25 }}><CloseIcon sx={{ fontSize: 15 }} /></IconButton>
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{c.title}</Typography>
        {showSparks && (
          <Box sx={{ display: "flex", gap: 1.25, alignItems: "center", mt: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
            {typeof c.yieldKt === "number" && <YieldSparkline kt={c.yieldKt} ktUpper={c.yieldKtUpper} />}
            {c.dataset === "nuclear-test" && <AltitudeSparkline altM={c.altitudeM} typeStr={c.subtype || c.type || ""} />}
          </Box>
        )}
      </Box>

      {/* full synopsis */}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: 1.5, py: 1.25 }}>
        <Typography variant="body2" sx={{ fontSize: 12.5, lineHeight: 1.5, color: "text.secondary", whiteSpace: "pre-wrap" }}>
          {c.description || "No synopsis available."}
        </Typography>
      </Box>

      {/* correlations for this case */}
      {myLinks.length > 0 && (
        <Box sx={{ px: 1.5, py: 1, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <Label sx={{ mb: 0.5 }}>CORRELATES WITH</Label>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {myLinks.map((l, k) => (
              <Box key={k} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, border: "1px solid rgba(255,180,84,0.4)", borderRadius: 1, px: 0.75, py: 0.25 }}>
                <Box sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: dotColor(l.other.c), color: "#0a0d12", fontSize: 8.5, fontWeight: 800, fontFamily: "JetBrains Mono, monospace", display: "grid", placeItems: "center" }}>{l.other.i}</Box>
                <Typography sx={{ fontSize: 10, color: "#ffb454", fontFamily: "JetBrains Mono, monospace" }}>{fmtDistance(l.km * 1000, units)} / {formatDaysDelta(Math.round(l.days))}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* footer */}
      <Box sx={{ px: 1.5, py: 1, borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 1 }}>
        <Button size="small" variant="outlined" onClick={() => onOpen(c)} sx={{ textTransform: "none", fontSize: 11, py: 0.25 }}>Open</Button>
        {c.sourceUrl && (
          <Link href={c.sourceUrl} target="_blank" rel="noopener noreferrer" sx={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 0.25 }}>
            Source <OpenInNewIcon sx={{ fontSize: 12 }} />
          </Link>
        )}
      </Box>
    </Box>
  );
}

// --- header slider -----------------------------------------------------------

// One shared entity (person/place) + the numbered badges of the collected
// cases that share it — the network "edge" rendered compactly.
function SharedRow({ s, pts, onEntity }: { s: SharedEntity; pts: Pt[]; onEntity?: (id: string) => void }) {
  const byIdx = new Map(pts.map((p) => [p.i, p]));
  const isPlace = s.entity.type === "place";
  const Icon = isPlace ? PlaceOutlinedIcon : PersonOutlineIcon;
  return (
    <Box
      onClick={onEntity ? () => onEntity(s.entity.id) : undefined}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        p: 0.5,
        borderRadius: 1,
        cursor: onEntity ? "pointer" : "default",
        "&:hover": onEntity ? { bgcolor: "rgba(255,255,255,0.04)" } : undefined,
      }}
    >
      <Icon sx={{ fontSize: 15, color: isPlace ? "#7aa7d6" : "#9aa5b1", flexShrink: 0 }} />
      <Typography variant="caption" sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {s.entity.name}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.25, flexShrink: 0 }}>
        {s.idxs.map((i) => {
          const c = byIdx.get(i)?.c;
          return (
            <Box
              key={i}
              sx={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                bgcolor: c ? dotColor(c) : "#555",
                color: "#0a0d12",
                fontSize: 9,
                fontWeight: 800,
                fontFamily: "JetBrains Mono, monospace",
                display: "grid",
                placeItems: "center",
              }}
            >
              {i}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function Slider2({ label, value, min, max, step, unit, displayValue, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; displayValue?: string; onChange: (v: number) => void }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 150 }}>
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", fontFamily: "JetBrains Mono, monospace" }}>
        {label} <b style={{ color: "#e6ecf2" }}>{displayValue ?? `${value} ${unit}`}</b>
      </Typography>
      <Slider size="small" value={value} min={min} max={max} step={step} onChange={(_, v) => onChange(v as number)} sx={{ width: 70 }} />
    </Box>
  );
}

// --- mini visualizations -----------------------------------------------------

function MiniMap({ pts, links }: { pts: Pt[]; links: Link[] }) {
  const W = 300, H = 220, pad = 22;
  const geo = pts.filter((p) => p.ll);
  if (geo.length === 0) {
    return <Box sx={{ height: "100%", minHeight: 160, display: "grid", placeItems: "center", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: 1.5, color: "text.disabled", fontSize: 11, textAlign: "center", p: 1 }}>No geolocated cases</Box>;
  }
  const lngs = geo.map((p) => p.ll!.lng), lats = geo.map((p) => p.ll!.lat);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  if (maxLng - minLng < 1) { minLng -= 8; maxLng += 8; }
  if (maxLat - minLat < 1) { minLat -= 5; maxLat += 5; }
  const x = (lng: number) => pad + ((lng - minLng) / (maxLng - minLng)) * (W - pad * 2);
  const y = (lat: number) => pad + ((maxLat - lat) / (maxLat - minLat)) * (H - pad * 2);
  return (
    <Box sx={{ height: "100%", minHeight: 160, bgcolor: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 1.5 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5}>
            <line x1={pad + f * (W - pad * 2)} y1={pad} x2={pad + f * (W - pad * 2)} y2={H - pad} />
            <line x1={pad} y1={pad + f * (H - pad * 2)} x2={W - pad} y2={pad + f * (H - pad * 2)} />
          </g>
        ))}
        {links.map((l, k) => (l.a.ll && l.b.ll ? <line key={k} x1={x(l.a.ll.lng)} y1={y(l.a.ll.lat)} x2={x(l.b.ll.lng)} y2={y(l.b.ll.lat)} stroke="#ffb454" strokeOpacity={0.55} strokeWidth={1.3} /> : null))}
        {geo.map((p) => (
          <g key={p.c.id} transform={`translate(${x(p.ll!.lng)} ${y(p.ll!.lat)})`}>
            <circle r={6.5} fill={dotColor(p.c)} fillOpacity={0.9} stroke="#0d1117" strokeWidth={1.5} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={800} fill="#0a0d12" fontFamily="JetBrains Mono, monospace">{p.i}</text>
          </g>
        ))}
      </svg>
    </Box>
  );
}

function MiniTimeline({ pts }: { pts: Pt[] }) {
  const W = 300, H = 44, pad = 14;
  const ts = pts.map((p) => p.t).filter((t): t is number => t != null);
  if (ts.length === 0) return <Typography variant="caption" color="text.disabled">No dated cases</Typography>;
  let lo = Math.min(...ts), hi = Math.max(...ts);
  if (hi === lo) { lo -= 365 * MS_DAY; hi += 365 * MS_DAY; }
  const padMs = (hi - lo) * 0.05;
  const sc = scaleTime().domain([new Date(lo - padMs), new Date(hi + padMs)]).range([pad, W - pad]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <line x1={pad} y1={H - 13} x2={W - pad} y2={H - 13} stroke="rgba(255,255,255,0.12)" />
      <text x={pad} y={11} fontSize={9} fill="#6b7685" fontFamily="JetBrains Mono, monospace">{new Date(lo).getUTCFullYear()}</text>
      <text x={W - pad} y={11} textAnchor="end" fontSize={9} fill="#6b7685" fontFamily="JetBrains Mono, monospace">{new Date(hi).getUTCFullYear()}</text>
      {pts.map((p) => (p.t != null ? (
        <g key={p.c.id} transform={`translate(${sc(new Date(p.t))} ${H - 13})`}>
          <circle r={6} fill={dotColor(p.c)} fillOpacity={0.9} stroke="#0d1117" strokeWidth={1} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={7.5} fontWeight={800} fill="#0a0d12" fontFamily="JetBrains Mono, monospace">{p.i}</text>
        </g>
      ) : null))}
    </svg>
  );
}
