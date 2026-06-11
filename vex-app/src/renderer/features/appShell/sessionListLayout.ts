/**
 * Single-source layout constants + fit-to-height greedy packer for the
 * sessions sidebar.
 *
 * `SessionsList` measures the available height via ResizeObserver and
 * asks `computeVisibleGroups` to pack as many sessions as fit, in the
 * canonical bucket order (pinned → today → yesterday → older). Anything
 * that does not fit lives behind the "Browse all sessions" CTA.
 *
 * The constants here MUST stay in sync with the actual rendered heights
 * in `SessionRows.tsx`. The greedy packer is deterministic and pure, so
 * its behaviour is unit-tested in `__tests__/sessionListLayout.test.ts`.
 *
 * Test-safety: when `availableHeight <= 0` (initial render before the
 * ResizeObserver fires, or jsdom without a polyfill) the packer returns
 * the full input untouched — every test continues to see the full list.
 */

import type { SessionGroup } from "./sessionListModel.js";

/**
 * Fixed sidebar row height in pixels. Ledger rows render `h-14` (56px),
 * single-block vertically centered with two text lines (title + subtitle),
 * hairline-separated via border-b on each `<li>` — not gaps. Keep this in
 * lockstep with `SessionRow.tsx`.
 */
export const SIDEBAR_ROW_HEIGHT_PX = 56;
/** Rows are hairline-separated (border-b on `<li>`), no flex gap. */
export const SIDEBAR_ROW_GAP_PX = 0;
/** Section `<h2>` height: h-7 (28px) + mb-1 (4px) = 32px total. */
export const SIDEBAR_GROUP_HEADER_HEIGHT_PX = 32;
/** `flex flex-col gap-4` between sections. */
export const SIDEBAR_GROUP_GAP_PX = 16;
/** Browse-all CTA height: button h-10 + py-3 around it = ~56px. */
export const SIDEBAR_VIEW_ALL_BUTTON_HEIGHT_PX = 56;

export interface ComputeVisibleGroupsResult {
  readonly visible: readonly SessionGroup[];
  readonly hiddenCount: number;
}

interface PackOptions {
  readonly rowHeight: number;
  readonly rowGap: number;
  readonly headerHeight: number;
  readonly groupGap: number;
}

const DEFAULT_OPTIONS: PackOptions = {
  rowHeight: SIDEBAR_ROW_HEIGHT_PX,
  rowGap: SIDEBAR_ROW_GAP_PX,
  headerHeight: SIDEBAR_GROUP_HEADER_HEIGHT_PX,
  groupGap: SIDEBAR_GROUP_GAP_PX,
};

/**
 * Greedy section-by-section packer. Iterates groups in input order
 * (pinned → today → yesterday → older), takes whole sections when they
 * fit, otherwise truncates the section to whatever fits and stops.
 *
 * Algorithm:
 *   For each group with rows:
 *     1. Drop empty groups (no header, no rows count toward the budget).
 *     2. If remaining < headerHeight + rowHeight → group does not fit
 *        at all (header without rows looks broken). Bury everything.
 *     3. Subtract headerHeight from remaining.
 *     4. Pack rows: take = floor((remaining + rowGap) / (rowHeight + rowGap)),
 *        clamped to group.rows.length.
 *     5. Subtract the packed rows' height.
 *     6. Subtract groupGap before moving on (cheap simplification —
 *        slight under-pack vs the very last group, accepted).
 *
 * Special case: `availableHeight <= 0` returns the input untouched.
 * Tests and the first render before ResizeObserver fires see everything.
 */
export function computeVisibleGroups(
  groups: readonly SessionGroup[],
  availableHeight: number,
  options: Partial<PackOptions> = {},
): ComputeVisibleGroupsResult {
  if (availableHeight <= 0) {
    const hidden = 0;
    return { visible: groups, hiddenCount: hidden };
  }

  const opts: PackOptions = { ...DEFAULT_OPTIONS, ...options };
  let remaining = availableHeight;
  let hiddenCount = 0;
  const visible: SessionGroup[] = [];

  for (const group of groups) {
    if (group.rows.length === 0) continue;

    if (remaining < opts.headerHeight + opts.rowHeight) {
      hiddenCount += group.rows.length;
      continue;
    }

    remaining -= opts.headerHeight;
    const rowSlot = opts.rowHeight + opts.rowGap;
    // (+ rowGap) compensates for the trailing gap on the last row not
    // being applied; floor handles the remaining floor naturally.
    const maxFit = Math.floor((remaining + opts.rowGap) / rowSlot);
    const take = Math.min(maxFit, group.rows.length);

    if (take === 0) {
      // Header would render with zero rows — undo the header subtraction
      // and skip the section entirely.
      remaining += opts.headerHeight;
      hiddenCount += group.rows.length;
      continue;
    }

    visible.push({ ...group, rows: group.rows.slice(0, take) });
    hiddenCount += group.rows.length - take;
    remaining -= take * rowSlot - opts.rowGap;
    remaining -= opts.groupGap;
  }

  return { visible, hiddenCount };
}
