/**
 * Direct tool invocation — bypasses the LLM. Used by power-user / debug
 * surfaces (shell settings panel) to exercise a handler with explicit args.
 *
 * Builds a minimal but real `InternalToolContext` from the session row + any
 * active mission run, then calls `dispatchTool`. The result is a normal
 * `ToolResult` — no approval queue, no turn-loop deferred save. Caller
 * decides whether to persist to `messages`.
 *
 * **Security**: direct invoke is inherently privileged (operator intent).
 * `approved: true` is set so mutating tools do not get queued for approval.
 * Do not expose this behind an unauthenticated surface.
 */

import type { ToolResult } from "../../tools/types.js";
import type { InternalToolContext } from "../../tools/internal/types.js";
import { buildSessionWalletResolution, resolveWalletPolicy } from "./hydrate.js";
import { dispatchTool } from "../../tools/dispatcher.js";
import * as sessionsRepo from "../../db/repos/sessions.js";
import * as missionRunsRepo from "../../db/repos/mission-runs.js";
import * as missionsRepo from "../../db/repos/missions.js";
import { computeBand } from "./context-band.js";
import logger from "../../../utils/logger.js";

const DEFAULT_CONTEXT_LIMIT = 128_000;

/**
 * Invoke an internal / protocol tool directly by name with structured args.
 *
 * Returns a `ToolResult` (same shape the LLM would receive). Throws only
 * when `sessionId` does not exist — tool-level failures are captured in
 * `result.success = false` per the dispatcher contract.
 */
export async function runTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const session = await sessionsRepo.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const activeRun = await missionRunsRepo.getActiveRunBySession(sessionId);
  const mission = activeRun ? null : await missionsRepo.getActiveMission(sessionId);
  const missionId = activeRun?.missionId ?? mission?.id ?? null;
  const sessionKind = missionId ? "mission" : session.mode;

  const context: InternalToolContext = {
    sessionId,
    loadedDocuments: new Map(),
    sessionPermission: session.permission,
    approved: true,
    role: "parent",
    missionRunId: activeRun?.id ?? null,
    missionId,
    sessionKind,
    contextUsageBand: computeBand(session.tokenCount, DEFAULT_CONTEXT_LIMIT),
    sourceSurface: "vex_agent",
    sourceSession: sessionId,
    walletResolution: buildSessionWalletResolution(session),
    walletPolicy: resolveWalletPolicy(mission, activeRun),
  };

  const toolCallId = `direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  logger.info("engine.run_tool.begin", {
    sessionId,
    tool: name,
    missionRunId: context.missionRunId,
  });

  const result = await dispatchTool({ name, args, toolCallId }, context);

  logger.info("engine.run_tool.completed", {
    sessionId,
    tool: name,
    success: result.success,
    pendingApproval: result.pendingApproval ?? false,
  });

  return result;
}
