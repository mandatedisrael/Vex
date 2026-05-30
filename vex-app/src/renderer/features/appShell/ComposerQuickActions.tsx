/**
 * Quick-action prompt chips rendered under the composer (hidden in mission
 * mode — the parent swaps in the mission contract card there). Presentational
 * only: the chip catalog lives in `composer-quick-actions.ts`; picking a chip
 * seeds the draft via the parent's `onPick`. Extracted from `SessionComposer`
 * to keep that file within its size budget.
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
    <div className="mt-4 flex flex-wrap gap-2">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onPick(action.prompt)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/[0.18] px-3 text-xs text-[var(--color-text-secondary)] backdrop-blur-xl transition-colors hover:border-[#3275f8]/32 hover:bg-[#3275f8]/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
        >
          <HugeiconsIcon icon={action.icon} size={15} aria-hidden />
          {action.label}
        </button>
      ))}
    </div>
  );
}
