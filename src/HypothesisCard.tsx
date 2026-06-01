// Adversarial hypothesis dialog — states a connection as a claim, argues both
// sides (the case FOR vs. a skeptic's grounded rebuttal), and renders a
// verdict. The point is to teach the user to interrogate a correlation rather
// than trust it.

import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
import type { Hypothesis } from "./hypothesis";

export function HypothesisCard({ hyp, onClose }: { hyp: Hypothesis; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={false}
      slotProps={{ paper: { sx: { bgcolor: "#0d1117", border: "1px solid rgba(255,255,255,0.12)", width: "min(560px, 94vw)", maxWidth: "94vw", m: 1 } } }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25, px: 2.5, py: 1.75, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <BalanceOutlinedIcon sx={{ color: "#cfe3ff", mt: 0.3 }} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "capitalize", letterSpacing: "0.1em", fontWeight: 700, fontSize: 10 }}>
            Hypothesis test
          </Typography>
          <Typography sx={{ fontWeight: 700, lineHeight: 1.3, mt: 0.25 }}>{hyp.claim}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close"><CloseIcon fontSize="small" /></IconButton>
      </Box>

      <Box sx={{ px: 2.5, py: 2 }}>
        {/* Verdict banner */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, p: 1.25, mb: 2, borderRadius: 1.5, border: `1px solid ${hyp.verdict.color}55`, bgcolor: `${hyp.verdict.color}14` }}>
          <Box sx={{ position: "relative", width: 38, height: 38, flexShrink: 0 }}>
            <Box sx={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.08)" }} />
            <Box sx={{ position: "absolute", inset: 0, borderRadius: "50%", border: `3px solid ${hyp.verdict.color}`, clipPath: `inset(${100 - Math.round(hyp.strength * 100)}% 0 0 0)` }} />
            <Typography sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, fontFamily: "JetBrains Mono, monospace", color: hyp.verdict.color }}>
              {Math.round(hyp.strength * 100)}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, color: hyp.verdict.color }}>{hyp.verdict.label}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>{hyp.verdict.rationale}</Typography>
          </Box>
        </Box>

        {/* The case FOR */}
        <Section icon={<CheckCircleOutlineIcon sx={{ fontSize: 17, color: "#34d399" }} />} title="The case for a connection" color="#34d399">
          {hyp.forPoints.length ? hyp.forPoints : ["No positive signal beyond co-existence in the corpus."]}
        </Section>

        {/* The skeptic */}
        <Box sx={{ mt: 2 }}>
          <Section icon={<GavelOutlinedIcon sx={{ fontSize: 17, color: "#e8893a" }} />} title="The skeptic's rebuttal" color="#e8893a">
            {hyp.against.length ? hyp.against : ["The skeptic finds little to object to — the hard links hold up."]}
          </Section>
        </Box>

        <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 2, fontStyle: "italic", lineHeight: 1.4 }}>
          This verdict is computed deterministically from the shared entities, distances, dates, and the Monte Carlo p-value — not an opinion. It weights documentary links (shared people/places) above signals coincidence can fake (timing, shared words).
        </Typography>
      </Box>
    </Dialog>
  );
}

function Section({ icon, title, color, children }: { icon: React.ReactNode; title: string; color: string; children: string[] }) {
  return (
    <Box>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
        {icon}
        <Typography variant="caption" sx={{ color, fontWeight: 700, textTransform: "capitalize", letterSpacing: "0.06em" }}>
          {title}
        </Typography>
      </Stack>
      <Stack spacing={0.75} sx={{ pl: 0.5 }}>
        {children.map((p, i) => (
          <Box key={i} sx={{ display: "flex", gap: 0.75 }}>
            <Box sx={{ color, mt: 0.1, flexShrink: 0 }}>·</Box>
            <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.45 }}>{p}</Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
