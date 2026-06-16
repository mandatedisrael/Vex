/**
 * DESK RULE tape-head — the header's live readout of the active session's tape
 * state. With the reading column left-anchored (SessionPanel), the spine, the
 * DESK RULE accent tick, and this word share one left axis: the header becomes
 * the head of the tape.
 *
 * State precedence mirrors the streaming strip's circuit-break: a pending
 * approval FREEZES the run, so AWAITING wins over LIVE; otherwise LIVE while the
 * engine streams; IDLE at rest. Blue is rationed to the two non-idle states.
 *
 * Renders nothing off the session view / with no active session. Both data
 * hooks accept a null id and self-gate (no IPC when idle); the pending query
 * shares ApprovalsRegion's key, so this adds no polling load.
 */

import type { JSX } from "react";
import { usePendingApprovals } from "../../lib/api/approvals.js";
import { useStreamPreview } from "../../stores/streamStore.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";

export function DeskRuleTapeState(): JSX.Element | null {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const appShellView = useUiStore((s) => s.appShellView);
  const preview = useStreamPreview(activeSessionId);
  const pending = usePendingApprovals(activeSessionId);

  if (appShellView !== "session" || activeSessionId === null) return null;

  const pendingData = pending.data;
  const hasPending =
    pendingData !== undefined && pendingData.ok && pendingData.data.length > 0;
  const streaming = preview !== null && preview.phase === "streaming";

  const state = hasPending ? "awaiting" : streaming ? "live" : "idle";
  const label =
    state === "awaiting" ? "Awaiting" : state === "live" ? "Live" : "Idle";
  const lit = state !== "idle";

  return (
    <span
      data-vex-tape-state={state}
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em]",
        lit ? "text-[var(--vex-accent-text)]" : "text-[var(--vex-text-3)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1 w-1 rounded-full",
          lit ? "bg-[var(--vex-accent)]" : "bg-[var(--vex-text-3)]",
        )}
      />
      {label}
    </span>
  );
}
