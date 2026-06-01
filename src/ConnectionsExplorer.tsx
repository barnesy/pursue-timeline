// Connections Explorer — the corpus-wide browser over ALL 200 scored
// cross-document links (HotspotsPanel only surfaces a deduped 6). Filter by
// dataset pair / connection type / score, sort, expand any link to its
// evidence + adversarial verdict, open either document, and export the
// filtered slice as Markdown or JSON. This is the "gather/rank" surface the
// Investigation Brief workflow will build on — pure UI over precomputed data,
// no new analytics.

import { useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Slider from "@mui/material/Slider";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import HubIcon from "@mui/icons-material/Hub";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import type { Case } from "./types";
import { datasetColor, datasetShortName } from "./datasets";
import type { CorpusStats, CorpusLink } from "./corpusStats";
import { explainPair } from "./evidence";
import { EvidencePanel } from "./EvidencePanel";
import { buildHypothesis } from "./hypothesis";
import { CorpusDashboard } from "./CorpusDashboard";
import { useMobile } from "./useMobile";

type Props = {
  open: boolean;
  onClose: () => void;
  allCases: Case[];
  corpusStats: CorpusStats | null;
  onSelect: (c: Case) => void;
};

type ConnKind = "people" | "places" | "content";
function linkKind(l: CorpusLink): ConnKind {
  if (l.sharedPeople.length) return "people";
  if (l.sharedPlaces.length) return "places";
  return "content";
}
const KIND_LABEL: Record<ConnKind, string> = { people: "Shared people", places: "Shared place", content: "Content match" };

type SortKey = "score" | "verdict";

export function ConnectionsExplorer({ open, onClose, allCases, corpusStats, onSelect }: Props) {
  const fullScreen = useMobile();
  const byId = useMemo(() => new Map(allCases.map((c) => [c.id, c])), [allCases]);
  const [tab, setTab] = useState<"overview" | "links">("overview");
  const [kind, setKind] = useState<ConnKind | "all">("all");
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<SortKey>("score");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Resolve each shipped link to its cases + computed evidence/verdict. The
  // hypothesis verdict reuses the same pure functions the detail panel uses.
  const rows = useMemo(() => {
    if (!corpusStats) return [];
    const pvalOf = (c: Case) => corpusStats.uapPval[c.id];
    return corpusStats.links
      .map((l, i) => {
        const a = byId.get(l.a), b = byId.get(l.b);
        if (!a || !b) return null;
        const pval = pvalOf(a) || pvalOf(b);
        const evidence = explainPair(a, b, pval);
        const hyp = buildHypothesis(a, b, evidence, pval);
        return { id: `${i}`, link: l, a, b, evidence, hyp, kind: linkKind(l) };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);
  }, [corpusStats, byId]);

  const filtered = useMemo(() => {
    let r = rows.filter((x) => x.link.score >= minScore && (kind === "all" || x.kind === kind));
    r = [...r].sort((a, b) => (sort === "score" ? b.link.score - a.link.score : b.hyp.strength - a.hyp.strength));
    return r;
  }, [rows, kind, minScore, sort]);

  const counts = useMemo(() => {
    const c = { people: 0, places: 0, content: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);

  const exportMarkdown = () => {
    const lines = [
      `# Off Nominal — cross-document connections`,
      ``,
      `${filtered.length} connection${filtered.length === 1 ? "" : "s"} (filter: ${kind}, min score ${minScore.toFixed(2)}, sort by ${sort}).`,
      `Verdicts are computed deterministically from shared entities, distance, dates, and Monte Carlo p-values — not opinion.`,
      ``,
    ];
    for (const r of filtered) {
      lines.push(`## ${r.a.title}  ⇄  ${r.b.title}`);
      lines.push(`- Datasets: ${datasetShortName(r.a.dataset)} ↔ ${datasetShortName(r.b.dataset)}`);
      lines.push(`- Verdict: **${r.hyp.verdict.label}** (${Math.round(r.hyp.strength * 100)}/100) · score ${r.link.score.toFixed(2)}`);
      for (const e of r.evidence) lines.push(`- ${e.label}: ${e.detail}`);
      lines.push(``);
    }
    download(`off-nominal-connections.md`, lines.join("\n"), "text/markdown");
  };
  const exportJson = () => {
    const out = filtered.map((r) => ({
      a: { id: r.a.id, title: r.a.title, dataset: r.a.dataset },
      b: { id: r.b.id, title: r.b.title, dataset: r.b.dataset },
      score: r.link.score,
      verdict: r.hyp.verdict.label,
      strength: r.hyp.strength,
      evidence: r.evidence.map((e) => ({ kind: e.kind, detail: e.detail })),
    }));
    download(`off-nominal-connections.json`, JSON.stringify(out, null, 2), "application/json");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen={fullScreen}
      aria-label="Connections Explorer"
      slotProps={{ paper: { sx: fullScreen ? { bgcolor: "#0d1117" } : { bgcolor: "#0d1117", border: "1px solid rgba(255,255,255,0.12)", width: "min(960px, 96vw)", maxWidth: "96vw", height: "min(90vh, 920px)", m: 1 } } }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.25, borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
        <HubIcon fontSize="small" sx={{ color: "#cfe3ff" }} />
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>Connections Explorer</Typography>
        <Stack direction="row" spacing={0.5} sx={{ ml: 1 }}>
          {(["overview", "links"] as const).map((tb) => (
            <Chip
              key={tb}
              size="small"
              label={tb === "overview" ? "Overview" : "Links"}
              onClick={() => setTab(tb)}
              sx={{ bgcolor: tab === tb ? "rgba(122,184,255,0.18)" : "rgba(255,255,255,0.04)", color: tab === tb ? "#cfe3ff" : "text.secondary", border: `1px solid ${tab === tb ? "rgba(122,184,255,0.5)" : "rgba(255,255,255,0.1)"}`, cursor: "pointer", fontWeight: 600 }}
            />
          ))}
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        {tab === "links" && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace", mr: 0.5 }}>
              {filtered.length}/{rows.length}
            </Typography>
            <Tooltip title="Export filtered links as Markdown">
              <Button size="small" startIcon={<DownloadOutlinedIcon sx={{ fontSize: 16 }} />} onClick={exportMarkdown} sx={{ textTransform: "none", color: "text.secondary" }}>.md</Button>
            </Tooltip>
            <Tooltip title="Export filtered links as JSON">
              <Button size="small" startIcon={<DownloadOutlinedIcon sx={{ fontSize: 16 }} />} onClick={exportJson} sx={{ textTransform: "none", color: "text.secondary" }}>.json</Button>
            </Tooltip>
          </>
        )}
        <IconButton size="small" onClick={onClose} aria-label="Close"><CloseIcon fontSize="small" /></IconButton>
      </Box>

      {tab === "overview" && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto" }}>
          {corpusStats?.summary ? (
            <CorpusDashboard summary={corpusStats.summary} />
          ) : (
            <Box sx={{ display: "grid", placeItems: "center", height: "100%", color: "text.disabled" }}>
              <Typography variant="body2">Corpus summary not available.</Typography>
            </Box>
          )}
        </Box>
      )}

      {tab === "links" && (
      <>
      {/* Filter bar */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1, borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
          {(["all", "people", "places", "content"] as const).map((k) => (
            <Chip
              key={k}
              size="small"
              label={k === "all" ? `All · ${rows.length}` : `${KIND_LABEL[k as ConnKind]} · ${counts[k as ConnKind]}`}
              onClick={() => setKind(k)}
              sx={{
                bgcolor: kind === k ? "rgba(122,184,255,0.18)" : "rgba(255,255,255,0.04)",
                color: kind === k ? "#cfe3ff" : "text.secondary",
                border: `1px solid ${kind === k ? "rgba(122,184,255,0.5)" : "rgba(255,255,255,0.1)"}`,
                cursor: "pointer",
              }}
            />
          ))}
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: { xs: "100%", sm: 200 } }}>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", fontFamily: "JetBrains Mono, monospace" }}>
            min score <b style={{ color: "#e6ecf2" }}>{minScore.toFixed(2)}</b>
          </Typography>
          <Slider size="small" value={minScore} min={0} max={1.3} step={0.05} onChange={(_, v) => setMinScore(v as number)} sx={{ width: 90 }} />
        </Box>
        <Stack direction="row" spacing={0.5}>
          {(["score", "verdict"] as const).map((s) => (
            <Chip
              key={s}
              size="small"
              label={s === "score" ? "by score" : "by verdict"}
              onClick={() => setSort(s)}
              sx={{ bgcolor: sort === s ? "rgba(255,255,255,0.12)" : "transparent", color: sort === s ? "#e6ecf2" : "text.secondary", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
            />
          ))}
        </Stack>
      </Box>

      {/* Link list */}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: 1.5, py: 1 }}>
        {filtered.length === 0 ? (
          <Box sx={{ display: "grid", placeItems: "center", height: "100%", color: "text.disabled" }}>
            <Typography variant="body2">No links match these filters.</Typography>
          </Box>
        ) : (
          <Stack spacing={0.5}>
            {filtered.map((r) => {
              const isOpen = expanded === r.id;
              return (
                <Box key={r.id} sx={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 1.5, p: 1.25, bgcolor: isOpen ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : r.id)}>
                    {/* verdict ring */}
                    <Box sx={{ position: "relative", width: 30, height: 30, flexShrink: 0 }}>
                      <Box sx={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.08)" }} />
                      <Box sx={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${r.hyp.verdict.color}`, clipPath: `inset(${100 - Math.round(r.hyp.strength * 100)}% 0 0 0)` }} />
                      <Typography sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800, fontFamily: "JetBrains Mono, monospace", color: r.hyp.verdict.color }}>
                        {Math.round(r.hyp.strength * 100)}
                      </Typography>
                    </Box>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
                        <Dot c={r.a} /><Box sx={{ width: 10, borderTop: "1px dashed rgba(255,255,255,0.3)" }} /><Dot c={r.b} />
                        <Typography variant="caption" sx={{ color: r.hyp.verdict.color, fontWeight: 700, ml: 0.5 }}>{r.hyp.verdict.label}</Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Typography variant="caption" sx={{ color: "#ffb454", fontFamily: "JetBrains Mono, monospace" }}>
                          {r.link.sharedPeople[0] || r.link.sharedPlaces[0] || "content"}
                        </Typography>
                      </Box>
                      <Typography variant="body2" sx={{ lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.a.title}</Typography>
                      <Typography variant="body2" sx={{ lineHeight: 1.3, color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⇄ {r.b.title}</Typography>
                    </Box>
                  </Box>
                  {isOpen && (
                    <Box sx={{ mt: 1, pl: 5 }}>
                      <EvidencePanel items={r.evidence} dense />
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <Button size="small" variant="outlined" onClick={() => { onSelect(r.a); onClose(); }} sx={{ textTransform: "none", fontSize: 11, py: 0.25 }}>Open A</Button>
                        <Button size="small" variant="outlined" onClick={() => { onSelect(r.b); onClose(); }} sx={{ textTransform: "none", fontSize: 11, py: 0.25 }}>Open B</Button>
                      </Stack>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
      </>
      )}
    </Dialog>
  );
}

function Dot({ c }: { c: Case }) {
  return <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: datasetColor(c.dataset), flexShrink: 0 }} />;
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
