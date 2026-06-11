/**
 * PLAN switch — the single control point for session-scoped plan mode,
 * mounted in the composer chrome row (S2; lifted out of `SessionPlanCard`).
 *
 * Presentation-only over engine-owned state: the parent `SessionComposer`
 * reads the plan via `useSessionPlan` and toggles via `useSetPlanMode` —
 * the exact invalidate-based hooks `SessionPlanCard` uses, so there is no
 * optimistic write and a server refusal snaps the switch back on refetch.
 * Lives in its own file to keep the composer within its size budget.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MapPinIcon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";

export interface PlanSwitchProps {
  /** Null on the welcome screen — plan mode needs an open session. */
  readonly sessionId: string | null;
  readonly planOn: boolean;
  /** setPlanMode mutation in flight — wait for the engine's answer. */
  readonly busy: boolean;
  /**
   * Mission run parked for plan acceptance (`paused_plan_acceptance`) —
   * the engine refuses toggles in this state, so disable up front.
   */
  readonly missionBlocked: boolean;
  readonly onToggle: () => void;
}

export function PlanSwitch({
  sessionId,
  planOn,
  busy,
  missionBlocked,
  onToggle,
}: PlanSwitchProps): JSX.Element {
  const noSession = sessionId === null;
  const title = noSession
    ? "Available once a session is open"
    : missionBlocked
      ? "Unavailable while a mission is running"
      : undefined;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={planOn}
      aria-label="Plan mode"
      data-vex-plan-mode={planOn ? "on" : "off"}
      disabled={noSession || missionBlocked || busy}
      title={title}
      onClick={onToggle}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-[160ms]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
        planOn
          ? "border-[var(--vex-accent-border)] bg-[var(--vex-accent-fill-8)] text-[var(--vex-accent-text)]"
          : "border-[var(--vex-line-strong)] text-[var(--vex-text-3)]",
      )}
    >
      <HugeiconsIcon icon={MapPinIcon} size={13} aria-hidden />
      Plan
      {/* 5px state lamp — outline when off, solid accent when on. */}
      <span
        aria-hidden
        className={cn(
          "h-[5px] w-[5px] rounded-[1px] border",
          planOn
            ? "border-transparent bg-[var(--vex-accent)]"
            : "border-[var(--vex-line-strong)] bg-transparent",
        )}
      />
    </button>
  );
}
