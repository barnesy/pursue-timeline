// Shared mobile-breakpoint hook — true below the md breakpoint. Used to make
// the full-screen Dialog overlays go edge-to-edge (fullScreen) on phones,
// matching the app's existing isMobile pattern in App.tsx.

import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

export function useMobile(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("md"));
}
