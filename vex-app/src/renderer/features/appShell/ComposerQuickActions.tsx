/**
 * Starter ledger rows rendered under the composer (S2 rebrand — icon chips
 * retired; hidden in mission mode, where the parent swaps in the mission
 * contract card). Presentational only: the row catalog lives in
 * `composer-quick-actions.ts`; picking a row seeds the draft via the
 * parent's `onPick`. Each row is a `.vex-sign-key` so the left accent tick
 * draws in on hover/focus via the shared signing-stroke rule in globals.css.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";
import { QUICK_ACTIONS } from "./composer-quick-actions.js";

export function ComposerQuickActions({
  onPick,
}: {
  readonly onPick: (prompt: string) => void;
}): JSX.Element {
  return (
    <div className="mt-4">
      {QUICK_ACTIONS.map((action, index) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onPick(action.prompt)}
          className={cn(
            "vex-sign-key relative flex h-10 w-full items-center gap-3 border-b border-[var(--vex-line)] px-1 text-left transition-colors hover:bg-white/[0.03]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
            index === 0 && "border-t",
          )}
        >
          {/* 24px accent tick — drawn in by .vex-sign-key:hover/:focus-visible. */}
          <span
            aria-hidden
            className="vex-sign-stroke absolute left-0 top-1/2 h-px w-6 bg-[var(--vex-accent)]"
          />
          <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
            {action.label}
          </span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            aria-hidden
            className="text-[var(--vex-text-3)]"
          />
        </button>
      ))}
    </div>
  );
}
