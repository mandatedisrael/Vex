/**
 * Order Ticket chrome — the three presentational pieces that turn the chat
 * composer into a landing-style instrument (the projectvex.ai `.frame` +
 * `.ws-*` grammar). All token-only; the frame ring, focus glow, focus sweep
 * and the empty-field breathe live in `styles/globals.css` (the design guard
 * bans resting glow / sweep shadows from component classNames).
 *
 *   - `TicketHeader`  — slim header microbar (the `.ws-bar` motif): a mono
 *     eyebrow naming the instrument context on the left, a live status dot
 *     (`.vex-pulse-dot`) on the right. Amber (`--vex-pin`) while a run is
 *     parked for approval, otherwise quiet text-3 + success-green dot.
 *   - `PromptGlyph`   — the leading accent mark before the field. Breathes
 *     (slow opacity pulse) ONLY while the field is empty; solid while typing.
 *   - `TicketFlowStrip` — the welcome-stage provenance line
 *     (`PROPOSE → ENFORCE → PROVE`, the landing `.ws-flow` recipe): first
 *     word in success green, arrows dimmed.
 *
 * The eyebrow copy is derived by the pure `ticketEyebrowLabel` helper in
 * `composer-ticket.ts`.
 */

import type { JSX } from "react";
import { cn } from "../../../lib/utils.js";

/**
 * The header microbar. `awaiting` flips the whole bar to the amber approval
 * echo (eyebrow + dot) to match the ticket chrome's `data-vex-ticket-state`.
 */
export function TicketHeader({
  label,
  awaiting,
}: {
  readonly label: string;
  readonly awaiting: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 pt-2.5 pb-0.5">
      <span
        data-vex-ticket-eyebrow={awaiting ? "approval" : "input"}
        className={cn(
          "min-w-0 truncate font-mono text-[9.5px] uppercase tracking-[0.2em]",
          awaiting ? "text-[var(--vex-pin)]" : "text-[var(--vex-text-3)]",
        )}
      >
        {label}
      </span>
      {/* Live status lamp — the landing .ws-bar-status em; pulses to read
       * "instrument live". Amber while awaiting your signature. Reduced
       * motion collapses the pulse to a still dot (global rule). */}
      <span
        aria-hidden
        className={cn(
          "vex-pulse-dot h-[6px] w-[6px] shrink-0 rounded-full",
          awaiting
            ? "bg-[var(--vex-pin)] [--vex-pulse-color:color-mix(in_oklab,var(--vex-pin)_55%,transparent)]"
            : "bg-[var(--color-success)] [--vex-pulse-color:color-mix(in_oklab,var(--color-success)_50%,transparent)]",
        )}
      />
    </div>
  );
}

/**
 * Leading accent mark before the textarea. `empty` drives the breathe:
 * idle (breathing) while there is nothing to send, solid the moment the
 * operator starts typing. Decorative — hidden from the accessible tree.
 */
export function PromptGlyph({ empty }: { readonly empty: boolean }): JSX.Element {
  return (
    <span
      aria-hidden
      data-vex-ticket-glyph={empty ? "idle" : "active"}
      className={cn(
        "shrink-0 select-none font-mono text-[15px] leading-[1.7] text-[var(--vex-accent-text)]",
        empty && "vex-ticket-glyph--idle",
      )}
    >
      »
    </span>
  );
}

/**
 * Welcome-stage provenance line — `PROPOSE → ENFORCE → PROVE`. First word
 * carries the success green (the promise Vex keeps); the arrows are dimmed
 * so the three verbs read as one quiet strip.
 */
export function TicketFlowStrip(): JSX.Element {
  const arrow = "text-[color-mix(in_oklab,var(--vex-text-3)_55%,transparent)]";
  return (
    <div
      data-vex-ticket-flow
      className="flex items-center justify-center gap-2 px-4 pb-2.5 pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em]"
    >
      <span className="text-[var(--color-success)]">Propose</span>
      <span aria-hidden className={arrow}>
        →
      </span>
      <span className="text-[var(--vex-text-3)]">Enforce</span>
      <span aria-hidden className={arrow}>
        →
      </span>
      <span className="text-[var(--vex-text-3)]">Prove</span>
    </div>
  );
}
