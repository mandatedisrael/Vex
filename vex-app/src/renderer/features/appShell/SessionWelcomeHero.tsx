/**
 * Welcome stage — the Grok-style LOGO ROW crown (owner decree 2026-07-21).
 *
 * The H1 "What should I execute?" display statement is DELETED. What remains
 * above the composer is ONE centered logo row borrowing Grok's home
 * [icon + wordmark] grammar:
 *
 *   - the VexSigil particle-constellation mark (falls back to the clean
 *     monogram <img> in jsdom / on canvas failure), sized to the Grok icon
 *     slot rather than the old full-crown height;
 *   - beside it, the PREVIEW · v{version} badge redesigned as a wordmark-
 *     position hallmark: White House face (Instrument Sans), letterspaced
 *     caps, SOLID text wearing the `.vex-preview-shimmer` overlay
 *     (globals.css — an ::after duplicate via data-shimmer-text sweeps a
 *     translucent white band over the glyphs on a slow ~3.2s loop; the base
 *     text is never background-clipped; stilled under reduced motion). The
 *     honest build-stage tooltip carries over from the retired pill via a
 *     plain `title` attribute.
 *
 * The parent (`SessionPanel`) seats this crown directly above the composer
 * and centers [logo row + input + chips] vertically as one column — the
 * Grok home composition. This component no longer bottom-anchors itself
 * (the old `mt-auto` is gone); it is plain flow content plus one absolute
 * band:
 *
 *   BOTTOM BAND (absolute at the stage's bottom edge — the parent's
 *   trailing spacer keeps this band clear): ONLY the centered BACKED BY
 *   hallmark (unchanged by the 2026-07-21 logo-row round). The only other
 *   copy on the stage.
 *
 * Load-in: the one-shot .vex-rise choreography — the logo row takes the
 * base slot as one unit; the parent stages the instrument at d2 and the
 * chips row at d3 on SIBLING elements outside this component; the bottom
 * band closes at d4. Mount-once: no class re-toggles on re-render.
 * Pure presentation: no session state, no composer coupling.
 */

import type { JSX } from "react";
import { VexSigil } from "./VexSigil.js";

/** Sigil sizing — the crown mark ABOVE the PREVIEW wordmark (owner decree
 * 2026-07-21 round 2: "logo VEX musi być nad preview i ma być w chuj
 * większe" — the side-by-side Grok row shrank it to badge scale). */
const SIGIL_CLASS = "h-36 md:h-44";

/** The wordmark-slot text — also the badge's accessible name. */
const PREVIEW_LABEL = `PREVIEW · v${__VEX_APP_VERSION__}`;

/** Honest build-stage disclosure, carried over from the retired pill. */
const PREVIEW_TITLE =
  `Preview build (v${__VEX_APP_VERSION__}). Vex is pre-1.0 and evolving. ` +
  "Self-custodial — you control your keys and every action. " +
  "Verify before moving funds. Not financial advice.";

export function SessionWelcomeHero(): JSX.Element {
  return (
    <>
      {/* LOGO CROWN — the BIG sigil stacked OVER the PREVIEW wordmark
       * (owner decree 2026-07-21 round 2: the side-by-side row shrank the
       * mark to badge scale — now the mark dominates and the wordmark sits
       * beneath it), one centered unit riding the base .vex-rise slot.
       * pb-2 + the composer's own mt-6 keep the breath before the input. */}
      <div className="relative z-10 flex w-full flex-col items-center px-8 pb-2 text-center">
        <div className="vex-rise flex flex-col items-center justify-center gap-4">
          <VexSigil className={SIGIL_CLASS} />
          {/* PREVIEW BADGE — the wordmark slot. Instrument Sans (the WH
           * face; the serif is rationed to the Portfolio Total Value),
           * letterspaced caps in the secondary tone so the sweeping white
           * shimmer band reads against it. Static SPAN, not a control. */}
          <span
            className="vex-preview-shimmer font-sans text-[13px] font-medium uppercase tracking-[0.42em] text-[var(--vex-text-2)] md:text-sm"
            data-shimmer-text={PREVIEW_LABEL}
            title={PREVIEW_TITLE}
            aria-label={PREVIEW_LABEL}
          >
            {PREVIEW_LABEL}
          </span>
        </div>
      </div>

      {/* BOTTOM BAND — the landing .hero-bottom at the stage's bottom edge:
       * ONLY the centered BACKED BY hallmark (owner decree 2026-07-21: the
       * "Executes through" integrations rail + chain-coverage line are
       * retired; the flanking barcode/LOCAL-FIRST/YOU-SIGN copy went in the
       * 2026-07-20 round). Click-transparent (pointer-events-none). */}
      <div className="vex-rise vex-rise-d4 pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3.5 px-8 pb-5 sm:px-12">
        {/* BACKED BY — the partner hallmark: a monochrome mark at
         * opacity-70, comfortable spacing. A hallmark, not a billboard. */}
        <div className="flex items-center justify-center gap-4">
          <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-[var(--vex-text-3)]">
            Backed by
          </span>
          <img
            src="/logo/virtuals.svg"
            alt="Virtuals"
            className="h-7 w-7 opacity-70"
          />
        </div>
      </div>
    </>
  );
}
