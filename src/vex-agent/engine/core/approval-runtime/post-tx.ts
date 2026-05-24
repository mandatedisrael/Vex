/**
 * Approval runtime — post-tx side effects (dispatch / tool-result /
 * lease+flip / continuation claim).
 *
 * The snapshot tx in `./snapshot.ts` commits the queue+intent decision; the
 * functions here run AFTER that tx so an audit-write or dispatch failure
 * cannot roll back the decision itself. To prevent stranding the mission
 * run in `paused_approval` (decision resolved but no post-tx work
 * completed), every post-decision side effect is wrapped so a failure
 * explicitly flips the run to `paused_error` with audit evidence — the
 * operator can `/retry` to recover.
 *
 * Dispatch error categories (Codex puzzle-5 phase-3 review points 1 + 3 + 8):
 *   - controlled (`success:false`)            → tool-result with output,
 *                                               mission resumes via
 *                                               continuation.
 *   - unhandled dispatch throw                → mission flipped to
 *                                               `paused_error`, NO
 *                                               continuation, throws
 *                                               `ApprovalDispatchError`.
 *   - post-dispatch persistence failure       → mission flipped to
 *                                               `paused_error`, throws
 *                                               `ApprovalPostDecisionError`.
 *   - lease claim returns null (busy/mismatch)→ mission flipped to
 *                                               `paused_error`, throws
 *                                               `ApprovalPostDecisionError`.
 *
 * Transcript content for dispatch failures is structural-only (errorKind +
 * errorHash). Raw / redacted error message text is intentionally absent —
 * tool/protocol/wallet errors can carry secrets the agent should not see.
 */

import * as approvalIntentsRepo from "../../../db/repos/approval-intents.js";
import * as missionRunsRepo from "../../../db/repos/mission-runs.js";
import { dispatchTool } from "../../../tools/dispatcher.js";
import type { InternalToolContext } from "../../../tools/internal/types.js";
import { buildSessionWalletResolution, hydrateEngineSession } from "../hydrate.js";
import type { WalletResolution } from "@tools/wallet/multi-auth.js";
import type { WalletPolicy } from "@vex-agent/engine/types.js";
import { appendMessage } from "../../events/index.js";
import { refreshBlobTtlForRecentMessages } from "../../wake/blob-refresh.js";
import logger from "@utils/logger.js";

import { claimResumeContinuation } from "./continuation.js";
import {
  buildDispatchFailedToolResultContent,
  extractToolCall,
  shortSha256,
  summarizeErrorForLog,
  toIsoNow,
  TOOL_RESULT_EXPIRED_REASON,
} from "./helpers.js";
import type { ApproveSnapshot, RejectSnapshot } from "./snapshot.js";
import {
  ApprovalDispatchError,
  ApprovalPostDecisionError,
  type ApprovePrepareOutcome,
  type PreparedContinuation,
  type RejectPrepareOutcome,
} from "./types.js";

const RESUME_CLAIM_ERROR_KIND = "ResumeClaimFailed";

/**
 * Transition the mission run to `paused_error` after a committed-decision
 * side effect fails. Best-effort: if the status update itself throws, log
 * structurally and continue — the original failure is already being
 * surfaced via the caller's thrown error.
 */
async function flipRunToPausedError(
  approvalId: string,
  missionRunId: string,
  errorKind: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  try {
    await missionRunsRepo.updateStatus(
      missionRunId,
      "paused_error",
      "approval_post_decision",
      { evidence: { approvalId, errorKind, ...evidence } },
    );
  } catch (statusErr) {
    logger.warn("engine.approval_runtime.paused_error_update_failed", {
      approvalId,
      missionRunId,
      errorKind:
        statusErr instanceof Error
          ? statusErr.constructor.name
          : typeof statusErr,
    });
  }
}

/**
 * Side effects after `approved_in_tx` snapshot — dispatch the tool, write
 * the tool-result, mark execution_status, claim+flip the mission run,
 * return the IPC-facing outcome.
 */
export async function applyApproveSideEffects(
  approvalId: string,
  snapshot: Extract<ApproveSnapshot, { type: "approved_in_tx" }>,
): Promise<ApprovePrepareOutcome> {
  const row = snapshot.row;
  const sessionId = row.session_id;
  const missionRunId = row.mission_run_id;
  const fallbackToolCallId =
    row.queue_tool_call_id ?? row.tool_call_id ?? approvalId;

  const toolCall = extractToolCall(row.queue_tool_call, fallbackToolCallId);

  try {
    await approvalIntentsRepo.markExecutionStatus(approvalId, "dispatching");

    // Refresh blob TTLs before dispatch (mirror legacy approveAndResume) — a
    // long paused window can expire blobs referenced by recent messages.
    await refreshBlobTtlForRecentMessages(sessionId);

    // Wallet scope for the resumed dispatch: hydrate the session so a resumed
    // wallet_send_confirm signs with the session's selected wallet under the
    // mission policy, never the primary. Cold approval-resume path.
    const walletHydrated = await hydrateEngineSession(sessionId);
    const walletResolution: WalletResolution = walletHydrated
      ? buildSessionWalletResolution(walletHydrated.context)
      : { source: "session", evm: null, solana: null };
    const walletPolicy: WalletPolicy = walletHydrated?.context.walletPolicy
      ?? { kind: "invalid", reason: "session_unavailable" };

    const toolContext: InternalToolContext = {
      sessionId,
      loadedDocuments: new Map(),
      sessionPermission: row.queue_permission_at_enqueue,
      approved: true,
      role: "parent",
      missionRunId,
      missionId: null,
      sessionKind: "agent",
      contextUsageBand: "normal",
      sourceSurface: "vex_agent",
      sourceSession: sessionId,
      walletResolution,
      walletPolicy,
    };

    let dispatchResult: { success: boolean; output: string };
    try {
      dispatchResult = await dispatchTool(
        {
          name: toolCall.toolName,
          args: toolCall.toolArgs,
          toolCallId: toolCall.toolCallId,
        },
        toolContext,
      );
    } catch (cause) {
      await onDispatchThrow(
        approvalId,
        sessionId,
        missionRunId,
        toolCall.toolCallId,
        cause,
      );
      // unreachable — onDispatchThrow always throws ApprovalDispatchError
      throw new Error("unreachable");
    }

    const resultHash = shortSha256(
      JSON.stringify({
        success: dispatchResult.success,
        output: dispatchResult.output,
      }),
    );
    await approvalIntentsRepo.markExecutionStatus(
      approvalId,
      dispatchResult.success ? "succeeded" : "failed",
      resultHash,
    );

    await appendMessage(
      sessionId,
      {
        role: "tool",
        content: dispatchResult.output,
        toolCallId: toolCall.toolCallId,
        timestamp: toIsoNow(),
      },
      {
        source: "tool",
        messageType: "tool_result",
        visibility: "internal",
        payload: { success: dispatchResult.success },
      },
    );

    let continuation: PreparedContinuation | null = null;
    if (missionRunId !== null) {
      continuation = await claimResumeContinuation(
        sessionId,
        missionRunId,
        `approve-${approvalId}`,
      );
      if (continuation === null) {
        // Lease claim returned `lease_busy` or `status_mismatch` — the run
        // is stranded in `paused_approval` with a resolved approval. Flip to
        // `paused_error` so /retry can recover.
        throw new ApprovalPostDecisionError(
          approvalId,
          RESUME_CLAIM_ERROR_KIND,
          shortSha256("resume_claim_failed"),
        );
      }
    }

    return {
      kind: "dispatched",
      approvalId,
      resolvedAt: snapshot.queueResolvedAt,
      executionStatus: dispatchResult.success ? "succeeded" : "failed",
      sessionId,
      missionRunId,
      continuation,
      toolResult: {
        success: dispatchResult.success,
        output: dispatchResult.output,
      },
    };
  } catch (cause) {
    if (cause instanceof ApprovalDispatchError) throw cause;
    if (cause instanceof ApprovalPostDecisionError) {
      if (missionRunId !== null) {
        await flipRunToPausedError(
          approvalId,
          missionRunId,
          cause.errorKind,
          { errorHash: cause.errorHash },
        );
      }
      throw cause;
    }
    // Unhandled post-tx persistence failure (markExecutionStatus /
    // appendMessage / blob-refresh threw). Flip the run to `paused_error`
    // and surface as ApprovalPostDecisionError so IPC can return a safe
    // `approvals.dispatch_failed` error.
    const errSummary = summarizeErrorForLog(cause);
    logger.warn("engine.approval_runtime.post_decision_failed", {
      approvalId,
      sessionId,
      missionRunId,
      errorKind: errSummary.errorKind,
      errorHash: errSummary.errorHash,
    });
    if (missionRunId !== null) {
      await flipRunToPausedError(approvalId, missionRunId, errSummary.errorKind, {
        errorHash: errSummary.errorHash,
      });
    }
    throw new ApprovalPostDecisionError(
      approvalId,
      errSummary.errorKind,
      errSummary.errorHash,
    );
  }
}

async function onDispatchThrow(
  approvalId: string,
  sessionId: string,
  missionRunId: string | null,
  toolCallId: string,
  cause: unknown,
): Promise<never> {
  const errSummary = summarizeErrorForLog(cause);
  // Structural log only — never the raw message or cause.
  logger.warn("engine.approval_runtime.dispatch_threw", {
    approvalId,
    sessionId,
    missionRunId,
    errorKind: errSummary.errorKind,
    errorHash: errSummary.errorHash,
  });

  await approvalIntentsRepo.markExecutionStatus(
    approvalId,
    "failed",
    errSummary.errorHash,
  );

  // Transcript content is structural-only (Codex point 3) — tool/protocol/
  // wallet error messages can carry secrets that must never reach the agent.
  await appendMessage(
    sessionId,
    {
      role: "tool",
      content: buildDispatchFailedToolResultContent(
        errSummary.errorKind,
        errSummary.errorHash,
      ),
      toolCallId,
      timestamp: toIsoNow(),
    },
    {
      source: "tool",
      messageType: "tool_result",
      visibility: "internal",
      payload: { success: false, dispatchError: true },
    },
  );

  if (missionRunId !== null) {
    await flipRunToPausedError(approvalId, missionRunId, errSummary.errorKind, {
      errorHash: errSummary.errorHash,
      cause: "dispatch_threw",
    });
  }

  throw new ApprovalDispatchError(
    approvalId,
    errSummary.errorKind,
    errSummary.errorHash,
  );
}

/**
 * Side effects after `rejected_in_tx` snapshot — write the rejection
 * tool-result to transcript, optionally claim+flip the mission run, return
 * the IPC outcome.
 *
 * `toolResultContent` is built by the caller because the reject path and
 * the expire path render different messages even though the snapshot type
 * is the same.
 */
export async function applyRejectSideEffects(
  approvalId: string,
  snapshot: Extract<RejectSnapshot, { type: "rejected_in_tx" }>,
  toolResultContent: string,
): Promise<RejectPrepareOutcome> {
  const row = snapshot.row;
  const sessionId = row.session_id;
  const missionRunId = row.mission_run_id;
  const toolCallId =
    row.queue_tool_call_id ?? row.tool_call_id ?? approvalId;

  try {
    await refreshBlobTtlForRecentMessages(sessionId);

    await appendMessage(
      sessionId,
      {
        role: "tool",
        content: toolResultContent,
        toolCallId,
        timestamp: toIsoNow(),
      },
      {
        source: "tool",
        messageType: "tool_result",
        visibility: "internal",
        payload: { success: false, rejected: true },
      },
    );

    let continuation: PreparedContinuation | null = null;
    if (missionRunId !== null) {
      const ownerPrefix =
        snapshot.reason === TOOL_RESULT_EXPIRED_REASON ? "expire" : "reject";
      continuation = await claimResumeContinuation(
        sessionId,
        missionRunId,
        `${ownerPrefix}-${approvalId}`,
      );
      if (continuation === null) {
        throw new ApprovalPostDecisionError(
          approvalId,
          RESUME_CLAIM_ERROR_KIND,
          shortSha256("resume_claim_failed"),
        );
      }
    }

    return {
      kind: "rejected",
      approvalId,
      resolvedAt: snapshot.queueResolvedAt,
      sessionId,
      missionRunId,
      reason: snapshot.reason,
      continuation,
    };
  } catch (cause) {
    if (cause instanceof ApprovalPostDecisionError) {
      if (missionRunId !== null) {
        await flipRunToPausedError(
          approvalId,
          missionRunId,
          cause.errorKind,
          { errorHash: cause.errorHash, reason: snapshot.reason },
        );
      }
      throw cause;
    }
    const errSummary = summarizeErrorForLog(cause);
    logger.warn("engine.approval_runtime.post_decision_failed", {
      approvalId,
      sessionId,
      missionRunId,
      errorKind: errSummary.errorKind,
      errorHash: errSummary.errorHash,
      side: "reject",
    });
    if (missionRunId !== null) {
      await flipRunToPausedError(
        approvalId,
        missionRunId,
        errSummary.errorKind,
        { errorHash: errSummary.errorHash, reason: snapshot.reason },
      );
    }
    throw new ApprovalPostDecisionError(
      approvalId,
      errSummary.errorKind,
      errSummary.errorHash,
    );
  }
}
