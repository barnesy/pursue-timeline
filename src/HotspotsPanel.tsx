// Standalone Hotspots panel — extracted from the MapView absolute-positioned
// overlay so it can live in its own resizable pane.
//
// Click an entry to focus (filters both map + timeline to that hotspot's
// case set). Click again to clear. Selection highlight + narrative expansion
// mirror the previous in-map overlay behavior 1-for-1.

import { useMemo } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import HubIcon from "@mui/icons-material/Hub";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import type { Case } from "./types";
import { DATASETS, type DatasetId } from "./datasets";
import { NOTABLE_HOTSPOTS, type NotableHotspot } from "./notableHotspots";
import type { EntityIndex } from "./entities";
import type { CorpusStats } from "./corpusStats";
import { PLACES } from "./places";

const PLACE_NAME = new Map(PLACES.map((p) => [p.id, p.name]));

type Props = {
  /** Full case set (un-focused) — so totals don't shrink when a hotspot is
   *  focused, which would make the panel feel like it's collapsing under you. */
  allCases: Case[];
  focusedHotspot: NotableHotspot | null;
  onFocusChange: (h: NotableHotspot | null) => void;
  /** When provided, the header renders a collapse button that calls this. */
  onCollapse?: () => void;
  /** Cross-dataset entity registry — powers the "Top connectors" section. */
  entityIndex?: EntityIndex;
  onEntity?: (entityId: string) => void;
  /** Build-time analytics — powers the "Strongest correlations" feed. */
  corpusStats?: CorpusStats | null;
  onSelectCase?: (c: Case) => void;
};

export function HotspotsPanel({ allCases, focusedHotspot, onFocusChange, onCollapse, entityIndex, onEntity, corpusStats, onSelectCase }: Props) {
  // Per-hotspot stats: total matches + per-dataset breakdown.
  const stats = NOTABLE_HOTSPOTS.map((h) => {
    const matches = allCases.filter(h.matches);
    const datasetCounts = new Map<DatasetId, number>();
    for (const c of matches) {
      datasetCounts.set(c.dataset, (datasetCounts.get(c.dataset) || 0) + 1);
    }
    return { hotspot: h, total: matches.length, datasetCounts };
  });

  const toggle = (h: NotableHotspot) => {
    onFocusChange(focusedHotspot?.id === h.id ? null : h);
  };

  // Top network connectors — entities spanning the most datasets, then the
  // most records. Cross-dataset reach is what makes a connector interesting.
  const connectors = useMemo(() => {
    if (!entityIndex) return [];
    const dsOf = new Map(allCases.map((c) => [c.id, c.dataset]));
    return [...entityIndex.byId.values()]
      .map((e) => ({ e, datasets: new Set(e.caseIds.map((id) => dsOf.get(id))).size }))
      .filter((x) => x.datasets >= 2)
      .sort((a, b) => b.datasets - a.datasets || b.e.caseIds.length - a.e.caseIds.length)
      .slice(0, 8);
  }, [entityIndex, allCases]);

  // Strongest cross-document correlations corpus-wide (build-time scored).
  // Deduped so a single hub (e.g. one paper cited by many Stargate docs)
  // doesn't flood the feed — at most one link per (datasetA→datasetB) reason.
  const topLinks = useMemo(() => {
    if (!corpusStats || !onSelectCase) return [];
    const byId = new Map(allCases.map((c) => [c.id, c]));
    const out: { a: Case; b: Case; score: number; reason: string }[] = [];
    const seenReason = new Set<string>();
    for (const l of corpusStats.links) {
      const a = byId.get(l.a), b = byId.get(l.b);
      if (!a || !b) continue;
      const dedupKey = l.sharedPeople[0] || l.sharedPlaces[0] || `${a.dataset}~${b.dataset}`;
      if (seenReason.has(dedupKey)) continue;
      seenReason.add(dedupKey);
      // sharedPlaces are place IDs — resolve to the human name for display.
      const placeName = l.sharedPlaces[0] ? PLACE_NAME.get(l.sharedPlaces[0]) || l.sharedPlaces[0] : null;
      const reason = l.sharedPeople[0] || placeName || "content match";
      out.push({ a, b, score: l.score, reason });
      if (out.length >= 6) break;
    }
    return out;
  }, [corpusStats, allCases, onSelectCase]);

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        borderRight: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.25,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <HubIcon fontSize="small" sx={{ color: "#cfe3ff" }} />
        <Typography
          variant="caption"
          sx={{
            color: "text.primary",
            fontWeight: 700,
            textTransform: "capitalize",
            letterSpacing: "0.08em",
            fontSize: 10,
            flexGrow: 1,
          }}
        >
          Co-occurrences · {stats.length}
        </Typography>
        {onCollapse && (
          <Tooltip title="Collapse panel">
            <IconButton
              size="small"
              onClick={onCollapse}
              aria-label="Collapse co-occurrences panel"
              sx={{ color: "text.secondary", p: 0.25 }}
            >
              <KeyboardDoubleArrowLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ overflowY: "auto", flexGrow: 1, minHeight: 0 }}>
        <Stack divider={<Box sx={{ borderTop: "1px solid rgba(255,255,255,0.04)" }} />}>
          {stats.map((s) => (
            <NotableHotspotItem
              key={s.hotspot.id}
              hotspot={s.hotspot}
              total={s.total}
              datasetCounts={s.datasetCounts}
              selected={focusedHotspot?.id === s.hotspot.id}
              dimmed={focusedHotspot !== null && focusedHotspot.id !== s.hotspot.id}
              onClick={() => toggle(s.hotspot)}
            />
          ))}
        </Stack>

        {topLinks.length > 0 && onSelectCase && (
          <Box sx={{ borderTop: "1px solid rgba(255,255,255,0.08)", mt: 0.5 }}>
            <Typography
              variant="caption"
              sx={{ display: "block", px: 2, pt: 1.5, pb: 0.5, color: "text.secondary", fontWeight: 700, textTransform: "capitalize", letterSpacing: "0.08em", fontSize: 10 }}
            >
              Strongest correlations
            </Typography>
            <Stack sx={{ pb: 1 }}>
              {topLinks.map((l, i) => (
                <Box
                  key={i}
                  onClick={() => onSelectCase(l.a)}
                  sx={{ px: 2, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "rgba(255,255,255,0.04)" } }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: DATASETS[l.a.dataset].color, flexShrink: 0 }} />
                    <Box sx={{ width: 12, borderTop: "1px dashed rgba(255,255,255,0.25)", flexShrink: 0 }} />
                    <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: DATASETS[l.b.dataset].color, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color: "#ffb454", fontFamily: "JetBrains Mono, monospace", flexGrow: 1, textAlign: "right", fontSize: 10 }}>
                      via {l.reason}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ display: "block", color: "text.primary", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.a.title}
                  </Typography>
                  <Typography variant="caption" sx={{ display: "block", color: "text.secondary", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    ↔ {l.b.title}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        )}

        {connectors.length > 0 && onEntity && (
          <Box sx={{ borderTop: "1px solid rgba(255,255,255,0.08)", mt: 0.5 }}>
            <Typography
              variant="caption"
              sx={{
                display: "block",
                px: 2,
                pt: 1.5,
                pb: 0.5,
                color: "text.secondary",
                fontWeight: 700,
                textTransform: "capitalize",
                letterSpacing: "0.08em",
                fontSize: 10,
              }}
            >
              Top connectors
            </Typography>
            <Stack sx={{ pb: 1 }}>
              {connectors.map(({ e, datasets }) => {
                const Icon = e.type === "place" ? PlaceOutlinedIcon : PersonOutlineIcon;
                return (
                  <Box
                    key={e.id}
                    onClick={() => onEntity(e.id)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      px: 2,
                      py: 0.6,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "rgba(255,255,255,0.04)" },
                    }}
                  >
                    <Icon sx={{ fontSize: 15, color: e.type === "place" ? "#7aa7d6" : "#9aa5b1", flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: "JetBrains Mono, monospace", flexShrink: 0 }}>
                      {e.caseIds.length} · {datasets}ds
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function NotableHotspotItem({
  hotspot,
  total,
  datasetCounts,
  selected,
  dimmed,
  onClick,
}: {
  hotspot: NotableHotspot;
  total: number;
  datasetCounts: Map<DatasetId, number>;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        px: 1.5,
        py: 1.25,
        cursor: "pointer",
        opacity: dimmed ? 0.45 : 1,
        bgcolor: selected ? "rgba(207,227,255,0.12)" : "transparent",
        borderLeft: selected ? "2px solid #cfe3ff" : "2px solid transparent",
        "&:hover": {
          bgcolor: selected ? "rgba(207,227,255,0.18)" : "rgba(255,255,255,0.04)",
        },
        transition: "opacity 0.15s, background-color 0.15s",
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          color: "text.primary",
          fontSize: 12,
          display: "block",
          lineHeight: 1.3,
        }}
      >
        {hotspot.title}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          fontSize: 10,
          display: "block",
          mt: 0.25,
          fontStyle: "italic",
        }}
      >
        {hotspot.subtitle}
      </Typography>
      {selected && (
        <Typography
          variant="caption"
          sx={{
            color: "text.primary",
            fontSize: 10.5,
            display: "block",
            mt: 0.75,
            lineHeight: 1.5,
            opacity: 0.85,
          }}
        >
          {hotspot.narrative}
        </Typography>
      )}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
        {[...datasetCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([ds, n]) => {
            const meta = DATASETS[ds];
            if (!meta) return null;
            return (
              <Stack key={ds} direction="row" spacing={0.4} alignItems="center">
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: meta.color,
                    flexShrink: 0,
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontSize: 10 }}
                >
                  {meta.shortName} · {n}
                </Typography>
              </Stack>
            );
          })}
        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontSize: 10,
            ml: "auto",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {total} total
        </Typography>
      </Stack>
    </Box>
  );
}
