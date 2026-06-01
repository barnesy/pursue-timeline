// Renders the "why are these connected?" evidence list for a pair of cases —
// each item a labeled strength bar with concrete detail. Trust through
// transparency: the user sees exactly what the engine saw.

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import StraightenOutlinedIcon from "@mui/icons-material/StraightenOutlined";
import TagOutlinedIcon from "@mui/icons-material/TagOutlined";
import FunctionsOutlinedIcon from "@mui/icons-material/FunctionsOutlined";
import type { EvidenceItem } from "./evidence";

const ICONS: Record<EvidenceItem["kind"], typeof TagOutlinedIcon> = {
  people: GroupsOutlinedIcon,
  places: PlaceOutlinedIcon,
  time: ScheduleOutlinedIcon,
  distance: StraightenOutlinedIcon,
  keywords: TagOutlinedIcon,
  significance: FunctionsOutlinedIcon,
};
const COLORS: Record<EvidenceItem["kind"], string> = {
  people: "#9aa5b1",
  places: "#7aa7d6",
  time: "#f0c93c",
  distance: "#5fc3b5",
  keywords: "#c084fc",
  significance: "#e8893a",
};

export function EvidencePanel({ items, dense }: { items: EvidenceItem[]; dense?: boolean }) {
  if (!items.length) return null;
  return (
    <Stack spacing={dense ? 0.6 : 0.9}>
      {items.map((it, i) => {
        const Icon = ICONS[it.kind];
        const color = COLORS[it.kind];
        return (
          <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <Icon sx={{ fontSize: 15, color, mt: 0.2, flexShrink: 0 }} />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75 }}>
                <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700, textTransform: "capitalize", letterSpacing: "0.05em", fontSize: 9.5 }}>
                  {it.label}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.primary", flexGrow: 1, minWidth: 0 }}>
                  {it.detail}
                </Typography>
              </Box>
              <Box sx={{ mt: 0.35, height: 3, borderRadius: 2, bgcolor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <Box sx={{ height: "100%", width: `${Math.round(Math.max(0.04, it.strength) * 100)}%`, bgcolor: color, opacity: 0.85 }} />
              </Box>
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
