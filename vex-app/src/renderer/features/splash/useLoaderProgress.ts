/**
 * useLoaderProgress — rAF-driven 0→100% progress animation for the intro
 * splash. The progress is decorative (not tied to real bootstrap work); the
 * actual bootstrap probes run in the systemCheck view after the user clicks
 * Begin.
 *
 * Honors `prefers-reduced-motion: reduce` by jumping straight to 100 — the
 * Begin button is then visible immediately, but the user still has to click
 * (per UX decision: no auto-dismiss).
 *
 * Cleanup: `cancelAnimationFrame` in the effect return. StrictMode double-
 * invoke is safe because each mount captures its own start timestamp and
 * rafId.
 */

import { useEffect, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useLoaderProgress(durationMs: number): number {
  // Lazy initializer reads matchMedia at first render so a reduced-motion
  // user never sees the 0→100 transition — even for one paint (codex round 6
  // P2 catch). `useState(0)` → `useEffect(setProgress(100))` had a one-frame
  // race where the bar briefly rendered empty before jumping to full.
  const [progress, setProgress] = useState<number>(() =>
    prefersReducedMotion() ? 100 : 0
  );

  useEffect(() => {
    if (prefersReducedMotion()) {
      // Initial state is already 100; nothing to animate. Returning early
      // also keeps the effect cleanup a no-op for this path.
      return;
    }

    const safeDuration = durationMs > 0 ? durationMs : 1;
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const next = Math.min(100, (elapsed / safeDuration) * 100);
      setProgress(next);
      if (next < 100) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [durationMs]);

  return progress;
}
