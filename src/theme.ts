import { createTheme } from "@mui/material/styles";

export const AGENCY_COLORS: Record<string, string> = {
  // UAP dataset — US agencies
  "Department of War": "#7ab8ff",
  "FBI": "#ffd166",
  "NASA": "#ef476f",
  "Department of State": "#06d6a0",
  "Department of Energy": "#c084fc",
  "Central Intelligence Agency": "#ff8a3d",
  "Office of the Director of National Intelligence": "#9aa5b1",

  // Nuclear tests — conducting nations (blue/red/gold family for cold-war
  // contrast; deliberately distinct from UAP-agency palette).
  "United States": "#5fa8d3",
  "Soviet Union": "#e63946",
  "France": "#a8dadc",
  "United Kingdom": "#b08cff",
  "China": "#fcbf49",
  "India": "#f77f00",
  "Pakistan": "#4caf50",
  "North Korea": "#8d99ae",

  // Nuclear incidents — additional nations beyond the test list
  Canada: "#ff6b6b",
  Japan: "#ec4899",
  Brazil: "#10b981",
  Russia: "#dc2626",
};

export const AGENCY_SHORT: Record<string, string> = {
  // UAP
  "Department of War": "Dept. of War",
  "FBI": "FBI",
  "NASA": "NASA",
  "Department of State": "State Dept.",
  "Department of Energy": "DOE",
  "Central Intelligence Agency": "CIA",
  "Office of the Director of National Intelligence": "ODNI",
  // Nations — already short enough, but normalize a couple
  "United States": "USA",
  "Soviet Union": "USSR",
  "United Kingdom": "UK",
  "North Korea": "DPRK",
};

export const TYPE_COLORS: Record<string, string> = {
  PDF: "#7ab8ff",
  VID: "#ef476f",
  IMG: "#ffd166",
  AUD: "#06d6a0",
};

export const TYPE_LABELS: Record<string, string> = {
  PDF: "Document",
  VID: "Video",
  IMG: "Image",
  AUD: "Audio",
};

export const theme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#0a0d12",
      paper: "#11161e",
    },
    primary: { main: "#7ab8ff" },
    secondary: { main: "#ef476f" },
    text: {
      primary: "#e6ecf2",
      secondary: "#a3aebd",
    },
    divider: "rgba(255,255,255,0.08)",
  },
  typography: {
    fontFamily: "Inter, system-ui, sans-serif",
    h1: { fontWeight: 700, letterSpacing: "-0.02em" },
    h2: { fontWeight: 700, letterSpacing: "-0.02em" },
    h3: { fontWeight: 600, letterSpacing: "-0.01em" },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: "rgba(10,13,18,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: "none",
          backgroundColor: "#11161e",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
        },
      },
    },
  },
});
