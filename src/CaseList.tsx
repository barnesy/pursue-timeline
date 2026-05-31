// Shared case-row used by every "pick a case" menu (map marker popover, map
// cluster popover, timeline cluster popup, the combined Cases view) so they all
// look identical:
//   ● date · agency · location          [trailing]
//     Title
//     [yield sparkline] [altitude sparkline]
//
// It's a clickable Box (not a Button) so the optional `trailing` slot can hold
// a real button (e.g. + Add Case / remove) without nesting buttons.

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Case } from "./types";
import { AGENCY_COLORS, AGENCY_SHORT } from "./theme";
import { YieldSparkline, AltitudeSparkline } from "./Sparklines";

export function CaseRow({
  kase,
  location,
  onSelect,
  trailing,
}: {
  kase: Case;
  /** Optional location label shown in the meta line (e.g. the map group's
   *  display string, or the case's incidentLocation in the timeline). */
  location?: string;
  onSelect: (c: Case) => void;
  /** Optional right-aligned control (e.g. <AddToCasesButton/> or a remove ✕). */
  trailing?: React.ReactNode;
}) {
  const color = AGENCY_COLORS[kase.agency] || "#7ab8ff";
  const meta = [kase.incidentDateRaw || "undated", AGENCY_SHORT[kase.agency] || kase.agency, location]
    .filter(Boolean)
    .join(" · ");
  const showSparks =
    typeof kase.yieldKt === "number" || (kase.dataset === "nuclear-test" && !!(kase.subtype || kase.type));
  return (
    <Box
      onClick={() => onSelect(kase)}
      role="button"
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 0.75,
        px: 1,
        py: 0.5,
        borderRadius: 1,
        cursor: "pointer",
        width: "100%",
        boxSizing: "border-box",
        "&:hover": { bgcolor: "rgba(255,255,255,0.04)" },
      }}
    >
      <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: color, mt: 0.75, flexShrink: 0 }} />
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flexGrow: 1, minWidth: 0 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9.5 }}
        >
          {meta}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3, fontSize: 12 }}>
          {kase.title.length > 80 ? kase.title.slice(0, 80) + "…" : kase.title}
        </Typography>
        {showSparks && (
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mt: 0.5, flexWrap: "wrap", rowGap: 0.5 }}>
            {typeof kase.yieldKt === "number" && <YieldSparkline kt={kase.yieldKt} ktUpper={kase.yieldKtUpper} />}
            {kase.dataset === "nuclear-test" && (
              <AltitudeSparkline altM={kase.altitudeM} typeStr={kase.subtype || kase.type || ""} />
            )}
          </Stack>
        )}
      </Box>
      {trailing && <Box sx={{ flexShrink: 0, alignSelf: "center" }}>{trailing}</Box>}
    </Box>
  );
}
