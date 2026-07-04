/**
 * Robinhood-mode switch — the one interactive element on the welcome stage's
 * backed-by strip (T2). Flips the persisted `uiStore.theme`, which re-tints
 * the whole shell through the `data-vex-theme` attribute and replays the
 * sigil/sky transition.
 *
 * A native `<button role="switch">` (Space/Enter fire it for free), with
 * `aria-checked` tracking the theme and a token-driven focus ring that stays
 * visible on ink in BOTH themes (the ring resolves to `--vex-accent`: cobalt
 * in vex, neon lime in Robinhood mode). The knob slide is a plain CSS
 * transform, so the global reduced-motion rule collapses it to an instant
 * state swap. The parent strip is `pointer-events-none`; this control restores
 * `pointer-events-auto` on itself only.
 */

import type { JSX } from "react";
import { cn } from "../../lib/utils.js";
import { useUiStore } from "../../stores/uiStore.js";

export function ThemeToggle(): JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const isRobinhood = theme === "robinhood";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isRobinhood}
      aria-label="Robinhood mode"
      data-vex-theme-toggle
      onClick={toggleTheme}
      className={cn(
        "pointer-events-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full border px-[3px] transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-surface-0)]",
        isRobinhood
          ? "border-[var(--vex-accent-border)] bg-[var(--vex-accent-fill-12)]"
          : "border-[var(--vex-line-strong)] bg-[var(--vex-surface-2)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "block h-3.5 w-3.5 rounded-full transition-transform duration-200",
          isRobinhood
            ? "translate-x-4 bg-[var(--vex-accent)]"
            : "translate-x-0 bg-[var(--vex-text-3)]",
        )}
      />
    </button>
  );
}
