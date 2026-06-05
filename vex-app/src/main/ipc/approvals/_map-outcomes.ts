/**
 * Approvals IPC — discriminated-outcome → `Result<ApprovalActionResult>`
 * mappers. Phase 3 isolates the mapping logic so the main handler module
 * stays focused on the handler shell + background dispatch glue.
 *
 * `runtimeOutcome` is independent of `executionStatus`: if a continuation
 * was claimed the mission resumes (`runtimeOutcome: 'resumed'`) even when
 * the tool dispatch reported a controlled failure (`executionStatus:
 * 'failed'`). Chat sessions without a mission map to `'stopped'`.
 */

import { ok, err, type Result } from "@shared/ipc/result.js";
import type { ApprovalActionResult } from "@shared/schemas/approvals.js";
import { log } from "../../logger/index.js";
import {
  approvalsAlreadyResolvedError,
  approvalsExpiredError,
  approvalsPolicyDriftBlockedError,
  approvalsRunTerminatedError,
} from "./_errors.js";

// Typed via the engine's exported outcome unions. The dynamic-import return
// shape is awaited here so the mapper compiles even though approval-runtime
// is loaded lazily inside the IPC handler.
type ApprovePrepareOutcome = Awaited<
  ReturnType<
    typeof import("@vex-agent/engine/core/approval-runtime.js")["prepareApprove"]
  >
>;
type RejectPrepareOutcome = Awaited<
  ReturnType<
    typeof import("@vex-agent/engine/core/approval-runtime.js")["prepareReject"]
  >
>;

export function mapApproveOutcome(
  outcome: ApprovePrepareOutcome,
  id: string,
  correlationId: string,
): Result<ApprovalActionResult> {
  switch (outcome.kind) {
    case "dispatched": {
      const message =
        outcome.executionStatus === "succeeded"
          ? "Approved. Tool executed; agent will continue."
          : "Approved. Tool failed; see transcript.";
      log.info(
        `[ipc:vex:approvals:approve] ok id=${id} ` +
          `executionStatus=${outcome.executionStatus} ` +
          `missionRunId=${outcome.missionRunId ?? "<none>"} ` +
          `correlationId=${correlationId}`,
      );
      return ok({
        id,
        status: "approved",
        resolvedAt: outcome.resolvedAt,
        runtimeOutcome: outcome.continuation !== null ? "resumed" : "stopped",
        executionStatus: outcome.executionStatus,
        missionRunId: outcome.missionRunId,
        cached: false,
        message,
      });
    }
    case "cached_approved":
      log.info(
        `[ipc:vex:approvals:approve] cached id=${id} ` +
          `executionStatus=${outcome.executionStatus} ` +
          `correlationId=${correlationId}`,
      );
      return ok({
        id,
        status: "approved",
        resolvedAt: outcome.resolvedAt,
        runtimeOutcome: "stopped",
        executionStatus: outcome.executionStatus,
        missionRunId: outcome.missionRunId,
        cached: true,
        message: "Approval already resolved.",
      });
    case "expired":
      return err(approvalsExpiredError(correlationId, outcome.expiresAt));
    case "policy_drift_blocked":
      // B-001 — fail closed: the approved action was rejected before dispatch
      // because the live permission drifted more restrictive. Surface a
      // non-actionable error (renderer toasts "cannot proceed").
      log.warn(
        `[ipc:vex:approvals:approve] policy_drift_blocked id=${id} ` +
          `permissionAtEnqueue=${outcome.permissionAtEnqueue} ` +
          `livePermission=${outcome.livePermission} ` +
          `missionRunId=${outcome.missionRunId ?? "<none>"} ` +
          `correlationId=${correlationId}`,
      );
      return err(approvalsPolicyDriftBlockedError(correlationId));
    case "already_rejected":
      return err(
        approvalsAlreadyResolvedError(correlationId, outcome.decision),
      );
    case "run_terminated":
      return err(
        approvalsRunTerminatedError(correlationId, outcome.runStatus),
      );
  }
}

export function mapRejectOutcome(
  outcome: RejectPrepareOutcome,
  id: string,
  correlationId: string,
): Result<ApprovalActionResult> {
  switch (outcome.kind) {
    case "rejected":
      log.info(
        `[ipc:vex:approvals:reject] ok id=${id} ` +
          `missionRunId=${outcome.missionRunId ?? "<none>"} ` +
          `correlationId=${correlationId}`,
      );
      return ok({
        id,
        status: "rejected",
        resolvedAt: outcome.resolvedAt,
        runtimeOutcome:
          outcome.continuation !== null ? "resumed" : "stopped",
        executionStatus: null,
        missionRunId: outcome.missionRunId,
        cached: false,
        message: "Rejected. Agent will see the rejection in transcript.",
      });
    case "cached_rejected":
      log.info(
        `[ipc:vex:approvals:reject] cached id=${id} ` +
          `decision=${outcome.decision} correlationId=${correlationId}`,
      );
      return ok({
        id,
        status: "rejected",
        resolvedAt: outcome.resolvedAt,
        runtimeOutcome: "stopped",
        executionStatus: null,
        missionRunId: outcome.missionRunId,
        cached: true,
        message: "Approval already rejected.",
      });
    case "already_approved":
      return err(approvalsAlreadyResolvedError(correlationId, "approved"));
  }
}
