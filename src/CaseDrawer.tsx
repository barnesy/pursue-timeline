import { useMemo, useState } from "react";
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
import FunctionsIcon from "@mui/icons-material/Functions";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import Tooltip from "@mui/material/Tooltip";
import type { Case } from "./types";
import { AGENCY_COLORS, AGENCY_SHORT, TYPE_COLORS, TYPE_LABELS } from "./theme";
import { DATASETS } from "./datasets";
import { findNearby, formatDaysDelta } from "./proximity";
import { isTrackedPublication, findReferencingDocs, findReferencedPublications } from "./publications";
import type { EntityIndex, Entity } from "./entities";
import { type CorpusStats, significanceLabel } from "./corpusStats";
import { explainPair } from "./evidence";
import { EvidencePanel } from "./EvidencePanel";
import { buildHypothesis } from "./hypothesis";
import { HypothesisCard } from "./HypothesisCard";
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
  /** Cross-dataset entity registry + a callback to open an entity's panel
   *  (used by the "Key figures" / "Authors" chips). */
  entityIndex?: EntityIndex;
  onEntity?: (entityId: string) => void;
  /** Build-time corpus analytics (similar docs, p-values). */
  corpusStats?: CorpusStats | null;
};

const DVIDS_VIDEO_URL = (id: string) => `https://www.dvidshub.net/video/${id}`;

export function CasePanel({ kase, allCases, onSelect, onClose, onCollapse, entityIndex, onEntity, corpusStats }: Props) {
  // Compute cross-dataset proximity once per (focused case, all-cases) tuple.
  const nearby = useMemo(
    () => findNearby(kase, allCases, { maxKm: 500, maxYears: 5, limit: 10 }),
    [kase, allCases],
  );
  const units = useUnits();
  const byId = useMemo(() => new Map(allCases.map((c) => [c.id, c])), [allCases]);
  // TF-IDF content-similar documents (build-time), resolved to cases.
  const similar = useMemo(() => {
    const raw = corpusStats?.similar[kase.id] || [];
    return raw.map((s) => ({ ...s, case: byId.get(s.id) })).filter((s) => s.case) as { id: string; score: number; cross: boolean; case: Case }[];
  }, [corpusStats, kase.id, byId]);
  // Monte Carlo significance for UAP↔nuclear-test proximity, if applicable.
  const pval = corpusStats?.uapPval[kase.id];
  // Which related row has its "why connected?" evidence expanded.
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  // The cross-dataset relation currently under adversarial hypothesis test.
  const [hypoCase, setHypoCase] = useState<Case | null>(null);
  // Published-work ↔ document citation cross-references (the "call out").
  const referencingDocs = useMemo(
    () => (isTrackedPublication(kase.id) ? findReferencingDocs(kase.id, allCases) : []),
    [kase.id, allCases],
  );
  const referencedPubs = useMemo(
    () => findReferencedPublications(kase, allCases),
    [kase, allCases],
  );
  // People/authors this record connects to in the cross-dataset registry.
  const entities = entityIndex ? entityIndex.forCase(kase) : [];
  const people = entities.filter((e) => e.type === "person");
  const places = entities.filter((e) => e.type === "place");
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
                  sx={{ textTransform: "capitalize", letterSpacing: "0.08em" }}
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

          {/* Network connections — people/authors and places; click opens the
              entity panel showing everywhere that entity appears. */}
          {onEntity && (people.length > 0 || places.length > 0) && (
            <>
              <Divider sx={{ my: 1 }} />
              {people.length > 0 && (
                <Box sx={{ mb: places.length > 0 ? 1.25 : 0 }}>
                  <EntityChipRow
                    label={kase.dataset === "publication" ? "Authors" : "Key figures"}
                    entities={people}
                    onEntity={onEntity}
                    color="154,165,177"
                  />
                </Box>
              )}
              {places.length > 0 && (
                <Box>
                  <EntityChipRow label="Places" entities={places} onEntity={onEntity} color="122,167,214" />
                </Box>
              )}
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.75 }}>
                Click to see everywhere it appears across the datasets.
              </Typography>
            </>
          )}

          {/* Statistical-significance badge for UAP↔nuclear-test proximity.
              The honesty layer: most UAP-near-a-test coincidences are expected
              given the dense test calendar, and we say so. */}
          {pval && (() => {
            const sig = significanceLabel(pval.p);
            return (
              <>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <FunctionsIcon fontSize="small" sx={{ color: sig.color }} />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} alignItems="baseline">
                      <Typography variant="caption" sx={{ color: sig.color, fontWeight: 700 }}>
                        {sig.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
                        p = {pval.p.toFixed(pval.p < 0.01 ? 4 : 3)}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.disabled" sx={{ display: "block", lineHeight: 1.35 }}>
                      Nearest nuclear test {pval.nearestTestDays === 0 ? "same day" : `${pval.nearestTestDays.toLocaleString()} days away`} ·{" "}
                      {sig.tier === "expected"
                        ? "this proximity is unremarkable given how often tests fired."
                        : "this proximity is tighter than chance would predict."}
                    </Typography>
                  </Box>
                </Box>
              </>
            );
          })()}

          {/* Content-similar documents (TF-IDF). The "what it's about" axis the
              entity/place network can't see — cross-dataset matches are bridges. */}
          {similar.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize", letterSpacing: "0.08em" }}>
                    Similar documents
                  </Typography>
                </Stack>
                <Stack spacing={0.5}>
                  {similar.map((s) => {
                    const meta = DATASETS[s.case.dataset];
                    return (
                      <Box
                        key={s.id}
                        onClick={() => onSelect(s.case)}
                        sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.6, borderRadius: 1, cursor: "pointer", "&:hover": { bgcolor: "rgba(255,255,255,0.04)" } }}
                      >
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: meta.color, flexShrink: 0 }} />
                        <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                          {s.case.title}
                        </Typography>
                        {s.cross && (
                          <Typography variant="caption" sx={{ color: "#c084fc", fontWeight: 700, flexShrink: 0 }}>
                            bridge
                          </Typography>
                        )}
                        <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: "JetBrains Mono, monospace", flexShrink: 0 }}>
                          {Math.round(s.score * 100)}%
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
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
                    sx={{ textTransform: "capitalize", letterSpacing: "0.08em" }}
                  >
                    Cross-dataset · within {fmtDistance(500_000, units)} · ± 5 years
                  </Typography>
                </Stack>
                <Stack spacing={0.5}>
                  {nearby.map((n) => {
                    const meta = DATASETS[n.case.dataset];
                    const evid = openEvidence === n.case.id ? explainPair(kase, n.case, pval) : [];
                    return (
                      <Box key={n.case.id} sx={{ px: 1, py: 0.75, borderRadius: 1, "&:hover": { bgcolor: "rgba(255,255,255,0.04)" } }}>
                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", cursor: "pointer" }} onClick={() => onSelect(n.case)}>
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
                        <Box sx={{ display: "flex", gap: 1.5, mt: 0.4 }}>
                          <Box
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setOpenEvidence(openEvidence === n.case.id ? null : n.case.id); }}
                            sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, cursor: "pointer", color: openEvidence === n.case.id ? "#cfe3ff" : "text.disabled", "&:hover": { color: "#cfe3ff" } }}
                          >
                            <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600 }}>
                              {openEvidence === n.case.id ? "Hide evidence" : "Why connected?"}
                            </Typography>
                          </Box>
                          <Box
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setHypoCase(n.case); }}
                            sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, cursor: "pointer", color: "text.disabled", "&:hover": { color: "#cfe3ff" } }}
                          >
                            <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600 }}>
                              ⚖ Test this connection
                            </Typography>
                          </Box>
                        </Box>
                        {evid.length > 0 && (
                          <Box sx={{ mt: 0.6, pl: 1, borderLeft: "2px solid rgba(255,255,255,0.1)" }}>
                            <EvidencePanel items={evid} dense />
                          </Box>
                        )}
                      </Box>
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
                    sx={{ textTransform: "capitalize", letterSpacing: "0.08em" }}
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
                  sx={{ textTransform: "capitalize", letterSpacing: "0.08em", display: "block", mb: 1 }}
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

      {hypoCase && (
        <HypothesisCard
          hyp={buildHypothesis(kase, hypoCase, explainPair(kase, hypoCase, pval), pval)}
          onClose={() => setHypoCase(null)}
        />
      )}
    </Box>
  );
}

// A labeled row of clickable entity chips (people or places). `color` is an
// "r,g,b" triplet so people and places read distinctly.
function EntityChipRow({
  label,
  entities,
  onEntity,
  color,
}: {
  label: string;
  entities: Entity[];
  onEntity: (id: string) => void;
  color: string;
}) {
  return (
    <>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "capitalize", letterSpacing: "0.08em", display: "block", mb: 1 }}
      >
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
        {entities.map((e) => (
          <Chip
            key={e.id}
            size="small"
            label={e.caseIds.length > 1 ? `${e.name} · ${e.caseIds.length}` : e.name}
            onClick={() => onEntity(e.id)}
            sx={{
              bgcolor: `rgba(${color},0.14)`,
              color: "#e6ecf2",
              border: `1px solid rgba(${color},0.4)`,
              cursor: "pointer",
              maxWidth: "100%",
              "&:hover": { bgcolor: `rgba(${color},0.24)` },
            }}
          />
        ))}
      </Stack>
    </>
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
          textTransform: "capitalize",
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
