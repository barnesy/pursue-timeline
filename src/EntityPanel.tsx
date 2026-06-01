// Entity detail overlay — click a person chip anywhere and see every record
// that references them, grouped by dataset. The cross-dataset reveal: a
// STARGATE figure who also authored a published work shows both here.

import { useMemo } from "react";
import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import type { Case } from "./types";
import type { Entity } from "./entities";
import { DATASETS, DATASET_IDS, type DatasetId } from "./datasets";
import { CaseRow } from "./CaseList";

export function EntityPanel({
  entity,
  allCases,
  onSelect,
  onClose,
}: {
  entity: Entity;
  allCases: Case[];
  onSelect: (c: Case) => void;
  onClose: () => void;
}) {
  const byId = useMemo(() => new Map(allCases.map((c) => [c.id, c])), [allCases]);

  const groups = useMemo(() => {
    const cases = entity.caseIds
      .map((id) => byId.get(id))
      .filter((c): c is Case => !!c);
    const byDataset = new Map<DatasetId, Case[]>();
    for (const c of cases) {
      const arr = byDataset.get(c.dataset) || [];
      arr.push(c);
      byDataset.set(c.dataset, arr);
    }
    for (const arr of byDataset.values())
      arr.sort((a, b) => (a.incidentDate || "9999").localeCompare(b.incidentDate || "9999"));
    return DATASET_IDS.filter((id) => byDataset.has(id)).map((id) => ({
      id,
      meta: DATASETS[id],
      cases: byDataset.get(id)!,
    }));
  }, [entity, byId]);

  const total = groups.reduce((n, g) => n + g.cases.length, 0);

  // Active span across all referencing records (years), for quick context.
  const span = useMemo(() => {
    const years = groups
      .flatMap((g) => g.cases)
      .map((c) => (c.incidentDate ? new Date(c.incidentDate).getUTCFullYear() : null))
      .filter((y): y is number => y != null);
    if (!years.length) return null;
    const lo = Math.min(...years), hi = Math.max(...years);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  }, [groups]);

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            bgcolor: "#0d1117",
            border: "1px solid rgba(255,255,255,0.12)",
            width: "min(560px, 94vw)",
            maxWidth: "94vw",
            height: "min(78vh, 760px)",
            m: 1,
          },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 2,
          py: 1.5,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {entity.type === "place" ? (
          <PlaceOutlinedIcon sx={{ color: "text.secondary" }} />
        ) : (
          <PersonOutlineIcon sx={{ color: "text.secondary" }} />
        )}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2 }}>{entity.name}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
            {entity.type} · {total} record{total === 1 ? "" : "s"} across {groups.length} dataset
            {groups.length === 1 ? "" : "s"}
            {span ? ` · ${span}` : ""}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Per-dataset connection groups */}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: 1.5, py: 1 }}>
        {groups.map((g) => (
          <Box key={g.id} sx={{ mb: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.5, mb: 0.5 }}>
              <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: g.meta.color }} />
              <Typography
                variant="caption"
                sx={{ textTransform: "uppercase", letterSpacing: "0.08em", color: g.meta.color, fontWeight: 700 }}
              >
                {g.meta.shortName} · {g.cases.length}
              </Typography>
            </Stack>
            <Stack spacing={0.5}>
              {g.cases.map((c) => (
                <CaseRow
                  key={c.id}
                  kase={c}
                  location={c.incidentLocation || undefined}
                  onSelect={(x) => { onSelect(x); onClose(); }}
                />
              ))}
            </Stack>
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}
