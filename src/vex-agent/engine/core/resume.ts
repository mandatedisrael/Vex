/**
 * Resume — approval resume and checkpoint resume.
 *
 * approveAndResume: atomically approve via approval_queue.id,
 * then dispatch the approved tool call and re-enter the turn loop.
 */

import { type TurnResult, TERMINAL_RUN_STATUSES } from "../types.js";
import * as approvalsRepo from "@vex-agent/db/repos/approvals.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import { dispatchTool } from "@vex-agent/tools/dispatcher.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import { hydrateEngineSession } from "./hydrate.js";
import { refreshBlobTtlForRecentMessages } from "@vex-agent/engine/wake/blob-refresh.js";
import logger from "@utils/logger.js";

/**
 * Approve a pending tool call and resume the engine.
 *
 * Flow:
 * 1. approvals.approve(approvalId) — atomistic CAS on approval_queue.id
 * 2. Extract toolCall + toolCallId + sessionId from the approved record
 * 3. Dispatch the tool with approved=true
 * 4. Save tool result to messages
 * 5. Update mission run status from paused_approval → running
 */
export async function approveAndResume(approvalId: string): Promise<TurnResult> {
  const approval = await approvalsRepo.approve(approvalId);
  if (!approval) {
    throw new Error(`Approval ${approvalId} not found or already resolved`);
  }

  const sessionId = approval.sessionId;
  if (!sessionId) {
    throw new Error(`Approval ${approvalId} has no associated session`);
  }

  // Defensive: a concurrent operator-driven `abortMissionRun` could have
  // finalised the run between our approval CAS and dispatch. The CAS in
  // `approvalsRepo.approve` catches an approval that the abort had already
  // rejected; this catches the narrower window where abort hadn't yet
  // visited the queue but had already finalised the run. Without this,
  // dispatch would execute a tool against a cancelled mission.
  //
  // `getRunBySession` returns the most recent run regardless of status —
  // `getActiveRunBySession` filters terminal out, which is exactly the case
  // we need to detect here. We also gate on `endedAt > approval.createdAt`
  // so an old terminal mission run on the same session does not block an
  // unrelated newer chat approval (approvals are session-scoped, not
  // run-scoped, until the schema carries `mission_run_id`).
  const recentRunForGuard = await missionRunsRepo.getRunBySession(sessionId);
  if (
    recentRunForGuard &&
    TERMINAL_RUN_STATUSES.has(recentRunForGuard.status) &&
    recentRunForGuard.endedAt !== null &&
    recentRunForGuard.endedAt > approval.createdAt
  ) {
    throw new Error(
      `Approval ${approvalId} cannot be applied: mission run ${recentRunForGuard.id} is ${recentRunForGuard.status}`,
    );
  }

  // Refresh tool_output_blob TTLs before dispatching the approved tool. A
  // long paused_approval window could otherwise leave blobs referenced by
  // recent messages expired, and the dispatched tool (or a follow-up turn)
  // may need to read them. Idempotent; the mission branch below re-enters
  // `resumeMissionRun` which refreshes again — cheap no-op. Covers the
  // chat-approval branch too, which doesn't delegate to a runner.
  await refreshBlobTtlForRecentMessages(sessionId);

  // approval.toolCall is the JSONB object stored at enqueue time
  // approval.toolCallId is the tool_call_id column (round-trip identifier)
  // approval.pendingContext may contain { toolCallId } for extra context
  const toolCall = approval.toolCall;
  const toolCallId = approval.toolCallId
    ?? (approval.pendingContext as Record<string, unknown> | null)?.toolCallId as string
    ?? approvalId;

  // Extract tool name and args from the stored toolCall object
  // Shape depends on enqueue caller: {command, args} or {name, args}
  const toolName = (toolCall.command ?? toolCall.name) as string;
  const toolArgs = (toolCall.args ?? toolCall.arguments ?? {}) as Record<string, unknown>;

  if (!toolName) {
    throw new Error(`Approval ${approvalId} has no tool name in toolCall record`);
  }

  logger.info("engine.resume.approve", { approvalId, sessionId, toolName, toolCallId });

  // loadedDocuments is ephemeral — not persisted across approval pauses.
  // The agent can re-read documents via document_read after resume.
  const toolContext: InternalToolContext = {
    sessionId,
    loadedDocuments: new Map(),
    loopMode: (approval.chatMode as "full" | "restricted" | "off") ?? "restricted",
    approved: true,
    role: "parent", // Approval resume is always parent context
    missionRunId: null, // Will be populated from hydrated context if needed
    missionId: null, // Will be populated by the resumed loop when needed
    // Approval resume dispatches a single tool call — band recomputation
    // happens at the next turn-loop iteration. Safe default for one-shot dispatch.
    sessionKind: "chat",
    contextUsageBand: "normal",
    sourceSurface: "vex_agent",
    sourceSession: sessionId,
  };

  const result = await dispatchTool(
    { name: toolName, args: toolArgs, toolCallId },
    toolContext,
  );

  await messagesRepo.addMessage(
    sessionId,
    {
      role: "tool",
      content: result.output,
      toolCallId,
      timestamp: new Date().toISOString(),
    },
    { source: "tool", messageType: "tool_result", visibility: "internal", payload: { success: result.success } },
  );

  // Resume mission run — re-enter turn loop
  const hydrated = await hydrateEngineSession(sessionId);
  const missionRunId = hydrated?.context.missionRunId ?? null;

  if (missionRunId) {
    await missionRunsRepo.updateStatus(missionRunId, "running");
    logger.info("engine.resume.re_entering_loop", { missionRunId, approvalId });

    // Lazy import to avoid circular dependency (resume → runner → resume)
    const { resumeMissionRun } = await import("./runner.js");
    return resumeMissionRun(missionRunId);
  }

  // No mission run — return tool result as chat response
  return {
    text: result.output,
    toolCallsMade: 1,
    pendingApprovals: [],
    stopReason: null,
    missionStatus: null,
  };
}
