/**
 * Resume — approval resume and checkpoint resume.
 *
 * approveAndResume: atomically approve via approval_queue.id,
 * then dispatch the approved tool call and re-enter the turn loop.
 */

import type { TurnResult } from "../types.js";
import * as approvalsRepo from "@echo-agent/db/repos/approvals.js";
import * as missionRunsRepo from "@echo-agent/db/repos/mission-runs.js";
import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import type { InternalToolContext } from "@echo-agent/tools/internal/types.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import { hydrateEngineSession } from "./hydrate.js";
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
    { source: "tool", messageType: "tool_result", visibility: "internal" },
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
