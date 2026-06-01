// Corpus overview dashboard — the "methods & limitations" view. Surfaces the
// aggregate numbers build-corpus-stats already computes, with the p-value
// histogram as the centerpiece: it SHOWS, in one chart, that most UAP↔nuclear
// proximities are statistically expected (high p) and only a couple are
// surprising. That's the honesty layer made legible. Pure render of
// corpus-stats.json summary — no computation.

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { CorpusSummary } from "./corpusStats";
import { DATASETS, type DatasetId } from "./datasets";
import { PLACES } from "./places";

const PLACE_NAME = new Map(PLACES.map((p) => [p.id, p.name]));

export function CorpusDashboard({ summary }: { summary: CorpusSummary }) {
  const maxBin = Math.max(1, ...summary.pval.histogram);
  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      {/* Headline cards */}
      <Stack direction="row" spacing={1.25} sx={{ flexWrap: "wrap", rowGap: 1.25, mb: 2 }}>
        <Card big label="Documents" value={summary.totalDocs.toLocaleString()} sub={`${summary.yearRange[0]}–${summary.yearRange[1]} · ${summary.datedDocs.toLocaleString()} dated`} />
        <Card big label="Scored links" value="200" sub={`${summary.linkByKind.people} people · ${summary.linkByKind.places} place · ${summary.linkByKind.content} content`} />
        <Card big label="UAP↔test tested" value={String(summary.pval.n)} sub={`median p = ${summary.pval.median}`} />
      </Stack>

      {/* The honesty headline: p-value distribution */}
      <Box sx={{ mb: 2, p: 1.5, borderRadius: 1.5, border: "1px solid rgba(255,255,255,0.08)", bgcolor: "rgba(255,255,255,0.02)" }}>
        <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, fontSize: 10 }}>
          Are UAP sightings unusually close to nuclear tests?
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, mb: 1.5, lineHeight: 1.45 }}>
          For each UAP case, a Monte Carlo test asks how often a random date would land as close to a nuclear test. High p = the closeness is <b style={{ color: "#7a8595" }}>expected</b> given how often tests fired; low p = <b style={{ color: "#e8413a" }}>surprising</b>. The verdict: <b style={{ color: "#e6ecf2" }}>{summary.pval.coincidental} of {summary.pval.n} are coincidental</b>, only <b style={{ color: "#f0a13a" }}>{summary.pval.significant} are significant</b>.
        </Typography>
        {/* histogram */}
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5, height: 90 }}>
          {summary.pval.histogram.map((n, i) => {
            const frac = n / maxBin;
            // color ramp: left bins (low p, surprising) red → right (expected) gray
            const color = i <= 0 ? "#e8413a" : i <= 1 ? "#f0a13a" : i <= 3 ? "#c9b03a" : "#7a8595";
            return (
              <Box key={i} sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
                <Typography sx={{ fontSize: 9, color: "text.disabled", fontFamily: "JetBrains Mono, monospace" }}>{n || ""}</Typography>
                <Box sx={{ width: "100%", height: `${Math.max(2, frac * 70)}px`, bgcolor: color, opacity: 0.85, borderRadius: 0.5 }} />
                <Typography sx={{ fontSize: 8, color: "text.disabled", fontFamily: "JetBrains Mono, monospace" }}>{(i / 10).toFixed(1)}</Typography>
              </Box>
            );
          })}
        </Box>
        <Typography sx={{ fontSize: 9, color: "text.disabled", textAlign: "center", mt: 0.5 }}>p-value (significant ← → coincidental)</Typography>
      </Box>

      {/* Two columns: dataset composition + dataset-pair links */}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <SectionLabel>Corpus composition</SectionLabel>
          <Stack spacing={0.6} sx={{ mt: 1 }}>
            {Object.entries(summary.perDataset).sort((a, b) => b[1] - a[1]).map(([ds, n]) => {
              const meta = DATASETS[ds as DatasetId];
              const frac = n / summary.totalDocs;
              return (
                <Box key={ds} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="caption" sx={{ width: 110, color: meta?.color || "#9aa5b1", flexShrink: 0 }}>{meta?.shortName || ds}</Typography>
                  <Box sx={{ flexGrow: 1, height: 8, borderRadius: 1, bgcolor: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <Box sx={{ height: "100%", width: `${frac * 100}%`, bgcolor: meta?.color || "#9aa5b1", opacity: 0.8 }} />
                  </Box>
                  <Typography variant="caption" sx={{ width: 44, textAlign: "right", color: "text.secondary", fontFamily: "JetBrains Mono, monospace" }}>{n.toLocaleString()}</Typography>
                </Box>
              );
            })}
          </Stack>
        </Box>
        <Box sx={{ flex: 1 }}>
          <SectionLabel>Cross-dataset link pairs</SectionLabel>
          <Stack spacing={0.6} sx={{ mt: 1 }}>
            {Object.entries(summary.pairCounts).sort((a, b) => b[1] - a[1]).map(([pair, n]) => (
              <Box key={pair} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="caption" sx={{ flexGrow: 1, color: "text.secondary" }}>{pair}</Typography>
                <Typography variant="caption" sx={{ color: "#ffb454", fontFamily: "JetBrains Mono, monospace" }}>{n}</Typography>
              </Box>
            ))}
          </Stack>
          <SectionLabel sx={{ mt: 2 }}>Top connectors</SectionLabel>
          <Stack spacing={0.4} sx={{ mt: 1 }}>
            {summary.topEntities.slice(0, 8).map((e) => (
              <Box key={e.type + e.name} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="caption" sx={{ flexGrow: 1, color: "text.primary" }}>
                  {e.type === "place" ? (PLACE_NAME.get(e.name) || e.name) : e.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: "JetBrains Mono, monospace" }}>{e.docs} · {e.datasets}ds</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}

function Card({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <Box sx={{ flex: big ? "1 1 160px" : "0 0 auto", p: 1.5, borderRadius: 1.5, border: "1px solid rgba(255,255,255,0.08)", bgcolor: "rgba(255,255,255,0.02)", minWidth: 150 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9.5 }}>{label}</Typography>
      <Typography sx={{ fontWeight: 800, fontSize: 26, lineHeight: 1.1, fontFamily: "JetBrains Mono, monospace" }}>{value}</Typography>
      {sub && <Typography variant="caption" sx={{ color: "text.disabled" }}>{sub}</Typography>}
    </Box>
  );
}

function SectionLabel({ children, sx }: { children: React.ReactNode; sx?: object }) {
  return (
    <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, fontSize: 10, ...sx }}>
      {children}
    </Typography>
  );
}
