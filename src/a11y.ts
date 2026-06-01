// Accessibility helper: makes a clickable non-button element (e.g. a styled
// <Box onClick>) keyboard-operable. Spread onto the element to get role,
// focusability, and Enter/Space activation. The global :focus-visible ring
// (index.html) then makes focus visible.

import type { KeyboardEvent } from "react";

export function clickable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
