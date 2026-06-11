/**
 * Presentational decision footer (Reject / Approve) for `ApprovalCard` (F3 —
 * SECURITY-relevant).
 *
 * This component ONLY renders the two buttons and forwards their clicks. The
 * security-critical logic stays in `ApprovalCard`:
 *   - `onReject` / `onApprove` are the parent's `onRejectClick` / `onApproveClick`
 *     handlers, which own the two-step confirm gate (first click arms, second
 *     fires) and the in-flight guard.
 *   - `armedAction` and `isHighRisk` are passed in so the label/aria swap to the
 *     "Click again to confirm" copy is byte-identical to the original.
 *   - `rejectRef` is forwarded so the parent's first-mount focus-on-Reject
 *     default (least-destructive) still lands on this button.
 *
 * No state, no effects, no decision logic here — moving this JSX must not, and
 * does not, weaken any confirm gate.
 */

import type { JSX, RefObject } from "react";

export interface ApprovalDecisionActionsProps {
  readonly isHighRisk: boolean;
  readonly armedAction: "approve" | "reject" | null;
  readonly inFlight: boolean;
  readonly rejectRef: RefObject<HTMLButtonElement | null>;
  readonly onReject: () => void;
  readonly onApprove: () => void;
}

// Shared key shape; tone classes below pick quiet/accent/armed variants. The
// ARMED (confirm) state swaps the border to the danger mix on that button
// only — the second click is the irreversible one.
const KEY_BASE =
  "rounded-md border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] disabled:opacity-50";
const ARMED_BORDER =
  "border-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)]";

export function ApprovalDecisionActions({
  isHighRisk,
  armedAction,
  inFlight,
  rejectRef,
  onReject,
  onApprove,
}: ApprovalDecisionActionsProps): JSX.Element {
  const rejectArmed = isHighRisk && armedAction === "reject";
  const approveArmed = isHighRisk && armedAction === "approve";
  return (
    <footer className="flex items-center justify-end gap-2 border-t border-[var(--vex-line)] px-4 py-3">
      <button
        ref={rejectRef}
        type="button"
        onClick={onReject}
        disabled={inFlight}
        aria-label={rejectArmed ? "Confirm reject" : "Reject"}
        className={`${KEY_BASE} text-[var(--vex-text-2)] hover:bg-white/[0.05] hover:text-foreground ${
          rejectArmed ? ARMED_BORDER : "border-[var(--vex-line-strong)]"
        }`}
      >
        {rejectArmed ? "Click again to confirm reject" : "Reject"}
      </button>
      <button
        type="button"
        onClick={onApprove}
        disabled={inFlight}
        aria-label={approveArmed ? "Confirm approve" : "Approve"}
        className={`${KEY_BASE} font-medium text-[var(--vex-accent-text)] hover:bg-[var(--vex-accent-fill-8)] ${
          approveArmed ? ARMED_BORDER : "border-[var(--vex-accent-border)]"
        }`}
      >
        {approveArmed ? "Click again to confirm approve" : "Approve"}
      </button>
    </footer>
  );
}
