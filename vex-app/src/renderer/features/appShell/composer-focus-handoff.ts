/**
 * Pure transition rule for `AppShell`'s composer focus handoff
 * (fix/hypervexing-exit-focus, item b): true exactly on the ONE visual
 * transition that means "the Hypervexing exit drain just finished" — the
 * moment the shell should hand focus back to the normal chat composer.
 *
 * Pulled out of `AppShell.tsx` (same reason as `composer-helpers.ts`): no
 * React, no hooks, so the rule is unit-testable without mounting the shell's
 * heavy import graph (the backdrop, the workspace panes, session lists, …).
 */

import type { WorkspaceMode } from "../../stores/uiStore.js";

export function shouldFocusComposerAfterWorkspaceExit(
  previousVisualMode: WorkspaceMode,
  nextVisualMode: WorkspaceMode,
): boolean {
  return previousVisualMode === "hypervexing" && nextVisualMode === "normal";
}
