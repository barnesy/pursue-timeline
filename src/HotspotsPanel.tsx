// Standalone Hotspots panel — extracted from the MapView absolute-positioned
// overlay so it can live in its own resizable pane.
//
// Click an entry to focus (filters both map + timeline to that hotspot's
// case set). Click again to clear. Selection highlight + narrative expansion
// mirror the previous in-map overlay behavior 1-for-1.

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import HubIcon from "@mui/icons-material/Hub";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import type { Case } from "./types";
import { DATASETS, type DatasetId } from "./datasets";
import { NOTABLE_HOTSPOTS, type NotableHotspot } from "./notableHotspots";

type Props = {
  /** Full case set (un-focused) — so totals don't shrink when a hotspot is
   *  focused, which would make the panel feel like it's collapsing under you. */
  allCases: Case[];
  focusedHotspot: NotableHotspot | null;
  onFocusChange: (h: NotableHotspot | null) => void;
  /** When provided, the header renders a collapse button that calls this. */
  onCollapse?: () => void;
};

export function HotspotsPanel({ allCases, focusedHotspot, onFocusChange, onCollapse }: Props) {
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
            textTransform: "uppercase",
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
