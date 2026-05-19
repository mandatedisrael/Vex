/**
 * First-run window sizing and BrowserWindow min-constraint helpers.
 *
 * `computeFirstRunBounds` produces a screen-proportional initial size
 * (85% of workArea) inside `[SOFT_MIN..MAX]`, then clamps to the
 * actually-available workArea so we never request a window bigger than
 * the screen can show. `isFirstRun` detects "no saved bounds yet" via
 * the persisted-prefs sentinel `x === null && y === null`.
 *
 * `computeMinConstraints` derives BrowserWindow `minWidth`/`minHeight`
 * from the already-normalized bounds. On extreme displays (e.g. 800x600)
 * the work area is smaller than our preferred 1000x720 minimum — in
 * that case we deliberately allow a smaller minimum *for that launch*
 * instead of letting Electron refuse to instantiate the window. Once
 * the user moves to a normal display, `persistState` saved real bounds
 * and subsequent launches recover the standard minimum.
 */

import type { SavedWindowBounds } from "./visibility.js";

/** BrowserWindow minWidth ceiling on normal displays. */
const ABSOLUTE_MIN_W = 1000;
/** BrowserWindow minHeight ceiling on normal displays. */
const ABSOLUTE_MIN_H = 720;
/** Preferred first-run minimum width (only used as starting target). */
const SOFT_MIN_W = 1100;
/** Preferred first-run minimum height. */
const SOFT_MIN_H = 800;
/** First-run upper cap so we do not fill the entire monitor. */
const MAX_W = 1600;
/** First-run upper cap on height. */
const MAX_H = 1000;
/** Proportion of workArea to target on first run. */
const TARGET_PCT = 0.85;

export interface WorkAreaSize {
  readonly width: number;
  readonly height: number;
}

export interface FirstRunBounds {
  readonly width: number;
  readonly height: number;
}

export interface MinConstraints {
  readonly minWidth: number;
  readonly minHeight: number;
}

/**
 * Compute screen-proportional first-run window dimensions.
 *
 * Pipeline: 85% target → clamp to `[SOFT_MIN..MAX]` → clamp to
 * `workArea` (cannot request more than the screen offers) → floor
 * at `ABSOLUTE_MIN` (cannot be smaller than the BrowserWindow minimum).
 */
export function computeFirstRunBounds(workArea: WorkAreaSize): FirstRunBounds {
  const targetW = Math.round(workArea.width * TARGET_PCT);
  const targetH = Math.round(workArea.height * TARGET_PCT);
  const desiredW = Math.min(MAX_W, Math.max(SOFT_MIN_W, targetW));
  const desiredH = Math.min(MAX_H, Math.max(SOFT_MIN_H, targetH));
  const width = Math.max(ABSOLUTE_MIN_W, Math.min(desiredW, workArea.width));
  const height = Math.max(ABSOLUTE_MIN_H, Math.min(desiredH, workArea.height));
  return { width, height };
}

/**
 * First-run sentinel: persisted prefs default `x` and `y` to `null`
 * until the first window close writes real coordinates back.
 */
export function isFirstRun(saved: SavedWindowBounds): boolean {
  return saved.x === null && saved.y === null;
}

/**
 * Derive BrowserWindow `minWidth`/`minHeight` from the actually-requested
 * bounds. BrowserWindow refuses to instantiate when width/height are
 * below minWidth/minHeight; on extreme tiny displays (workArea < 1000×720)
 * we relax the minimum to the requested bounds for this launch instead
 * of failing. See module-level doc for rationale.
 */
export function computeMinConstraints(
  bounds: { readonly width: number; readonly height: number },
): MinConstraints {
  return {
    minWidth: Math.min(ABSOLUTE_MIN_W, bounds.width),
    minHeight: Math.min(ABSOLUTE_MIN_H, bounds.height),
  };
}
