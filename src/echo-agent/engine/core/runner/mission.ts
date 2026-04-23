/**
 * Engine runner — mission setup, start, resume, and finalization.
 */

import type { TurnResult, MissionStatus, LoopMode, StopReason } from "../../types.js";
import { hydrateEngineSession } from "../hydrate.js";
import type { TurnLoopConfig } from "../turn-loop.js";
import { runTurnLoop } from "../turn-loop.js";
import { isReadyToStart } from "../../mission/validator.js";
import { freezeDraft, draftToPromptContext } from "../../mission/mapper.js";
import { applyMissionPatch, createMissionDraft, getMissionSetupState } from "../../mission/setup.js";
import { parseModelMissionOutput } from "../../mission/patch-parser.js";
import type { PromptStackOptions } from "../../prompts/index.js";
import { getOpenAITools } from "@echo-agent/tools/registry.js";
import { computeBand } from "../context-band.js";
import { resolveProvider } from "@echo-agent/inference/registry.js";
import * as missionsRepo from "@echo-agent/db/repos/missions.js";
import * as missionRunsRepo from "@echo-agent/db/repos/mission-runs.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import { refreshBlobTtlForRecentMessages } from "../../wake/blob-refresh.js";
import logger from "@utils/logger.js";
import { toToolDefinitions, DEFAULT_LOOP_CONFIG } from "./shared.js";
import {
  registerMissionRunAbortController,
  unregisterMissionRunAbortController,
} from "./abort.js";

// ── processMissionSetupTurn ─────────────────────────────────────

/**
 * Process a mission setup turn. User provides mission info → engine
 * updates draft and reports missing fields.
 */
export async function processMissionSetupTurn(
  sessionId: string,
  userInput: string,
): Promise<TurnResult> {
  logger.info("engine.mission.setup_turn", { sessionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  // Save user message
  await messagesRepo.addMessage(
    sessionId,
    { role: "user", content: userInput, timestamp: new Date().toISOString() },
    { source: "user", messageType: "mission_setup", visibility: "user" },
  );

  // Hydrate
  const hydrated = await hydrateEngineSession(sessionId);
  if (!hydrated) throw new Error(`Session ${sessionId} not found`);

  // Ensure mission draft exists — auto-create if not
  let missionId = hydrated.context.missionId;
  if (!missionId) {
    const setupResult = await createMissionDraft(sessionId);
    missionId = setupResult.missionId;
    logger.info("engine.mission.draft_created", { sessionId, missionId });
  }

  // Get current setup state for prompt context
  const setupState = await getMissionSetupState(missionId);

  // Setup uses sessionKind: "mission" so mission-setup prompt is included,
  // but missionRunId stays null — turn-loop uses missionRunId to distinguish
  // setup (ends on text) from run (continues autonomously).
  const setupContext = {
    ...hydrated.context,
    sessionKind: "mission" as const,
    loopMode: "off" as const,
    missionId,
    missionRunId: null,
  };

  const tools = toToolDefinitions(getOpenAITools({
    chatMode: "off",
    role: "parent",
    sessionKind: "mission",
    missionRunActive: false, // setup — no run yet
    contextUsageBand: "normal",
  }));

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    maxIterations: 5, // Setup can use a few tool calls for research
    contextLimit: config.contextLimit,
  };

  const promptOptions: PromptStackOptions = {
    missionSetupContext: setupState ? {
      currentDraft: setupState.currentDraft,
      missingFields: setupState.missingFields,
    } : undefined,
  };

  const result = await runTurnLoop(
    setupContext,
    hydrated.messages,
    hydrated.summary,
    hydrated.tokenCount,
    provider,
    config,
    tools,
    loopConfig,
    promptOptions,
  );

  // Apply mission patch from model response to draft
  if (result.text && missionId) {
    const parsed = parseModelMissionOutput(result.text);
    if (parsed) {
      await applyMissionPatch(missionId, parsed);
    }
  }

  // Re-read mission status after potential patch
  const mission = await missionsRepo.getMission(missionId);
  const missionStatus = mission?.status as MissionStatus ?? "draft";

  return {
    text: result.text,
    toolCallsMade: result.toolCallsMade,
    pendingApprovals: [],
    stopReason: null,
    missionStatus,
  };
}

// ── startMission ────────────────────────────────────────────────

/**
 * Start a mission — validate, freeze, create run, enter turn loop.
 */
export async function startMission(
  missionId: string,
  loopMode: LoopMode = "restricted",
): Promise<TurnResult> {
  logger.info("engine.mission.start", { missionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  // Load and validate
  const mission = await missionsRepo.getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found`);

  if (!isReadyToStart(mission)) {
    throw new Error(`Mission ${missionId} is not ready — missing required fields`);
  }

  // Guard: no overlapping active runs
  const existingRun = await missionRunsRepo.getActiveRun(missionId);
  if (existingRun) {
    throw new Error(`Mission ${missionId} already has an active run: ${existingRun.id}`);
  }

  // Transition: ready → running
  await missionsRepo.setStatus(missionId, "running");
  await missionsRepo.setApprovedAt(missionId);

  // Create run
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = mission.rootSessionId;

  await missionRunsRepo.createRun(runId, missionId, sessionId, loopMode);

  // Hydrate with fresh state
  const hydrated = await hydrateEngineSession(sessionId);
  if (!hydrated) throw new Error(`Session ${sessionId} not found`);

  // Build mission-specific prompt options
  const frozenMission = freezeDraft(mission);
  const missionPromptContext = draftToPromptContext(mission);

  const promptOptions: PromptStackOptions = {
    missionRunContext: {
      missionPromptContext,
      iterationCount: 0,
    },
  };

  const tools = toToolDefinitions(getOpenAITools({
    chatMode: loopMode,
    role: "parent",
    sessionKind: "mission",
    missionRunActive: true,
    contextUsageBand: "normal", // fresh start — no prior pressure
  }));

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    contextLimit: config.contextLimit,
  };

  const controller = registerMissionRunAbortController(runId);
  let result;
  try {
    result = await runTurnLoop(
      { ...hydrated.context, missionRunId: runId, loopMode, sessionKind: "mission" },
      hydrated.messages,
      hydrated.summary,
      hydrated.tokenCount,
      provider,
      config,
      tools,
      loopConfig,
      promptOptions,
      controller.signal,
    );
  } finally {
    unregisterMissionRunAbortController(runId);
  }

  const missionStatus = await finalizeMissionRunStatus(missionId, runId, result.stopReason, result.stopPayload);

  return {
    text: result.text,
    toolCallsMade: result.toolCallsMade,
    pendingApprovals: result.pendingApprovals,
    stopReason: result.stopReason,
    missionStatus,
  };
}

// ── resumeMissionRun ────────────────────────────────────────────

/**
 * Resume a mission run after checkpoint or restart.
 */
export async function resumeMissionRun(
  runId: string,
): Promise<TurnResult> {
  logger.info("engine.mission.resume", { runId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  const run = await missionRunsRepo.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  // Guard: cannot resume terminal runs. `cancelled` is included so an
  // operator-driven `abortMissionRun` is permanent — without this guard a
  // late approval/resume could revive a run the operator had finalised.
  const terminalStatuses = new Set(["completed", "failed", "stopped", "cancelled"]);
  if (terminalStatuses.has(run.status)) {
    throw new Error(`Run ${runId} is terminal (${run.status}) — cannot resume`);
  }

  const mission = await missionsRepo.getMission(run.missionId);
  if (!mission) throw new Error(`Mission ${run.missionId} not found`);

  // Resume run
  await missionRunsRepo.updateStatus(runId, "running");

  // Refresh tool_output_blob TTLs on the session's recent messages so a
  // long paused_wake / paused_approval window doesn't leave the model with
  // expired overflow pointers. Idempotent — callers that already refreshed
  // (ingress preempt, wake executor) pay a cheap no-op. Non-fatal on error.
  await refreshBlobTtlForRecentMessages(run.sessionId);

  const hydrated = await hydrateEngineSession(run.sessionId);
  if (!hydrated) throw new Error(`Session ${run.sessionId} not found`);

  const missionPromptContext = draftToPromptContext(mission);
  const promptOptions: PromptStackOptions = {
    missionRunContext: {
      missionPromptContext,
      iterationCount: run.iterationCount,
    },
  };

  // Resume — compute the band from the lagging token count so warning-band
  // tools (PR-9) are visible if the previous turn already pushed the window
  // past 80%. Turn-loop recomputes per iteration for dispatch context.
  const resumeBand = computeBand(hydrated.tokenCount, config.contextLimit);
  const tools = toToolDefinitions(getOpenAITools({
    chatMode: run.loopMode,
    role: "parent",
    sessionKind: "mission",
    missionRunActive: true,
    contextUsageBand: resumeBand,
  }));

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    contextLimit: config.contextLimit,
  };

  const controller = registerMissionRunAbortController(runId);
  let result;
  try {
    result = await runTurnLoop(
      { ...hydrated.context, missionRunId: runId, loopMode: run.loopMode, sessionKind: "mission" },
      hydrated.messages,
      hydrated.summary,
      hydrated.tokenCount,
      provider,
      config,
      tools,
      loopConfig,
      promptOptions,
      controller.signal,
    );
  } finally {
    unregisterMissionRunAbortController(runId);
  }

  const missionStatus = await finalizeMissionRunStatus(run.missionId, runId, result.stopReason, result.stopPayload);

  return {
    text: result.text,
    toolCallsMade: result.toolCallsMade,
    pendingApprovals: result.pendingApprovals,
    stopReason: result.stopReason,
    missionStatus,
  };
}

// ── Shared helpers ──────────────────────────────────────────────

/**
 * Finalize mission + run status based on stop reason.
 * Business stops → mission completed/cancelled, run terminated.
 * Runtime stops (iteration_limit, timeout) → mission failed, run failed.
 * Approval pause → run paused (already handled in turn-loop).
 * No stop → running.
 */
async function finalizeMissionRunStatus(
  missionId: string,
  runId: string,
  stopReason: StopReason | null,
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> },
): Promise<MissionStatus> {
  if (!stopReason) return "running";

  const { shouldTerminateRun } = await import("../stop-conditions.js");

  if (shouldTerminateRun(stopReason)) {
    const status: MissionStatus = stopReason === "user_stopped" ? "cancelled" : "completed";
    await missionsRepo.setStatus(missionId, status);
    await missionRunsRepo.updateStatus(runId, status, stopReason, stopPayload);
    return status;
  }

  if (stopReason === "iteration_limit" || stopReason === "timeout" || stopReason === "system_error") {
    await missionsRepo.setStatus(missionId, "failed");
    await missionRunsRepo.updateStatus(runId, "failed", stopReason);
    return "failed";
  }

  return "running";
}
