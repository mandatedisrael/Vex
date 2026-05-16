/**
 * Shared review summary primitive (M11; PR6 redesign — glass tile).
 *
 * Each domain card under `cards/` uses this to render the same
 * label / status / children / Edit-button layout. Pulling the layout
 * out keeps every domain card under ~70 LOC and prevents drift
 * between cards (e.g. one renders the Edit button at the top, another
 * at the bottom — confusing operator UX during finalize review).
 *
 * PR6: the shell switched to the onboarding glass aesthetic; this
 * tile now mirrors the `WizardStepPanel` surface so the review screen
 * doesn't double-wrap a shadcn card inside a glass panel.
 */

import type { JSX, ReactNode } from "react";
import { cn } from "../../../../../lib/utils.js";
import { Button } from "../../../../../components/ui/button.js";

export type SummaryStatus = "ok" | "missing" | "partial" | "warning" | "info";

const STATUS_DOT: Record<SummaryStatus, string> = {
  ok: "bg-[var(--color-success)]",
  missing: "bg-[var(--color-danger)]",
  partial: "bg-[var(--color-warning)]",
  warning: "bg-[var(--color-warning)]",
  info: "bg-[var(--color-text-muted)]",
};

export interface SummaryCardProps {
  readonly title: string;
  readonly status: SummaryStatus;
  readonly statusLabel: string;
  readonly children?: ReactNode;
  readonly onEdit?: () => void;
  readonly editDisabled?: boolean;
  readonly testId?: string;
}

export function SummaryCard({
  title,
  status,
  statusLabel,
  children,
  onEdit,
  editDisabled = false,
  testId,
}: SummaryCardProps): JSX.Element {
  return (
    <div
      data-vex-review-card={testId}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-white/[0.08]",
        "bg-white/[0.03] px-3 py-2.5 backdrop-blur-md",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])}
          />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            {statusLabel}
          </span>
          {onEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEdit}
              disabled={editDisabled}
            >
              Edit
            </Button>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="text-xs text-[var(--color-text-secondary)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}
