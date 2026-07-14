/**
 * OutcomeBadge — the ONE shared small colour-toned stamp for a mission's
 * outcome (WP-J: replaces a duplicated inline badge — every surface that
 * shows a mission outcome renders it through this single component).
 *
 * Takes the DISPLAY outcome (`missionHistoryModel.ts` `missionDisplayOutcome`),
 * never the raw ledger `outcome` — a deadline-reached run reads as the
 * neutral "time-boxed", not "failed".
 */

import type { JSX } from "react";
import { cn } from "../../lib/utils.js";
import type { MissionDisplayOutcome } from "./missionHistoryModel.js";

const LABEL: Record<MissionDisplayOutcome, string> = {
  completed: "completed",
  timeBoxed: "time-boxed",
  cancelled: "cancelled",
  failed: "failed",
  stopped: "stopped",
  running: "running",
};

const TONE: Record<MissionDisplayOutcome, string> = {
  completed:
    "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-[var(--color-success)]",
  // Neutral/medium-level — a reached time-box is not a failure.
  timeBoxed: "border-[var(--vex-accent-border)] text-[var(--vex-accent-text)]",
  failed: "border-destructive/40 text-destructive",
  running: "border-[var(--vex-accent-border)] text-[var(--vex-accent-text)]",
  cancelled: "border-[var(--vex-line)] text-[var(--vex-text-2)]",
  stopped: "border-[var(--vex-line)] text-[var(--vex-text-2)]",
};

export interface OutcomeBadgeProps {
  readonly outcome: MissionDisplayOutcome;
}

export function OutcomeBadge({ outcome }: OutcomeBadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
        TONE[outcome],
      )}
    >
      {LABEL[outcome]}
    </span>
  );
}
