/**
 * Approvals IPC handlers — pending/get/history are read-only (allow-listed
 * DTOs only, raw `tool_call` JSONB never crosses the boundary).
 *
 * Puzzle 5 phase 3 — `approve` and `reject` are now wired. Each handler:
 *
 *   1. Calls `ensureEngineDbUrl(ctx.requestId)` so the lazy `pg` pool used
 *      by the engine reaches the same Postgres the read handlers'
 *      `withClient` paths already use (mission/start.ts pattern).
 *   2. Runs the bounded prepare path (`prepareApprove` / `prepareReject`):
 *      decision tx + post-tx side effects (dispatch / tool-result /
 *      lease+flip) + an opaque `PreparedContinuation` if a mission-run
 *      resume needs to happen in the background.
 *   3. Fires the continuation via `dispatchPreparedMission` (background)
 *      so the IPC handler returns immediately — Codex puzzle-5 phase-3
 *      review point 5: no blocking the renderer on a full resumed loop.
 *
 * A 5-minute scheduled sweep auto-rejects expired approvals even without
 * operator action. The first sweep fires right after registration so a
 * fresh app boot doesn't display a stale-pending card.
 *
 * Submodules:
 *   - `./approvals/_errors.ts`        — phase-3 `VexError` builders.
 *   - `./approvals/_map-outcomes.ts`  — outcome union → `Result` mapping.
 *   - `./approvals/_sweep.ts`         — scheduled TTL sweep helper.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, type Result } from "@shared/ipc/result.js";
import {
  approvalActionInputSchema,
  approvalActionResultSchema,
  approvalGetHistoryInputSchema,
  approvalGetInputSchema,
  approvalListPendingInputSchema,
  approvalSummaryDtoSchema,
  type ApprovalActionResult,
  type ApprovalSummaryDto,
} from "@shared/schemas/approvals.js";
import {
  getApprovalById,
  getHistoryForSession,
  listPendingForSession,
} from "../database/approvals-db.js";
import { log } from "../logger/index.js";
import { z } from "zod";
import { registerHandler } from "./register-handler.js";
import { ensureEngineDbUrl } from "./runtime/_ensure-engine-db-url.js";
import { dispatchPreparedMission } from "./mission/_engine-dispatch.js";
import {
  approvalsDispatchFailedError,
  approvalsUnexpectedError,
} from "./approvals/_errors.js";
import {
  mapApproveOutcome,
  mapRejectOutcome,
} from "./approvals/_map-outcomes.js";
import { runScheduledSweep } from "./approvals/_sweep.js";

const approvalSummaryArraySchema = z.array(approvalSummaryDtoSchema);
const approvalSummaryNullableSchema = approvalSummaryDtoSchema.nullable();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// ── Read handlers (unchanged from puzzle 1) ─────────────────────────────

function registerListPendingHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.listPending,
    domain: "approvals",
    inputSchema: approvalListPendingInputSchema,
    outputSchema: approvalSummaryArraySchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<ReadonlyArray<ApprovalSummaryDto>>> => {
      const outcome = await listPendingForSession(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:approvals:listPending] ok sessionId=${input.sessionId} ` +
            `count=${outcome.data.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return { ok: true, data: [...outcome.data] };
      }
      log.info(
        `[ipc:vex:approvals:listPending] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGetHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.get,
    domain: "approvals",
    inputSchema: approvalGetInputSchema,
    outputSchema: approvalSummaryNullableSchema,
    handle: async (input, ctx): Promise<Result<ApprovalSummaryDto | null>> => {
      const outcome = await getApprovalById(input.id);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:approvals:get] ok id=${input.id} ` +
            `present=${outcome.data !== null} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:approvals:get] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGetHistoryHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.getHistory,
    domain: "approvals",
    inputSchema: approvalGetHistoryInputSchema,
    outputSchema: approvalSummaryArraySchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<ReadonlyArray<ApprovalSummaryDto>>> => {
      const outcome = await getHistoryForSession(input.sessionId, input.limit);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:approvals:getHistory] ok sessionId=${input.sessionId} ` +
            `count=${outcome.data.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return { ok: true, data: [...outcome.data] };
      }
      log.info(
        `[ipc:vex:approvals:getHistory] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

// ── Approve handler ─────────────────────────────────────────────────────

function registerApproveHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.approve,
    domain: "approvals",
    inputSchema: approvalActionInputSchema,
    outputSchema: approvalActionResultSchema,
    handle: async (input, ctx): Promise<Result<ApprovalActionResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;

      try {
        const {
          prepareApprove,
          runResumeAfterDecision,
          ApprovalDispatchError,
          ApprovalPostDecisionError,
          ApprovalDecisionInconsistencyError,
        } = await import("@vex-agent/engine/core/approval-runtime.js");

        let outcome: Awaited<ReturnType<typeof prepareApprove>>;
        try {
          outcome = await prepareApprove(input.id);
        } catch (cause) {
          if (cause instanceof ApprovalDispatchError) {
            log.warn(
              `[ipc:vex:approvals:approve] dispatch_failed id=${input.id} ` +
                `errorKind=${cause.errorKind} errorHash=${cause.errorHash} ` +
                `correlationId=${ctx.requestId}`,
            );
            return err(approvalsDispatchFailedError(ctx.requestId));
          }
          if (cause instanceof ApprovalPostDecisionError) {
            log.warn(
              `[ipc:vex:approvals:approve] post_decision_failed id=${input.id} ` +
                `errorKind=${cause.errorKind} errorHash=${cause.errorHash} ` +
                `correlationId=${ctx.requestId}`,
            );
            return err(approvalsDispatchFailedError(ctx.requestId));
          }
          if (cause instanceof ApprovalDecisionInconsistencyError) {
            log.warn(
              `[ipc:vex:approvals:approve] decision_inconsistency id=${input.id} ` +
                `detail=${cause.detail} correlationId=${ctx.requestId}`,
            );
            return err(approvalsUnexpectedError(ctx.requestId));
          }
          throw cause;
        }

        // Dispatch background continuation when a mission resume was claimed.
        // Cached/already_*/run_terminated NEVER carry a continuation by design.
        // `policy_drift_blocked` (B-001) is a fail-closed rejection that still
        // resumes the run so the agent observes the auto-rejection.
        const continuation =
          outcome.kind === "dispatched"
            ? outcome.continuation
            : outcome.kind === "policy_drift_blocked"
              ? outcome.continuation
              : outcome.kind === "expired"
                && outcome.autoRejection.kind === "rejected"
                ? outcome.autoRejection.continuation
                : null;
        if (continuation !== null) {
          dispatchPreparedMission(
            () => runResumeAfterDecision(continuation),
            {
              sessionId: continuation.sessionId,
              missionRunId: continuation.missionRunId,
              correlationId: ctx.requestId,
              channelLabel: "vex:approvals:approve",
            },
          );
        }

        return mapApproveOutcome(outcome, input.id, ctx.requestId);
      } catch (cause) {
        log.warn(
          `[ipc:vex:approvals:approve] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(approvalsUnexpectedError(ctx.requestId));
      }
    },
  });
}

// ── Reject handler ──────────────────────────────────────────────────────

function registerRejectHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.reject,
    domain: "approvals",
    inputSchema: approvalActionInputSchema,
    outputSchema: approvalActionResultSchema,
    handle: async (input, ctx): Promise<Result<ApprovalActionResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;

      try {
        const {
          prepareReject,
          runResumeAfterDecision,
          ApprovalPostDecisionError,
          ApprovalDecisionInconsistencyError,
        } = await import("@vex-agent/engine/core/approval-runtime.js");

        let outcome: Awaited<ReturnType<typeof prepareReject>>;
        try {
          outcome = await prepareReject(input.id);
        } catch (cause) {
          if (cause instanceof ApprovalPostDecisionError) {
            log.warn(
              `[ipc:vex:approvals:reject] post_decision_failed id=${input.id} ` +
                `errorKind=${cause.errorKind} errorHash=${cause.errorHash} ` +
                `correlationId=${ctx.requestId}`,
            );
            return err(approvalsDispatchFailedError(ctx.requestId));
          }
          if (cause instanceof ApprovalDecisionInconsistencyError) {
            log.warn(
              `[ipc:vex:approvals:reject] decision_inconsistency id=${input.id} ` +
                `detail=${cause.detail} correlationId=${ctx.requestId}`,
            );
            return err(approvalsUnexpectedError(ctx.requestId));
          }
          throw cause;
        }

        if (outcome.kind === "rejected" && outcome.continuation !== null) {
          dispatchPreparedMission(
            () => runResumeAfterDecision(outcome.continuation!),
            {
              sessionId: outcome.sessionId,
              missionRunId: outcome.continuation.missionRunId,
              correlationId: ctx.requestId,
              channelLabel: "vex:approvals:reject",
            },
          );
        }

        return mapRejectOutcome(outcome, input.id, ctx.requestId);
      } catch (cause) {
        log.warn(
          `[ipc:vex:approvals:reject] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(approvalsUnexpectedError(ctx.requestId));
      }
    },
  });
}

export function registerApprovalsHandlers(): ReadonlyArray<() => void> {
  const cleanups: Array<() => void> = [
    registerListPendingHandler(),
    registerGetHandler(),
    registerGetHistoryHandler(),
    registerApproveHandler(),
    registerRejectHandler(),
  ];

  // Phase 3 scheduled TTL sweep — first cycle fires right after
  // registration (background, doesn't block boot), then every
  // SWEEP_INTERVAL_MS. Cleanup function on the handlers array clears the
  // interval on disposal.
  void runScheduledSweep();
  const sweepIntervalId = setInterval(() => {
    void runScheduledSweep();
  }, SWEEP_INTERVAL_MS);
  cleanups.push(() => clearInterval(sweepIntervalId));

  return cleanups;
}
