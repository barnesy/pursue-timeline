// FLAGSHIP — the Investigation Brief. Turns the current Cases collection into a
// formal, citable briefing: synopsis, methodology, the connections that
// survive the skeptic, the ones dismissed as coincidence, statistically
// notable cases, and a methods/limitations footer. Save it (localStorage),
// share it (URL hash), or print-to-PDF (browser-native, vector text).
//
// Every claim is assembled from a computed fact (buildBrief), so the brief is
// deterministic and carries the anti-pareidolia framing into the exported PDF.

import { useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Snackbar from "@mui/material/Snackbar";
import CloseIcon from "@mui/icons-material/Close";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import ShareOutlinedIcon from "@mui/icons-material/ShareOutlined";
import type { Case } from "./types";
import type { CorpusStats } from "./corpusStats";
import { buildBrief, type BriefPair } from "./brief";
import { EvidencePanel } from "./EvidencePanel";
import { datasetColor } from "./datasets";
import { investigationsStore, encodeInvestigation } from "./investigations";
import { useMobile } from "./useMobile";

export function InvestigationBrief({
  open, onClose, cases, corpusStats, onSelect,
}: {
  open: boolean;
  onClose: () => void;
  cases: Case[];
  corpusStats: CorpusStats | null;
  onSelect: (c: Case) => void;
}) {
  const fullScreen = useMobile();
  const [title, setTitle] = useState("Untitled investigation");
  const [toast, setToast] = useState<string | null>(null);
  const brief = useMemo(() => buildBrief(title, cases, corpusStats), [title, cases, corpusStats]);

  const doSave = () => {
    investigationsStore.save({ id: `inv-${cases.length}-${title.slice(0, 12)}-${cases.map((c) => c.id).join("").length}`, title, caseIds: cases.map((c) => c.id), savedAt: new Date().toISOString() });
    setToast("Investigation saved locally");
  };
  const doShare = async () => {
    const url = `${location.origin}${location.pathname}#${encodeInvestigation(title, cases.map((c) => c.id))}`;
    try { await navigator.clipboard.writeText(url); setToast("Share link copied to clipboard"); }
    catch { setToast("Copy failed — link is in the address bar"); location.hash = encodeInvestigation(title, cases.map((c) => c.id)); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen={fullScreen}
      aria-label="Investigation Brief"
      slotProps={{ paper: { sx: fullScreen ? { bgcolor: "#0d1117" } : { bgcolor: "#0d1117", border: "1px solid rgba(255,255,255,0.12)", width: "min(820px, 96vw)", maxWidth: "96vw", height: "min(92vh, 1000px)", m: 1 } } }}
    >
      {/* Toolbar (not printed) */}
      <Box className="brief-toolbar" sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25, borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15, flexShrink: 0 }}>Investigation Brief</Typography>
        <TextField
          size="small" variant="standard" value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Investigation title"
          sx={{ flexGrow: 1, mx: 1, "& input": { fontSize: 14 } }}
        />
        <Tooltip title="Save to this browser"><Button size="small" startIcon={<SaveOutlinedIcon sx={{ fontSize: 16 }} />} onClick={doSave} sx={{ textTransform: "none", color: "text.secondary" }}>Save</Button></Tooltip>
        <Tooltip title="Copy a shareable link"><Button size="small" startIcon={<ShareOutlinedIcon sx={{ fontSize: 16 }} />} onClick={doShare} sx={{ textTransform: "none", color: "text.secondary" }}>Share</Button></Tooltip>
        <Tooltip title="Print or save as PDF"><Button size="small" variant="outlined" startIcon={<PrintOutlinedIcon sx={{ fontSize: 16 }} />} onClick={() => window.print()} sx={{ textTransform: "none" }}>PDF</Button></Tooltip>
        <IconButton size="small" onClick={onClose} aria-label="Close"><CloseIcon fontSize="small" /></IconButton>
      </Box>

      {/* The brief body — this is what prints */}
      <Box id="brief-print-root" sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: { xs: 2, md: 4 }, py: 3 }}>
        {cases.length === 0 ? (
          <Box sx={{ display: "grid", placeItems: "center", height: "100%", color: "text.disabled", textAlign: "center" }}>
            <Box>
              <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No cases collected</Typography>
              <Typography variant="body2">Add cases (＋ Add Case) to assemble a briefing.</Typography>
            </Box>
          </Box>
        ) : (
          <>
            <Typography variant="caption" sx={{ color: "text.secondary", letterSpacing: "0.1em", textTransform: "capitalize", fontWeight: 700 }}>
              Off Nominal · Investigation Brief
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 24, lineHeight: 1.2, mt: 0.5 }}>{title}</Typography>
            <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: "JetBrains Mono, monospace" }}>
              {brief.cases.length} documents · {brief.datasets.length} datasets{brief.yearSpan ? ` · ${brief.yearSpan[0]}–${brief.yearSpan[1]}` : ""}
            </Typography>

            <Section title="Synopsis">
              <Typography variant="body2" sx={{ lineHeight: 1.6 }}>{brief.summaryLine}</Typography>
            </Section>

            {brief.significant.length > 0 && (
              <Section title="Statistically notable">
                <Stack spacing={0.75}>
                  {brief.significant.map(({ c, p, days }) => (
                    <Box key={c.id} className="brief-row" sx={{ cursor: "pointer" }} onClick={() => onSelect(c)}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.title}</Typography>
                      <Typography variant="caption" sx={{ color: p < 0.05 ? "#e8413a" : "#f0a13a", fontFamily: "JetBrains Mono, monospace" }}>
                        p = {p.toFixed(p < 0.01 ? 4 : 3)} · nearest test {days === 0 ? "same day" : `${days.toLocaleString()} days`} — {p < 0.05 ? "unlikely to be chance" : "weakly unusual"}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Section>
            )}

            {brief.surviving.length > 0 && (
              <Section title={`Connections that survive scrutiny (${brief.surviving.length})`}>
                <Stack spacing={1.5}>{brief.surviving.map((p, i) => <PairBlock key={i} pair={p} onSelect={onSelect} />)}</Stack>
              </Section>
            )}

            {brief.dismissed.length > 0 && (
              <Section title={`Examined and dismissed as coincidence (${brief.dismissed.length})`}>
                <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 1 }}>
                  Listed for completeness — the skeptic found these explainable by chance given the corpus baseline.
                </Typography>
                <Stack spacing={0.5}>
                  {brief.dismissed.map((p, i) => (
                    <Box key={i} className="brief-row">
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {p.a.title} <span style={{ color: "#7a8595" }}>⇄</span> {p.b.title}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "#7a8595", fontFamily: "JetBrains Mono, monospace" }}>
                        {p.hyp.verdict.label} ({Math.round(p.hyp.strength * 100)}/100)
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Section>
            )}

            <Section title="Documents in this investigation">
              <Stack spacing={0.4}>
                {brief.cases.map((c) => (
                  <Box key={c.id} className="brief-row" sx={{ display: "flex", gap: 1, alignItems: "center", cursor: "pointer" }} onClick={() => onSelect(c)}>
                    <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: datasetColor(c.dataset), flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>{c.title}</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: "JetBrains Mono, monospace", flexShrink: 0 }}>{c.incidentDateRaw || ""}</Typography>
                  </Box>
                ))}
              </Stack>
            </Section>

            <Section title="Methods & limitations">
              <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.6, display: "block" }}>
                Connections are scored from shared named entities (people, places), geographic and temporal proximity, and TF-IDF content similarity. Verdicts are produced by a deterministic adversarial test that weights documentary links (shared people/places) above signals coincidence can fake (timing, shared vocabulary). Statistical significance is a Monte Carlo p-value: how often a random date in the nuclear-testing era would fall as close to a test as the observed case. {corpusStats?.summary ? `Across the full corpus, ${corpusStats.summary.pval.coincidental} of ${corpusStats.summary.pval.n} UAP cases tested are coincidental and only ${corpusStats.summary.pval.significant} are significant — proximity to a test is usually the default, not a signal.` : ""} No generative AI was used; every statement is assembled from these computed values and is reproducible.
              </Typography>
            </Section>
          </>
        )}
      </Box>

      <Snackbar open={!!toast} autoHideDuration={2600} onClose={() => setToast(null)} message={toast || ""} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} />
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 2.5 }} className="brief-section">
      <Typography sx={{ fontWeight: 700, fontSize: 13, textTransform: "capitalize", letterSpacing: "0.06em", color: "#cfe3ff", mb: 1, pb: 0.5, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function PairBlock({ pair, onSelect }: { pair: BriefPair; onSelect: (c: Case) => void }) {
  return (
    <Box className="brief-row" sx={{ p: 1.25, borderRadius: 1.5, border: "1px solid rgba(255,255,255,0.08)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: datasetColor(pair.a.dataset) }} />
        <Typography variant="body2" sx={{ fontWeight: 600, cursor: "pointer" }} onClick={() => onSelect(pair.a)}>{pair.a.title}</Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: datasetColor(pair.b.dataset) }} />
        <Typography variant="body2" sx={{ fontWeight: 600, cursor: "pointer" }} onClick={() => onSelect(pair.b)}>{pair.b.title}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" sx={{ color: pair.hyp.verdict.color, fontWeight: 700, flexShrink: 0 }}>
          {pair.hyp.verdict.label} · {Math.round(pair.hyp.strength * 100)}/100
        </Typography>
      </Box>
      <EvidencePanel items={pair.evidence} dense />
    </Box>
  );
}
