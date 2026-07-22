/**
 * Shared status chrome for wizard step interiors (Chronos Phase 2b,
 * AMENDMENT A3 — boxless composition).
 *
 * Warnings and errors are RAIL-style: a 2px color rail on the left,
 * quiet copy beside it — never a filled, rounded box. Calm/success
 * states render as a plain colored word + text (no rail at all).
 * ONE source for the recipe so the ~15 alert sites across the steps
 * cannot drift apart. Callers add their own text color/size.
 *
 * These strings are world-neutral: color-mix on the global status hues
 * reads correctly on the cobalt gate plate AND inside the ink-glass
 * shell (the Settings screen hosts the same step forms).
 */

export const RAIL_WARNING_CHROME =
  "border-l-2 border-[color-mix(in_oklab,var(--color-warning)_45%,transparent)] pl-3";

export const RAIL_DANGER_CHROME =
  "border-l-2 border-[color-mix(in_oklab,var(--color-danger)_45%,transparent)] pl-3";
