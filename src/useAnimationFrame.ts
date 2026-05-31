// requestAnimationFrame-based animation hook. Drives a smooth time variable
// (in seconds) at the display refresh rate as long as `playing` is true.
// Respects `prefers-reduced-motion` by skipping animation entirely when the
// OS-level setting is on (caller can ignore and force-play anyway).

import { useEffect, useRef } from "react";

export type AnimationTickFn = (deltaSeconds: number) => void;

export function useAnimationFrame(
  playing: boolean,
  speed: number,
  onTick: AnimationTickFn,
): void {
  // Stash latest onTick so we don't restart the rAF loop on every render
  // when the callback identity changes.
  const tickRef = useRef(onTick);
  useEffect(() => {
    tickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let lastT: number | null = null;
    function loop(t: number) {
      if (lastT !== null) {
        const dt = (t - lastT) / 1000; // seconds
        // Clamp to avoid huge jumps after the tab was backgrounded
        const dtClamped = Math.min(dt, 0.1);
        tickRef.current(dtClamped * speed);
      }
      lastT = t;
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);
}

// Returns true if the user has prefers-reduced-motion set at the OS level.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
