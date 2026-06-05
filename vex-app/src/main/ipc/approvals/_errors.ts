/**
 * Approvals IPC — puzzle 5 phase 3 VexError builders.
 *
 * The four `approvals.*` codes are registered in `@shared/ipc/result.ts`;
 * each builder stamps `domain: "approvals"`, `retryable: false`,
 * `userActionable: true`, `redacted: true` so the renderer toasts a
 * "cannot proceed" message rather than triggering retries.
 *
 * `approvalsUnexpectedError` is the catch-all for engine-side
 * `ApprovalDecisionInconsistencyError` and any other unhandled throw —
 * mapped to `internal.unexpected` because operational state drift isn't an
 * approve/reject-specific failure mode.
 */

import type { VexError } from "@shared/ipc/result.js";

export function approvalsExpiredError(
  correlationId: string,
  expiresAt: string,
): VexError {
  return {
    code: "approvals.expired",
    domain: "approvals",
    message:
      "This approval has expired. The agent has been notified — try again after a fresh tool call.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
    details: { expiresAt },
  };
}

export function approvalsAlreadyResolvedError(
  correlationId: string,
  decision: string,
): VexError {
  return {
    code: "approvals.already_resolved",
    domain: "approvals",
    message: `This approval was already ${decision} by another path.`,
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
    details: { decision },
  };
}

export function approvalsRunTerminatedError(
  correlationId: string,
  runStatus: string,
): VexError {
  return {
    code: "approvals.run_terminated",
    domain: "approvals",
    message: `The mission run is ${runStatus} and cannot accept this approval.`,
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
    details: { runStatus },
  };
}

export function approvalsDispatchFailedError(correlationId: string): VexError {
  return {
    code: "approvals.dispatch_failed",
    domain: "approvals",
    message:
      "Tool execution failed after approval. The mission run has been paused; see transcript for details.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

/**
 * B-001 — the live session permission became MORE restrictive between enqueue
 * and approve, so the action was no longer permitted. The approve failed
 * closed: queue+intent were rejected and NO tool was dispatched. `retryable:
 * false` (re-approving the same intent will hit the same drift); the user must
 * re-issue the action under the current permission policy.
 */
export function approvalsPolicyDriftBlockedError(
  correlationId: string,
): VexError {
  return {
    code: "approvals.policy_drift_blocked",
    domain: "approvals",
    message:
      "This action can no longer run: the session permission became more " +
      "restrictive after approval was requested. Re-issue the action under " +
      "the current permission policy.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

export function approvalsUnexpectedError(correlationId: string): VexError {
  return {
    code: "internal.unexpected",
    domain: "approvals",
    message:
      "Unable to apply the approval decision. Verify run status and retry.",
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
  };
}
