/**
 * Approval decision runtime — puzzle 5 phase 3 entry orchestrator.
 *
 * Public surface:
 *   - `prepareApprove(approvalId)`            — bounded approve path
 *   - `prepareReject(approvalId, reason?)`    — bounded reject path
 *   - `expireApproval(approvalId)`            — auto-reject for TTL sweep
 *                                               + the in-tx expire branch
 *                                               of `prepareApprove`
 *   - `runResumeAfterDecision(cont)`          — background continuation
 *                                               (resumeMissionRun + lease
 *                                               release in finally)
 *   - `discardContinuation(cont)`             — idempotent fallback
 *   - `sweepExpiredApprovals(now)`            — engine-side scheduled
 *                                               cleanup, returns
 *                                               continuations to main
 *
 * Snapshot phase lives in `./approval-runtime/snapshot.ts` (locked tx
 * + DB-side NOW() TTL gate). Post-tx side effects (dispatch + tool result
 * + lease+flip) live in `./approval-runtime/post-tx.ts`. Sweep lives in
 * `./approval-runtime/sweep.ts`. Continuation lifecycle (claim/run/
 * discard) lives in `./approval-runtime/continuation.ts`.
 *
 * Codex puzzle-5 phase-3 review iterations v1/v2/v3 → GREEN LIGHT 2026-05-23.
 */

import { withTransaction } from "../../db/client.js";
import {
  buildApproveSnapshot,
  buildRejectSnapshot,
} from "./approval-runtime/snapshot.js";
import {
  applyApproveSideEffects,
  applyPolicyDriftSideEffects,
  applyRejectSideEffects,
} from "./approval-runtime/post-tx.js";
import {
  buildPolicyDriftToolResultContent,
  buildRejectedToolResultContent,
  toIsoNow,
  toIsoOrNull,
  TOOL_RESULT_EXPIRED_MESSAGE,
  TOOL_RESULT_EXPIRED_REASON,
  TOOL_RESULT_REJECTED_DEFAULT_REASON,
} from "./approval-runtime/helpers.js";
import type {
  ApprovePrepareOutcome,
  RejectPrepareOutcome,
} from "./approval-runtime/types.js";

export {
  ApprovalDispatchError,
  ApprovalDecisionInconsistencyError,
  ApprovalPostDecisionError,
  type ApprovePrepareOutcome,
  type RejectPrepareOutcome,
  type PreparedContinuation,
  type SweepResult,
} from "./approval-runtime/types.js";

export {
  runResumeAfterDecision,
  discardContinuation,
} from "./approval-runtime/continuation.js";

export { sweepExpiredApprovals } from "./approval-runtime/sweep.js";

// ────────────────────────────────────────────────────────────────────────
// prepareApprove
// ────────────────────────────────────────────────────────────────────────

export async function prepareApprove(
  approvalId: string,
): Promise<ApprovePrepareOutcome> {
  const snapshot = await withTransaction((client) =>
    buildApproveSnapshot(client, approvalId),
  );

  switch (snapshot.type) {
    case "not_found":
      throw new Error(`Approval ${approvalId} not found`);

    case "cached_approved":
      return {
        kind: "cached_approved",
        approvalId,
        resolvedAt:
          toIsoOrNull(snapshot.row.queue_resolved_at) ?? toIsoNow(),
        executionStatus:
          (snapshot.row.execution_status as
            | "not_started"
            | "dispatching"
            | "succeeded"
            | "failed"
            | null) ?? "not_started",
        missionRunId: snapshot.row.mission_run_id,
      };

    case "already_rejected":
      return {
        kind: "already_rejected",
        approvalId,
        resolvedAt:
          toIsoOrNull(snapshot.row.queue_resolved_at) ?? toIsoNow(),
        decision: snapshot.row.decision as "rejected" | "rejected_stop",
      };

    case "run_terminated":
      return {
        kind: "run_terminated",
        approvalId,
        missionRunId: snapshot.row.mission_run_id!,
        runStatus: snapshot.runStatus,
      };

    case "expired_in_tx": {
      const autoRejection = await applyRejectSideEffects(
        approvalId,
        {
          type: "rejected_in_tx",
          row: snapshot.row,
          queueResolvedAt: snapshot.queueResolvedAt,
          reason: TOOL_RESULT_EXPIRED_REASON,
        },
        TOOL_RESULT_EXPIRED_MESSAGE,
      );
      return {
        kind: "expired",
        approvalId,
        expiresAt: snapshot.expiredAt,
        autoRejection,
      };
    }

    case "policy_drift_blocked":
      // B-001 — live permission drifted MORE restrictive after enqueue. The
      // snapshot tx already flipped queue+intent to `rejected` (no approved
      // decision); render the rejection tool-result and resume. NO dispatch.
      return applyPolicyDriftSideEffects(
        approvalId,
        snapshot,
        buildPolicyDriftToolResultContent(),
      );

    case "approved_in_tx":
      return applyApproveSideEffects(approvalId, snapshot);
  }
}

// ────────────────────────────────────────────────────────────────────────
// prepareReject
// ────────────────────────────────────────────────────────────────────────

export async function prepareReject(
  approvalId: string,
  reason: string = TOOL_RESULT_REJECTED_DEFAULT_REASON,
): Promise<RejectPrepareOutcome> {
  const snapshot = await withTransaction((client) =>
    buildRejectSnapshot(client, approvalId, reason),
  );

  switch (snapshot.type) {
    case "not_found":
      throw new Error(`Approval ${approvalId} not found`);

    case "already_approved":
      return {
        kind: "already_approved",
        approvalId,
        resolvedAt:
          toIsoOrNull(snapshot.row.queue_resolved_at) ?? toIsoNow(),
        missionRunId: snapshot.row.mission_run_id,
      };

    case "cached_rejected":
      return {
        kind: "cached_rejected",
        approvalId,
        resolvedAt:
          toIsoOrNull(snapshot.row.queue_resolved_at) ?? toIsoNow(),
        decision: snapshot.row.decision as "rejected" | "rejected_stop",
        reason: snapshot.row.decision_reason,
        missionRunId: snapshot.row.mission_run_id,
      };

    case "rejected_in_tx":
      return applyRejectSideEffects(
        approvalId,
        snapshot,
        buildRejectedToolResultContent(snapshot.reason),
      );
  }
}

// ────────────────────────────────────────────────────────────────────────
// expireApproval — auto-reject for TTL sweep + in-tx expired branch
// ────────────────────────────────────────────────────────────────────────

export async function expireApproval(
  approvalId: string,
): Promise<RejectPrepareOutcome> {
  const snapshot = await withTransaction((client) =>
    buildRejectSnapshot(client, approvalId, TOOL_RESULT_EXPIRED_REASON),
  );

  switch (snapshot.type) {
    case "not_found":
      throw new Error(`Approval ${approvalId} not found`);

    case "already_approved":
      return {
        kind: "already_approved",
        approvalId,
        resolvedAt:
          toIsoOrNull(snapshot.row.queue_resolved_at) ?? toIsoNow(),
        missionRunId: snapshot.row.mission_run_id,
      };

    case "cached_rejected":
      return {
        kind: "cached_rejected",
        approvalId,
        resolvedAt:
          toIsoOrNull(snapshot.row.queue_resolved_at) ?? toIsoNow(),
        decision: snapshot.row.decision as "rejected" | "rejected_stop",
        reason: snapshot.row.decision_reason,
        missionRunId: snapshot.row.mission_run_id,
      };

    case "rejected_in_tx":
      return applyRejectSideEffects(
        approvalId,
        snapshot,
        TOOL_RESULT_EXPIRED_MESSAGE,
      );
  }
}
