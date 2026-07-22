/**
 * One row of the DESK RULE global approvals inbox.
 *
 * A session header (title → "Untitled session" → "Background approval" for a
 * session-less / deleted-session row) with an optional "Open session" jump,
 * then the FULL `ApprovalCard` reused verbatim so the two-step high-risk
 * confirm + risk/action stamps + critical-args well are identical to the
 * inline card — a destructive action can never be one-click approved here.
 *
 * The card is mounted with `idVariant="global"` so its `approval-card-<id>-`
 * title element id stays unique when the SAME approval also renders inline in
 * the active session (A3 — duplicate DOM ids break `aria-labelledby`).
 */

import type { JSX } from "react";
import type { ApprovalPendingGlobalDto } from "@shared/schemas/approvals.js";
import { useUiStore } from "../../../stores/uiStore.js";
import { ApprovalCard } from "../ApprovalCard.js";

export interface GlobalApprovalItemProps {
  readonly row: ApprovalPendingGlobalDto;
  /** Close the panel after navigating to the owning session. */
  readonly onOpenSession: () => void;
}

export function GlobalApprovalItem({
  row,
  onOpenSession,
}: GlobalApprovalItemProps): JSX.Element {
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setShellRoute = useUiStore((s) => s.setShellRoute);

  // A5 nulls `sessionId` for session-less / deleted-session rows upstream, so
  // "Open session" gates on it directly.
  const canOpenSession = row.sessionId !== null;
  const sessionLabel =
    row.sessionTitle ?? (row.sessionId !== null ? "Untitled session" : "Background approval");

  const openSession = (): void => {
    if (row.sessionId === null) return;
    setActiveSessionId(row.sessionId);
    // A full-app screen (Memory / Missions / …) may be covering the shell —
    // close it so the jump actually lands on the session transcript.
    setShellRoute({ kind: "none" });
    onOpenSession();
  };

  return (
    <div
      data-vex-area="global-approval-item"
      className="border-b border-[var(--vex-line)] px-3 py-2 last:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
          {sessionLabel}
        </span>
        {canOpenSession ? (
          <button
            type="button"
            onClick={openSession}
            className="shrink-0 rounded-[3px] font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-2)] hover:text-[var(--vex-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
          >
            Open session
          </button>
        ) : null}
      </div>
      <ApprovalCard
        summary={row}
        sessionId={row.sessionId ?? ""}
        focusOnMount={false}
        idVariant="global"
      />
    </div>
  );
}
