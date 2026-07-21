/**
 * Shared macOS-grade motion constants (owner correction round, 2026-07-20).
 * ONE source for the shell's spring/easing DNA so the screen morph, the
 * profile-menu pop, dialogs and micro-interactions all move with the same
 * hand instead of per-file magic numbers:
 *
 *  - SPRING_PANEL — the big-surface spring: the ShellScreen FLIP morph.
 *  - SPRING_SNAPPY — the small-surface pop: the profile side-panel menu.
 *  - EASE_STANDARD — the cult-ui SidePanel tween curve [0.42, 0, 0.58, 1],
 *    used for row staggers/exits; mirrored in CSS by `vex-dialog-enter`
 *    (globals.css) so dialog enters speak the same curve. Keep both in sync.
 *
 * Motion applies these via CSSOM property writes (MOTION-POLICY-safe; no
 * `layout`/`layoutId`, which would inject a runtime stylesheet the CSP
 * blocks). Only transform/opacity animate — plus the ShellScreen morph's
 * border-radius, which the cult ExpandableScreen grammar requires.
 */

export const SPRING_PANEL = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 0.9,
} as const;

export const SPRING_SNAPPY = {
  type: "spring",
  stiffness: 420,
  damping: 34,
} as const;

export const EASE_STANDARD = [0.42, 0, 0.58, 1] as const;
