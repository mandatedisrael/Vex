/**
 * Approval runtime — public types + named error classes.
 *
 * Discriminated unions are the IPC-mapping contract (Codex puzzle-5 phase-3
 * review point 6 — no `TurnResult` synthesis as decision shape). Phase 3
 * adds `executionStatus`, `missionRunId`, `cached`, and `expiresAt` data so
 * the renderer can render the decision lifecycle without a second IPC call.
 */

import type { LeaseHandle } from "../../runtime/lease-handle.js";
import type { MissionRunStatus } from "../../types.js";

/**
 * Opaque resumed-mission continuation. Owned by the bounded prepare path;
 * consumed by `runResumeAfterDecision()` (sole release responsibility) OR
 * defensively by `discardContinuation()` if the caller cannot schedule.
 *
 * The lease handle is engine-internal — main treats this struct as opaque
 * even though it carries strict types. Holding a continuation without
 * scheduling it (or discarding it) leaks a lease until the TTL expires.
 */
export interface PreparedContinuation {
  readonly missionRunId: string;
  readonly sessionId: string;
  readonly leaseHandle: LeaseHandle;
  readonly ownerId: string;
}

export type ApprovePrepareOutcome =
  | {
      readonly kind: "dispatched";
      readonly approvalId: string;
      readonly resolvedAt: string;
      readonly executionStatus: "succeeded" | "failed";
      readonly sessionId: string;
      readonly missionRunId: string | null;
      readonly continuation: PreparedContinuation | null;
      readonly toolResult: { success: boolean; output: string };
    }
  | {
      readonly kind: "cached_approved";
      readonly approvalId: string;
      readonly resolvedAt: string;
      readonly executionStatus:
        | "not_started"
        | "dispatching"
        | "succeeded"
        | "failed";
      readonly missionRunId: string | null;
    }
  | {
      readonly kind: "expired";
      readonly approvalId: string;
      readonly expiresAt: string;
      readonly autoRejection: RejectPrepareOutcome;
    }
  | {
      /**
       * B-001 — the live session permission drifted strictly MORE restrictive
       * than the permission captured at enqueue, so the approved action is no
       * longer permitted to dispatch. The approve FAILED CLOSED: queue+intent
       * are `rejected` (NOT approved, NOT pending), NO tool was dispatched, and
       * the appended tool-result is a rejection (not an approved result). The
       * mission run resumes via `continuation` to observe the rejection. IPC
       * maps this to `approvals.policy_drift_blocked`.
       */
      readonly kind: "policy_drift_blocked";
      readonly approvalId: string;
      readonly resolvedAt: string;
      readonly sessionId: string;
      readonly missionRunId: string | null;
      readonly permissionAtEnqueue: "restricted" | "full";
      readonly livePermission: "restricted" | "full";
      readonly continuation: PreparedContinuation | null;
    }
  | {
      readonly kind: "already_rejected";
      readonly approvalId: string;
      readonly resolvedAt: string;
      readonly decision: "rejected" | "rejected_stop";
    }
  | {
      readonly kind: "run_terminated";
      readonly approvalId: string;
      readonly missionRunId: string;
      readonly runStatus: MissionRunStatus;
    };

export type RejectPrepareOutcome =
  | {
      readonly kind: "rejected";
      readonly approvalId: string;
      readonly resolvedAt: string;
      readonly sessionId: string;
      readonly missionRunId: string | null;
      readonly reason: string;
      readonly continuation: PreparedContinuation | null;
    }
  | {
      readonly kind: "cached_rejected";
      readonly approvalId: string;
      readonly resolvedAt: string;
      readonly decision: "rejected" | "rejected_stop";
      readonly reason: string | null;
      readonly missionRunId: string | null;
    }
  | {
      readonly kind: "already_approved";
      readonly approvalId: string;
      readonly resolvedAt: string;
      readonly missionRunId: string | null;
    };

export interface SweepResult {
  readonly swept: number;
  readonly errored: number;
  readonly continuations: ReadonlyArray<PreparedContinuation>;
}

/**
 * Tool dispatch handler threw an unhandled exception after the approval
 * decision tx committed. The mission run has been flipped to `paused_error`;
 * no continuation was scheduled. IPC maps to `approvals.dispatch_failed`.
 */
export class ApprovalDispatchError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly errorKind: string,
    public readonly errorHash: string,
  ) {
    super(
      `Tool dispatch failed after approval (${approvalId}): ${errorKind} [hash ${errorHash}]`,
    );
    this.name = "ApprovalDispatchError";
  }
}

/**
 * Internal invariant violation — queue.status and intent.decision drifted
 * apart (queue.status='pending' but intent.decision != null, or vice versa).
 * Should never happen in normal flow because every decision tx commits both
 * sides together. IPC maps to `internal.unexpected`.
 */
export class ApprovalDecisionInconsistencyError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly detail: string,
  ) {
    super(
      `Approval ${approvalId} decision/queue state inconsistency: ${detail}`,
    );
    this.name = "ApprovalDecisionInconsistencyError";
  }
}

/**
 * Post-decision side effect (markExecutionStatus / appendMessage / lease
 * claim) failed AFTER the queue+intent decision tx committed. The mission
 * run has been explicitly transitioned to `paused_error` so the operator
 * can `/retry` to recover. IPC maps to `approvals.dispatch_failed`.
 *
 * Distinct from `ApprovalDispatchError` (which fires when the tool handler
 * itself throws) so the audit/log path keeps the cause categories separate.
 */
export class ApprovalPostDecisionError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly errorKind: string,
    public readonly errorHash: string,
  ) {
    super(
      `Approval ${approvalId} post-decision side effect failed: ${errorKind} [hash ${errorHash}]`,
    );
    this.name = "ApprovalPostDecisionError";
  }
}
