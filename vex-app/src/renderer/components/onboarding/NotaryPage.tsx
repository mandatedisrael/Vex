/**
 * NotaryPage — shared scaffold for onboarding screens in the Countersign /
 * NOTARY visual language ("pages of the same signed document").
 *
 * Renders the full-screen near-black canvas (--vex-onboarding-bg), the
 * document column (shared geometry — same width as the intro's plinth),
 * the settled signature hallmark (no glow: the glow belonged to the act
 * of signing), the brand overline, the mono title line with an optional
 * STEP XX / YY counter, the subline, and the corner chrome (brand tetrad
 * bottom-left, version bottom-right). Screen content renders as children
 * below the subline.
 *
 * Chrome discipline: everything this scaffold renders stands at final
 * opacity from frame one — entrances are hard cuts; only screen content
 * (ledger rows, stamps, keys) animates, and only via stylesheet
 * @keyframes (CSP `style-src 'self'`).
 *
 * The caller's screen id lands on data-vex-screen (stable e2e/test
 * selector) and data-vex-onboarding stays "true" so the shared accent
 * token chain in globals.css applies.
 */

import { type ReactNode } from "react";

import { cn } from "../../lib/utils.js";
import { ONBOARDING_COLUMN_CLASS } from "./geometry.js";

interface NotaryPageProps {
  /** Value for data-vex-screen (stable e2e/test selector). */
  readonly screen: string;
  /** id of the rendered h1, used as the section's accessible name. */
  readonly headingId: string;
  /** Mono microtype title — rendered uppercase via CSS. */
  readonly title: string;
  readonly subline: string;
  /** Optional STEP XX / YY counter on the title line (sr-only keeps the
   * literal "Step X of Y" wording for assistive tech). */
  readonly stepNumber?: number;
  readonly totalSteps?: number;
  readonly children: ReactNode;
}

export function NotaryPage({
  screen,
  headingId,
  title,
  subline,
  stepNumber,
  totalSteps,
  children,
}: NotaryPageProps): JSX.Element {
  return (
    <div
      data-vex-onboarding="true"
      data-vex-screen={screen}
      className="relative h-screen w-screen overflow-hidden bg-[var(--vex-onboarding-bg)] text-[var(--color-text-primary)]"
    >
      {/* PRINT TEXTURE — the landing's machine artifacts at whisper
       * opacity: vertical scanlines + fractal grain on the canvas only
       * (paint layers, never over body text at more than a whisper). */}
      <div aria-hidden className="vex-scanlines absolute inset-0" />
      <div aria-hidden className="vex-noise absolute inset-0" />

      <section
        aria-labelledby={headingId}
        className={cn(
          "relative mx-auto flex h-full flex-col justify-center",
          ONBOARDING_COLUMN_CLASS,
        )}
      >
        {/* LETTERHEAD — the signature the user watched being written. */}
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="mx-auto h-12 w-12 object-contain opacity-90"
        />
        <span className="vex-eyebrow mt-3 self-center">
          Enforce AI Trades · Prove Every Action
        </span>

        {/* TITLE LINE — mono microtype continues the intro's voice. */}
        <div className="mt-5 flex items-baseline justify-between">
          <h1
            id={headingId}
            className="font-mono text-[13px] font-medium uppercase tracking-[0.3em] text-[var(--color-text-primary)]"
          >
            {title}
          </h1>
          {stepNumber != null && totalSteps != null ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
              <span className="sr-only">
                Step {stepNumber} of {totalSteps}
              </span>
              <span aria-hidden className="tabular-nums">
                Step {String(stepNumber).padStart(2, "0")} /{" "}
                {String(totalSteps).padStart(2, "0")}
              </span>
            </span>
          ) : null}
        </div>
        <p className="mt-2 font-sans text-xs text-[var(--color-text-secondary)]">
          {subline}
        </p>

        {children}
      </section>

      {/* VIEWPORT CHROME — identical voice and position on every page. */}
      <div className="pointer-events-none absolute bottom-7 left-10 flex flex-col gap-2 text-[var(--color-text-muted)]">
        <span className="font-mono text-[10px] uppercase tracking-[0.4em] opacity-60">
          Models Reason · Runtimes Enforce · Chains Prove
        </span>
      </div>
      <footer className="absolute bottom-7 right-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)] opacity-60">
        <span>v{__VEX_APP_VERSION__}</span>
      </footer>
    </div>
  );
}
