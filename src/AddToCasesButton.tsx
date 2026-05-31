// The "+ Add Case" / "✓ Added" toggle. Lives on case rows (compact) and the
// detail drawer (full). Toggling updates the shared Cases store, which the
// header counter and combined view read from.

import Button from "@mui/material/Button";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import type { Case } from "./types";
import { casesStore, useInCases } from "./collection";

export function AddToCasesButton({
  kase,
  variant = "chip",
}: {
  kase: Case;
  variant?: "chip" | "full";
}) {
  const added = useInCases(kase.id);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    casesStore.toggle(kase.id);
  };

  if (variant === "full") {
    return (
      <Button
        onClick={toggle}
        size="small"
        variant={added ? "outlined" : "contained"}
        startIcon={added ? <CheckIcon /> : <AddIcon />}
        sx={{
          textTransform: "none",
          fontWeight: 700,
          ...(added
            ? { color: "#86efac", borderColor: "rgba(52,211,153,0.5)", "&:hover": { borderColor: "#86efac" } }
            : {}),
        }}
      >
        {added ? "Added" : "Add Case"}
      </Button>
    );
  }

  // Compact chip for case rows.
  return (
    <Button
      onClick={toggle}
      size="small"
      variant="text"
      startIcon={added ? <CheckIcon sx={{ fontSize: 14 }} /> : <AddIcon sx={{ fontSize: 14 }} />}
      sx={{
        minWidth: 0,
        px: 0.75,
        py: 0.25,
        fontSize: 11,
        flexShrink: 0,
        textTransform: "none",
        color: added ? "#86efac" : "#cfe3ff",
        "& .MuiButton-startIcon": { mr: 0.4 },
      }}
    >
      {added ? "Added" : "Add"}
    </Button>
  );
}
