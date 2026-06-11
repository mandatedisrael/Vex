/**
 * Welcome hero — the register head of THE PROTOCOL DESK (S2 rebrand).
 *
 * Composer-hero layout: hallmark → status overline → plinth rule → H1 →
 * subline. The parent (`SessionPanel`) centers the column; the composer +
 * trust line + starter rows render below it. Pure presentation: no session
 * state, no draft state, no composer coupling. The old poster headline
 * ("Your chain. Your rules. I execute.") retired into the SessionCreator
 * ceremony subline; the trust badges became the composer's letterpress line.
 */

import type { JSX } from "react";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";

export function SessionWelcomeHero(): JSX.Element {
  return (
    <>
      {/* HALLMARK — same mark language as onboarding's NotaryPage, no glow. */}
      <img
        src="/logo_clean.png"
        alt=""
        draggable={false}
        className="mx-auto h-7 w-auto opacity-90"
      />

      {/* OVERLINE — static register status. The hex matrix is aria-hidden
       * here because it is decoration, not machine work (DotMatrix only
       * animates for verifiable in-flight work). */}
      <div className="mt-6 flex items-center justify-center gap-2.5">
        <span aria-hidden>
          <DotmHex3
            size={16}
            dotSize={2.5}
            color="var(--vex-accent)"
            animated={false}
          />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-[var(--vex-text-3)]">
          Register open — no entries today
        </span>
      </div>

      {/* PLINTH RULE — onboarding's plinth carried forward: full hairline
       * with a 24px accent tick at the left edge. */}
      <div aria-hidden className="relative mt-4 h-px w-full bg-[var(--vex-line)]">
        <span className="absolute -top-px left-0 h-px w-6 bg-[var(--vex-accent)]" />
      </div>

      {/* Left-aligned: this is a document head, not a poster. */}
      <h1 className="mt-7 text-[26px] font-medium leading-[1.25] text-foreground">
        What should I execute?
      </h1>

      <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-foreground">
        Type below. Everything runs locally — on-chain actions always wait for
        your signature.
      </p>
    </>
  );
}
