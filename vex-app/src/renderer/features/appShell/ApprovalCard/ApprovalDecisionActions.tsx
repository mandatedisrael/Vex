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

export function ApprovalDecisionActions({
  isHighRisk,
  armedAction,
  inFlight,
  rejectRef,
  onReject,
  onApprove,
}: ApprovalDecisionActionsProps): JSX.Element {
  return (
    <footer className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-4 py-3">
      <button
        ref={rejectRef}
        type="button"
        onClick={onReject}
        disabled={inFlight}
        aria-label={
          isHighRisk && armedAction === "reject" ? "Confirm reject" : "Reject"
        }
        className="rounded-md border border-white/[0.10] px-3 py-1.5 text-xs hover:bg-white/[0.05] disabled:opacity-50"
      >
        {isHighRisk && armedAction === "reject"
          ? "Click again to confirm reject"
          : "Reject"}
      </button>
      <button
        type="button"
        onClick={onApprove}
        disabled={inFlight}
        aria-label={
          isHighRisk && armedAction === "approve"
            ? "Confirm approve"
            : "Approve"
        }
        className={`rounded-md px-3 py-1.5 text-xs font-medium ${
          isHighRisk
            ? "border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15"
            : "border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15"
        } disabled:opacity-50`}
      >
        {isHighRisk && armedAction === "approve"
          ? "Click again to confirm approve"
          : "Approve"}
      </button>
    </footer>
  );
}
