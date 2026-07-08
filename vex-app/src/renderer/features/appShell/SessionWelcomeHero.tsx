/**
 * Welcome stage — the landing hero (projectvex.ai), recomposed CENTERED over
 * the Signal Sky (phase 5), crowned by the VEX SIGIL (phase 6).
 *
 * The stage carries TWO wows: the procedural WebGL dither sky a sibling
 * component mounts BEHIND the session panel, and the particle-constellation
 * monogram (`VexSigil`) that conjures itself at the top of the hero column —
 * the ONLY imagery this component contributes (the quips are standalone
 * text now; no inline <img> in the status line). It contributes exactly
 * three layers; the absolute ones resolve against the panel's relative
 * frame (`SessionPanel` sets it):
 *
 *   1. VIGNETTE (absolute, decorative): ONE soft bottom gradient to ink
 *      (rgba of --vex-surface-0) so the instrument and chips stay legible
 *      over the sky's brightest flecks.
 *   2. HERO COLUMN (in flow; `mt-auto` bottom-anchors it inside the parent's
 *      flex-1 zone, directly above the docked composer): the landing
 *      .hero-inner grammar — the sigil as the crown, then the centered mono
 *      status line with the live dot carrying the TaglineRotator (standalone
 *      mono-uppercase brand quips), then the H1 as the only display
 *      statement, wearing the landing barcode flicker (.vex-title-barcode),
 *      then a static PREVIEW · v{version} pill (honest build-stage
 *      disclosure, tooltip-only detail via a plain `title` attribute).
 *      The H1 "What should I execute?" is test-pinned: a REAL heading with
 *      this exact copy. Nothing else renders above the composer.
 *   3. BOTTOM BAND (absolute at the stage's bottom edge — the parent's
 *      trailing spacer keeps this band clear): the INTEGRATIONS RAIL
 *      (protocol coins + chain coverage, `WelcomeIntegrationsRail`) stacked
 *      over the landing .hero-bottom runtime row — barcode strip +
 *      LOCAL-FIRST CAPITAL RUNTIME left, BACKED BY center, YOU SIGN EVERY
 *      ACTION right. The only other copy on the stage.
 *
 * Load-in: the one-shot .vex-rise choreography, shifted one step for the
 * crown (sigil → d1 status → d2 H1 → d3 preview pill; the parent stages
 * the instrument at d2 and its own chips row at d3 on SIBLING elements
 * outside this component; the bottom row here closes at d4). Mount-once —
 * the choreography classes on the sigil, H1, pill and the bottom row never
 * re-toggle on re-render; the rotator's phrase swap remounts ONLY its own
 * phrase span (keyed) so each quip replays the same one-shot rise without
 * new keyframes (CSP-safe).
 * Pure presentation: no session state, no composer coupling.
 */

import { useEffect, useState, type JSX } from "react";
import { useUiStore } from "../../stores/uiStore.js";
import {
  ROBINHOOD_SIGIL_PALETTE,
  ROBINHOOD_SIGIL_SRC,
  VexSigil,
} from "./VexSigil.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { WelcomeIntegrationsRail } from "./WelcomeIntegrationsRail.js";

/** ~4.2s per quip — long enough to read, short enough to feel alive. */
const TAGLINE_ROTATE_MS = 4200;

/** Shared sigil sizing — kept stable across the theme branches so the crown
 * occupies the same box whether it samples the monogram or the feather. */
const SIGIL_CLASS = "vex-rise mx-auto mb-5 h-28 md:h-32";

/**
 * Standalone brand quips for the status line — mono-uppercase text ONLY
 * (the monogram lives above as the VexSigil constellation; the old
 * img-in-text mechanism is retired). Order is user-pinned; the CSS
 * uppercases the rendering, so source casing stays natural.
 */
const TAGLINES: readonly string[] = [
  "Signed. Sealed. Executed.",
  "Your rules. My moves.",
  "Propose. Enforce. Prove.",
  "The desk is open.",
  "VEX is listening.",
];

/** jsdom-safe read — mirrors useLoaderProgress / SignalSky. */
function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Rotating tagline — decorative flavor only. The animated line is
 * aria-hidden (rotation would spam screen readers); a visually-hidden
 * sibling carries the stable "Vex is ready." announcement instead. The
 * phrase span is keyed by index so each swap remounts it and replays the
 * one-shot .vex-rise (no new keyframes; CSP style-src 'self' safe).
 *
 * Reduced motion: the preference is read ONCE at first render (lazy
 * initializer, same trade-off as useLoaderProgress — mid-session preference
 * flips are not tracked) and the interval never starts; the first phrase
 * renders statically. Rotation also pauses while the document is hidden
 * (visibilitychange) so a backgrounded window schedules no work.
 */
function TaglineRotator(): JSX.Element {
  const [staticOnly] = useState(prefersReducedMotion);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (staticOnly) {
      return undefined;
    }

    let intervalId: number | null = null;
    const stop = (): void => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const start = (): void => {
      if (intervalId === null) {
        intervalId = window.setInterval(() => {
          setIndex((current) => (current + 1) % TAGLINES.length);
        }, TAGLINE_ROTATE_MS);
      }
    };
    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    if (!document.hidden) {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [staticOnly]);

  return (
    <>
      {/* key={index}: remount per swap replays the one-shot rise. Inline
       * flow (inline-block) keeps the quip on the eyebrow's baseline next
       * to the live dot. */}
      <span
        key={index}
        aria-hidden
        className="vex-rise inline-block whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--vex-text-2)]"
      >
        {TAGLINES[index]}
      </span>
      <span className="sr-only">Vex is ready.</span>
    </>
  );
}

export function SessionWelcomeHero(): JSX.Element {
  // Robinhood mode swaps the sigil's sampled source + spark palette; the
  // `key={theme}` REMOUNTS VexSigil on a flip so its one-shot particle
  // assembly replays into the new mark (the component reads src/palette only
  // at mount — see VexSigil).
  const theme = useUiStore((s) => s.theme);
  return (
    <>
      {/* VIGNETTE — the single gradient layer on the stage: melts the sky
       * into ink at the bottom so the composer group always reads. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-[linear-gradient(180deg,transparent_0%,rgba(10,13,24,0.42)_52%,rgba(10,13,24,0.88)_100%)]"
      />

      {/* HERO COLUMN — the landing .hero-inner, centered. `mt-auto`
       * bottom-anchors it in the parent's flex-1 zone so it sits directly
       * above the docked composer; the parent's trailing spacer balances
       * the column so hero + instrument center vertically as one group. */}
      <div className="relative z-10 mt-auto flex w-full flex-col items-center px-8 pb-4 text-center">
        {/* THE SIGIL — the particle-constellation mark, the hero's crown.
         * Takes the base .vex-rise slot; the status line and H1 shift one
         * stagger step so the choreography reads sigil → tagline → H1. In
         * Robinhood mode it samples the feather with a neon-lime palette. */}
        {theme === "robinhood" ? (
          <VexSigil
            key={theme}
            className={SIGIL_CLASS}
            src={ROBINHOOD_SIGIL_SRC}
            palette={ROBINHOOD_SIGIL_PALETTE}
          />
        ) : (
          <VexSigil key={theme} className={SIGIL_CLASS} />
        )}
        <span className="vex-eyebrow vex-rise vex-rise-d1">
          {/* Live dot — STATIC accent ink: no runtime state reaches this
           * component and .vex-pulse-dot stays reserved for verifiable
           * live/pending states. */}
          <span
            aria-hidden
            className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--vex-accent)]"
          />
          <TaglineRotator />
        </span>
        {/* H1 — the only display statement on the stage. Pinned by shell
         * tests: stays a REAL heading with this exact copy. */}
        <h1 className="vex-title-barcode vex-rise vex-rise-d2 mt-6 text-center font-display text-[clamp(44px,6vw,72px)] font-black leading-[0.95] tracking-[-0.025em] text-[var(--vex-text)]">
          What should I execute?
        </h1>
        {/* PREVIEW BADGE — honest build-stage disclosure, closing the crown's
         * choreography at d3 (sigil → d1 status → d2 H1 → d3 badge; the
         * bottom row closes at d4). Static pill mirroring the version-stamp
         * grammar (BookPanel's collapse header, the welcome bottom-band
         * stamps below): mono uppercase text on a hairline pill, no glass,
         * no glow — CSP style-src 'self' safe (no inline styles). */}
        <span
          className="vex-rise vex-rise-d3 mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--vex-line-strong)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--vex-text-3)]"
          title={`Preview build (v${__VEX_APP_VERSION__}). Vex is pre-1.0 and evolving. Self-custodial — you control your keys and every action. Verify before moving funds. Not financial advice.`}
          aria-label={`PREVIEW · v${__VEX_APP_VERSION__}`}
        >
          PREVIEW · v{__VEX_APP_VERSION__}
        </span>
      </div>

      {/* BOTTOM BAND — the landing .hero-bottom at the stage's bottom edge,
       * now TWO stacked lines closing the load-in together:
       *   1. the INTEGRATIONS RAIL (protocol coins + chain coverage) — the
       *      execution-surface evidence line;
       *   2. the runtime row: barcode + LOCAL-FIRST left, BACKED BY hallmark
       *      (Virtuals + Robinhood marks) with the mode toggle center,
       *      YOU SIGN EVERY ACTION right.
       * The band stays click-transparent (pointer-events-none); ONLY the
       * toggle and the rail restore pointer-events on themselves. */}
      <div className="vex-rise vex-rise-d4 pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3.5 px-8 pb-5 sm:px-12">
        <WelcomeIntegrationsRail />

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <span className="flex min-w-0 items-center gap-3 font-mono text-[9px] uppercase tracking-[0.3em] text-[var(--vex-text-3)]">
            <span
              aria-hidden
              className="vex-barcode h-3 w-24 shrink-0 opacity-40"
            />
            <span className="truncate">LOCAL-FIRST CAPITAL RUNTIME</span>
          </span>

          {/* BACKED BY — the partner hallmark, enlarged (~1.75x) but still
           * quiet: monochrome marks at opacity-70, comfortable spacing, then
           * the mode switch. A hallmark, not a billboard. */}
          <div className="flex items-center justify-center gap-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--vex-text-3)]">
              Backed by
            </span>
            <span className="flex items-center gap-4">
              <img
                src="/logo/virtuals.svg"
                alt="Virtuals"
                className="h-7 w-7 opacity-70"
              />
              <img
                src="/logo/robinhood.svg"
                alt="Robinhood"
                className="h-7 w-7 opacity-70"
              />
            </span>
            <ThemeToggle />
          </div>

          <span className="justify-self-end shrink-0 font-mono text-[9px] uppercase tracking-[0.3em] text-[var(--vex-text-3)]">
            YOU SIGN EVERY ACTION
          </span>
        </div>
      </div>
    </>
  );
}
