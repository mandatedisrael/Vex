/**
 * IntroScreen — first user-facing surface on cold start.
 *
 * Single-layer layout: `intro_back.png` (16:9 anime portrait, character on
 * the left, dark space with subtle blue particles on the right) covers the
 * full viewport as background. The brand block (centered: large logo,
 * tagline) and loader + Begin button form a vertically-centered stack
 * floating over the dark right portion of the image.
 *
 * A decorative loader animates 0→100%; once it reaches 100% the Begin
 * button fades in and receives focus. Begin click is the only dismiss —
 * no auto-fallback (confirmed UX decision).
 *
 * A11y: progressbar exposes aria-valuenow; the content region is a
 * labelled landmark (`<section aria-labelledby="intro-heading">`) with
 * an sr-only `<h1>`. The visual wordmark IS the logo PNG (white outline
 * VEX letterforms in `logo_clean.png`) — no separate text wordmark.
 *
 * Reduced motion: `useLoaderProgress` jumps to 100 immediately; Begin
 * renders right away (still requires click).
 *
 * CSP: all assets self-hosted. `motion/react` is used only for one-shot
 * Begin reveal + inline `width` on the progress fill — single-property
 * style assignments allowed under `style-src 'self'`. If prod blocks a
 * path, refactor to CSS @keyframes — do NOT add `'unsafe-inline'`
 * (scripts/check-build-artifacts rejects it).
 */

import { useCallback, useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { DotmSquare3 } from "../../components/ui/dotm-square-3.js";
import { cn } from "../../lib/utils.js";
import { useLoaderProgress } from "./useLoaderProgress.js";

export interface IntroScreenProps {
  readonly onComplete: () => void;
  readonly loaderDurationMs?: number;
}

const DEFAULT_LOADER_DURATION_MS = 3500;

export function IntroScreen({
  onComplete,
  loaderDurationMs = DEFAULT_LOADER_DURATION_MS,
}: IntroScreenProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const progress = useLoaderProgress(loaderDurationMs);
  const ready = progress >= 100;
  const beginRef = useRef<HTMLButtonElement>(null);
  // Guards against rapid double-click on Begin. App.tsx setCurrentView is
  // idempotent today, but Begin is the only exit and may later gain
  // telemetry / bootstrap side effects (codex round 6 P3 hardening).
  const completedRef = useRef(false);
  // Clamp displayed percentage to 99 until `ready` flips true. Without this
  // `Math.round(99.6)` would announce "100%" while Begin is still absent —
  // a single-frame desync between the progressbar's aria-valuenow and the
  // visual CTA state.
  const progressRounded = ready ? 100 : Math.min(99, Math.round(progress));

  // Move focus to Begin once it appears so keyboard users can hit
  // Enter/Space immediately — without auto-dismiss this is the only exit.
  useEffect(() => {
    if (ready) {
      beginRef.current?.focus();
    }
  }, [ready]);

  const handleBegin = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  return (
    <div
      data-vex-onboarding="true"
      data-vex-screen="intro"
      className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
    >
      {/* BACKGROUND — full-bleed 16:9 portrait, character left, dark right */}
      <img
        src="/intro_back.png"
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      {/* Right-side gradient — gently deepens the dark area for content legibility */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[rgba(5,8,22,0.55)]"
      />
      {/* Ambient accent glow echoing the portrait's eye-light, top-right corner */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/4 h-96 w-96 rounded-full bg-[var(--intro-accent)] opacity-[0.05] blur-3xl"
      />

      {/* CONTENT — right-aligned column, vertically centered block over dark area */}
      <section
        aria-labelledby="intro-heading"
        className="relative ml-auto flex h-full w-[40%] flex-col items-center justify-center px-10 py-9"
      >
        <div className="flex w-full max-w-md flex-col items-center gap-14">
          <header className="flex flex-col items-center gap-4">
            <h1 id="intro-heading" className="sr-only">
              Vex
            </h1>
            <img
              src="/logo_clean.png"
              alt=""
              aria-hidden
              draggable={false}
              className="h-40 w-40 object-contain drop-shadow-[0_4px_24px_rgba(50,117,248,0.3)]"
            />
            <span className="font-mono text-xs uppercase tracking-[0.35em] text-[var(--color-text-secondary)]">
              AI-Powered Clarity Engine
            </span>
          </header>

          <div className="flex w-full flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-text-secondary)]">
                Initializing Vex
              </span>
              <span className="font-mono text-xs tabular-nums text-[var(--color-text-primary)]">
                {progressRounded}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={progressRounded}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Initializing Vex"
              className="h-1.5 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-inset ring-white/[0.06]"
            >
              <div
                className="h-full bg-[var(--intro-accent)] transition-[width] duration-150 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center gap-2">
              <DotmSquare3
                size={22}
                dotSize={3}
                className="text-[var(--intro-accent)] opacity-60"
                ariaLabel="Loading"
              />
              <span className="font-sans text-xs text-[var(--color-text-secondary)]">
                Loading core systems…
              </span>
            </div>
          </div>

          {/* iOS-glass Begin button — centered under the loader.
           * Press feedback: `active:scale-[0.97]` + brighter bg/border give
           * the tactile click effect the user requested. The motion fade-in
           * only runs once on reveal; the press transform is pure CSS. */}
          {ready ? (
            <motion.button
              ref={beginRef}
              type="button"
              onClick={handleBegin}
              aria-label="Begin Vex"
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reducedMotion ? 0 : 0.4,
                ease: "easeOut",
              }}
              className={cn(
                "group relative inline-flex items-center gap-3",
                "rounded-full border border-white/[0.16] bg-white/[0.07] backdrop-blur-2xl",
                "px-8 py-3.5",
                "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.2),0_10px_40px_rgba(50,117,248,0.15)]",
                "transition-all duration-300 ease-out",
                "hover:border-white/[0.22] hover:bg-white/[0.11] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(0,0,0,0.2),0_14px_50px_rgba(50,117,248,0.28)]",
                "active:scale-[0.97] active:border-white/[0.28] active:bg-white/[0.14] active:duration-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--intro-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]"
              )}
            >
              <span className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--color-text-primary)]">
                Begin
              </span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={16}
                className="text-[var(--color-text-primary)] transition-transform duration-300 group-hover:translate-x-0.5"
              />
            </motion.button>
          ) : null}
        </div>

        {/* Version pinned to the section's bottom-right corner. */}
        <footer className="absolute bottom-9 right-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
          <span>v{__VEX_APP_VERSION__}</span>
        </footer>
      </section>

      {/* HORIZONTAL TAGLINE — anchored to the bottom-left over the character */}
      <div className="pointer-events-none absolute bottom-7 left-10">
        <span className="font-mono text-[11px] uppercase tracking-[0.5em] text-[var(--color-text-muted)] [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
          Focus · Understand · Evolve
        </span>
      </div>
    </div>
  );
}
