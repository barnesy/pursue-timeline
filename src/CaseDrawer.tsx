import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import HubIcon from "@mui/icons-material/Hub";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import Tooltip from "@mui/material/Tooltip";
import type { Case } from "./types";
import { AGENCY_COLORS, AGENCY_SHORT, TYPE_COLORS, TYPE_LABELS } from "./theme";
import { DATASETS } from "./datasets";
import { findNearby, formatDaysDelta } from "./proximity";
import { isTrackedPublication, findReferencingDocs, findReferencedPublications } from "./publications";
import { fmtDistance, type UnitSystem } from "./blastPhysics";
import { useUnits } from "./units";
import { BlastDiagram } from "./BlastDiagram";
import { YieldSparkline, AltitudeSparkline } from "./Sparklines";
import { AddToCasesButton } from "./AddToCasesButton";

type Props = {
  kase: Case;
  allCases: Case[];
  onSelect: (c: Case) => void;
  onClose: () => void;
  /** When provided, the header renders a collapse button (in addition to
   *  the close X) that calls this instead of clearing the selection. */
  onCollapse?: () => void;
};

const DVIDS_VIDEO_URL = (id: string) => `https://www.dvidshub.net/video/${id}`;

export function CasePanel({ kase, allCases, onSelect, onClose, onCollapse }: Props) {
  // Compute cross-dataset proximity once per (focused case, all-cases) tuple.
  const nearby = useMemo(
    () => findNearby(kase, allCases, { maxKm: 500, maxYears: 5, limit: 10 }),
    [kase, allCases],
  );
  const units = useUnits();
  // Published-work ↔ document citation cross-references (the "call out").
  const referencingDocs = useMemo(
    () => (isTrackedPublication(kase.id) ? findReferencingDocs(kase.id, allCases) : []),
    [kase.id, allCases],
  );
  const referencedPubs = useMemo(
    () => findReferencedPublications(kase, allCases),
    [kase, allCases],
  );
  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <Box
        sx={{
          p: 2.5,
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }} useFlexGap flexWrap="wrap">
            <Chip
              size="small"
              label={kase.agency}
              sx={{
                bgcolor: AGENCY_COLORS[kase.agency] || "#7ab8ff",
                color: "#0a0d12",
                fontWeight: 600,
              }}
            />
            {kase.type && (
              <Chip
                size="small"
                label={TYPE_LABELS[kase.type] || kase.type}
                sx={{
                  bgcolor: "transparent",
                  color: TYPE_COLORS[kase.type] || "#9aa5b1",
                  border: `1px solid ${TYPE_COLORS[kase.type] || "#9aa5b1"}`,
                  fontWeight: 600,
                }}
              />
            )}
            {kase.subtype && (
              <Chip
                size="small"
                label={kase.subtype.toLowerCase().replace(/_/g, " ")}
                sx={{
                  bgcolor: "rgba(255,255,255,0.04)",
                  color: "text.secondary",
                  border: "1px solid rgba(255,255,255,0.1)",
                  fontWeight: 500,
                }}
              />
            )}
            {kase.redacted && (
              <Chip
                size="small"
                label="Redacted"
                sx={{ bgcolor: "rgba(239,71,111,0.18)", color: "#ef476f" }}
              />
            )}
          </Stack>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
            {kase.title}
          </Typography>
          <Box sx={{ mt: 1.5 }}>
            <AddToCasesButton kase={kase} variant="full" />
          </Box>
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ ml: 1 }}>
          {onCollapse && (
            <Tooltip title="Collapse panel">
              <IconButton
                onClick={onCollapse}
                size="small"
                aria-label="Collapse panel"
                sx={{ color: "text.secondary" }}
              >
                <KeyboardDoubleArrowRightIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Close (deselect)">
            <IconButton onClick={onClose} size="small" aria-label="Close panel">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      <Box sx={{ p: 2.5, overflowY: "auto", flexGrow: 1 }}>
        <Stack spacing={2}>
          <MetaRow label="Incident date" value={kase.incidentDateRaw || "—"} />
          <MetaRow label="Location" value={kase.incidentLocation || "—"} />
          <MetaRow label="Release" value={kase.releaseDate || "—"} />
          {typeof kase.yieldKt === "number" && (
            <MetaRow
              label="Yield"
              value={
                kase.yieldKtUpper && kase.yieldKtUpper !== kase.yieldKt
                  ? `${fmtYield(kase.yieldKt)}–${fmtYield(kase.yieldKtUpper)}`
                  : fmtYield(kase.yieldKt)
              }
            />
          )}
          {typeof kase.altitudeM === "number" && (
            <MetaRow label="Altitude" value={fmtAltitude(kase.altitudeM, units)} />
          )}

          {(kase.dataset === "nuclear-test" || kase.dataset === "nuclear-incident") && (
            <BlastDiagram kase={kase} />
          )}

          {kase.description && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                >
                  Description
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ mt: 0.75, whiteSpace: "pre-wrap", lineHeight: 1.55 }}
                >
                  {kase.description}
                </Typography>
              </Box>
            </>
          )}

          {nearby.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <HubIcon fontSize="small" sx={{ color: "text.secondary" }} />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                  >
                    Cross-dataset · within {fmtDistance(500_000, units)} · ± 5 years
                  </Typography>
                </Stack>
                <Stack spacing={0.5}>
                  {nearby.map((n) => {
                    const meta = DATASETS[n.case.dataset];
                    return (
                      <Button
                        key={n.case.id}
                        variant="text"
                        onClick={() => onSelect(n.case)}
                        sx={{
                          justifyContent: "flex-start",
                          textAlign: "left",
                          px: 1,
                          py: 0.75,
                          textTransform: "none",
                          color: "text.primary",
                          "&:hover": { bgcolor: "rgba(255,255,255,0.04)" },
                        }}
                      >
                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%" }}>
                          <Stack
                            direction="row"
                            spacing={0.75}
                            alignItems="center"
                            sx={{ mb: 0.25 }}
                          >
                            <Box
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                bgcolor: meta.color,
                              }}
                            />
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontFamily: "JetBrains Mono, monospace" }}
                            >
                              {n.case.incidentDateRaw || "—"} ·{" "}
                              {AGENCY_SHORT[n.case.agency] || n.case.agency} ·{" "}
                              <span style={{ color: "#cfe3ff" }}>
                                {fmtDistance(n.km * 1000, units)}
                              </span>
                              {" · "}
                              {formatDaysDelta(n.daysDelta)}
                            </Typography>
                          </Stack>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 500, lineHeight: 1.3 }}
                          >
                            {n.case.title.length > 90
                              ? n.case.title.slice(0, 90) + "…"
                              : n.case.title}
                          </Typography>
                          {(typeof n.case.yieldKt === "number" ||
                            (n.case.dataset === "nuclear-test" &&
                              (n.case.subtype || n.case.type))) && (
                            <Stack
                              direction="row"
                              spacing={1.25}
                              alignItems="center"
                              sx={{ mt: 0.5, flexWrap: "wrap", rowGap: 0.5 }}
                            >
                              {typeof n.case.yieldKt === "number" && (
                                <YieldSparkline
                                  kt={n.case.yieldKt}
                                  ktUpper={n.case.yieldKtUpper}
                                />
                              )}
                              {n.case.dataset === "nuclear-test" && (
                                <AltitudeSparkline
                                  altM={n.case.altitudeM}
                                  typeStr={n.case.subtype || n.case.type || ""}
                                />
                              )}
                            </Stack>
                          )}
                        </Box>
                      </Button>
                    );
                  })}
                </Stack>
              </Box>
            </>
          )}

          {/* Citations — STARGATE documents that reference this published work */}
          {referencingDocs.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <HubIcon fontSize="small" sx={{ color: "text.secondary" }} />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                  >
                    Referenced in {referencingDocs.length} declassified file{referencingDocs.length === 1 ? "" : "s"}
                  </Typography>
                </Stack>
                <Stack spacing={0.5}>
                  {referencingDocs.map((d) => (
                    <Button
                      key={d.id}
                      variant="text"
                      onClick={() => onSelect(d)}
                      sx={{
                        justifyContent: "flex-start",
                        textAlign: "left",
                        px: 1,
                        py: 0.75,
                        textTransform: "none",
                        color: "text.primary",
                        "&:hover": { bgcolor: "rgba(255,255,255,0.04)" },
                      }}
                    >
                      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%" }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: "JetBrains Mono, monospace" }}
                        >
                          {DATASETS[d.dataset]?.shortName || d.dataset}
                          {d.incidentDateRaw ? ` · ${d.incidentDateRaw}` : ""}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3 }}>
                          {d.title.length > 90 ? d.title.slice(0, 90) + "…" : d.title}
                        </Typography>
                      </Box>
                    </Button>
                  ))}
                </Stack>
              </Box>
            </>
          )}

          {/* Reciprocal — published works this document appears to cite */}
          {referencedPubs.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ textTransform: "uppercase", letterSpacing: "0.08em", display: "block", mb: 1 }}
                >
                  References published work{referencedPubs.length === 1 ? "" : "s"}
                </Typography>
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
                  {referencedPubs.map((p) => (
                    <Chip
                      key={p.id}
                      size="small"
                      label={p.title.length > 48 ? p.title.slice(0, 48) + "…" : p.title}
                      onClick={() => onSelect(p)}
                      sx={{
                        bgcolor: "rgba(52,211,153,0.12)",
                        color: "#6ee7b7",
                        border: "1px solid rgba(52,211,153,0.4)",
                        cursor: "pointer",
                        maxWidth: "100%",
                        "&:hover": { bgcolor: "rgba(52,211,153,0.2)" },
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      </Box>

      <Box
        sx={{
          p: 2.5,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {kase.sourceUrl && (
          <Button
            variant="contained"
            endIcon={<OpenInNewIcon />}
            href={kase.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            fullWidth
          >
            Open source{" "}
            {kase.type === "VID"
              ? "video"
              : kase.type === "AUD"
                ? "audio"
                : kase.type === "IMG"
                  ? "image"
                  : "PDF"}
          </Button>
        )}
        {kase.dvidsVideoId && (
          <Button
            variant="outlined"
            endIcon={<OpenInNewIcon />}
            href={DVIDS_VIDEO_URL(kase.dvidsVideoId)}
            target="_blank"
            rel="noopener noreferrer"
            fullWidth
          >
            View on DVIDS
          </Button>
        )}
        {!kase.sourceUrl && !kase.dvidsVideoId && (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
            No source link for this case.
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function fmtYield(kt: number): string {
  if (kt === 0) return "<1 kt";
  if (kt >= 1000) return `${(kt / 1000).toFixed(kt >= 10_000 ? 0 : 1)} Mt`;
  return `${kt < 1 ? kt.toFixed(2) : kt.toString()} kt`;
}

function fmtAltitude(m: number, units: UnitSystem): string {
  if (m === 0) return units === "imperial" ? "0 ft · surface" : "0 m · surface";
  const dist = fmtDistance(Math.abs(m), units);
  return m > 0 ? `+${dist} above ground` : `−${dist} underground`;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", gap: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          minWidth: 110,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          pt: 0.25,
        }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {value}
      </Typography>
    </Box>
  );
}
