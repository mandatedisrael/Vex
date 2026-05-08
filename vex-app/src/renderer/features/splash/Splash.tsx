/**
 * Vex splash screen — first user-facing surface on cold start.
 *
 * Behavior:
 *  - Logo fades in (scale 0.85→1), then crossfades to mono variant.
 *  - Vex avatar slides in from the right with a gentle CSS @keyframes bobble
 *    loop. Bobble is CSS-only so it survives `style-src 'self'`.
 *  - "Initializing Vex…" copy + indeterminate progress strip.
 *  - Holds for `minDurationMs` (default 1500), then calls `onComplete`. The
 *    parent owns transition logic (M2+ will wait on real bootstrap probes;
 *    M1 placeholder just waits min duration).
 *  - Honors `prefers-reduced-motion: reduce` — animations skipped, content
 *    rendered at final state immediately, min duration still observed so the
 *    splash never flashes-and-disappears.
 *
 * Cleanup: every setTimeout is captured and cleared in the effect return
 * (codex YELLOW 5 — React's canonical fix for StrictMode double-invoke).
 */

import { useEffect, useState } from "react";
import { motion } from "motion/react";

export interface SplashProps {
  readonly onComplete: () => void;
  readonly minDurationMs?: number;
}

const CLEAN_LOGO_DELAY_MS = 800;
const AVATAR_DELAY_MS = 1200;
const FADE_DURATION_S = 0.6;
const SCALE_START = 0.85;
const AVATAR_OFFSET_PX = 60;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Splash({
  onComplete,
  minDurationMs = 1500,
}: SplashProps): JSX.Element {
  const [reduced] = useState(prefersReducedMotion);
  const [showCleanLogo, setShowCleanLogo] = useState(reduced);
  const [showAvatar, setShowAvatar] = useState(reduced);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (!reduced) {
      timers.push(
        setTimeout(() => setShowCleanLogo(true), CLEAN_LOGO_DELAY_MS)
      );
      timers.push(setTimeout(() => setShowAvatar(true), AVATAR_DELAY_MS));
    }

    timers.push(setTimeout(() => onComplete(), minDurationMs));

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [reduced, minDurationMs, onComplete]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-10 bg-background text-foreground"
      data-vex-screen="splash"
    >
      <div className="flex items-center gap-10">
        <div className="relative h-32 w-32">
          <motion.img
            src="/logo.png"
            alt="Vex"
            draggable={false}
            initial={reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: SCALE_START }}
            animate={
              reduced
                ? { opacity: 0, scale: 1 }
                : { opacity: showCleanLogo ? 0 : 1, scale: 1 }
            }
            transition={{ duration: reduced ? 0 : FADE_DURATION_S, ease: "easeOut" }}
            className="absolute inset-0 h-full w-full object-contain"
          />
          <motion.img
            src="/logo_clean.png"
            alt=""
            draggable={false}
            aria-hidden
            initial={reduced ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: showCleanLogo ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : FADE_DURATION_S, ease: "easeOut" }}
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>

        <motion.img
          src="/vex.jpg"
          alt="Vex avatar"
          draggable={false}
          initial={
            reduced ? { opacity: 1, x: 0 } : { opacity: 0, x: AVATAR_OFFSET_PX }
          }
          animate={{
            opacity: showAvatar ? 1 : 0,
            x: showAvatar ? 0 : AVATAR_OFFSET_PX,
          }}
          transition={{ duration: reduced ? 0 : FADE_DURATION_S, ease: "easeOut" }}
          className="h-24 w-24 rounded-full object-cover ring-2 ring-primary/40 animate-vex-bobble"
        />
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Initializing Vex…
        </p>
        <div aria-hidden className="h-1 w-32 overflow-hidden rounded-full bg-popover">
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
      </div>
    </div>
  );
}
