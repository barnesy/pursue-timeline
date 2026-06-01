// Error boundary — the only React feature still requiring a class. Without it,
// any render-time throw (a malformed record, an unexpected dataset id, a bad
// date) unmounts the whole tree and leaves a blank page. We wrap the app AND
// each overlay, so an overlay crash is recoverable (close + reopen) rather than
// fatal to the whole timeline.

import { Component, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";

type Props = { children: ReactNode; fallback?: ReactNode; label?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error) {
    // Surface in the console; no telemetry (privacy-respecting research tool).
    console.error("[off-nominal] render error:", error);
  }
  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <Box
        role="alert"
        sx={{
          display: "grid",
          placeItems: "center",
          height: "100%",
          minHeight: 200,
          p: 4,
          textAlign: "center",
          color: "text.secondary",
        }}
      >
        <Box sx={{ maxWidth: 420 }}>
          <Typography sx={{ fontWeight: 700, color: "text.primary", mb: 0.5 }}>
            {this.props.label ? `${this.props.label} hit an error` : "Something went wrong"}
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            This view failed to render. The rest of the app is unaffected — try again, or reload the page.
          </Typography>
          <Typography variant="caption" sx={{ display: "block", mb: 2, fontFamily: "JetBrains Mono, monospace", color: "text.disabled", wordBreak: "break-word" }}>
            {this.state.error.message}
          </Typography>
          <Button size="small" variant="outlined" onClick={this.reset}>Try again</Button>
        </Box>
      </Box>
    );
  }
}
