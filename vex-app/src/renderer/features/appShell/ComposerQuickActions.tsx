/**
 * Starter chips — one horizontal row of three compact hairline chips DETACHED
 * below the Signal Console (on the stage, not inside the glass card). Each chip
 * pairs a small intent icon with a mono label; picking a chip seeds the draft
 * via the parent's `onPick`. The 01–03 numbering was dropped in the redesign —
 * these are three parallel starters, not an ordered sequence, so a number
 * would encode order that isn't there. Real buttons → keyboard focusable.
 *
 * The row only ever renders on the welcome/idle stage (empty conversation) and
 * while the "+" toggle keeps it revealed, so it carries the stage's one-shot
 * rise choreography at the d3 stagger (status → H1 → console → chips).
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { QUICK_ACTIONS } from "./composer-quick-actions.js";

export function ComposerQuickActions({
  onPick,
}: {
  readonly onPick: (prompt: string) => void;
}): JSX.Element {
  return (
    <div className="vex-rise vex-rise-d3 mt-4 flex flex-wrap items-center justify-center gap-2">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onPick(action.prompt)}
          className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-[var(--vex-line)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--vex-text-2)] transition-colors hover:border-[var(--vex-accent-border)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          {/* Intent glyph — decorative accent mark, not part of the label. */}
          <HugeiconsIcon
            icon={action.icon}
            size={13}
            className="shrink-0 text-[var(--vex-accent-text)]"
            aria-hidden
          />
          <span className="truncate">{action.label}</span>
        </button>
      ))}
    </div>
  );
}
