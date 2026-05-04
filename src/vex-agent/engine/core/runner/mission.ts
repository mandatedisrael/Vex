/**
 * Engine runner — mission setup, start, resume, and finalization.
 */

import {
  type TurnResult,
  type LoopMode,
  MissionRunPausedError,
  TERMINAL_RUN_STATUSES,
} from "../../types.js";
import { hydrateEngineSession } from "../hydrate.js";
import type { TurnLoopConfig } from "../turn-loop.js";
import { runTurnLoop } from "../turn-loop.js";
import { isReadyToStart } from "../../mission/validator.js";
import {
  buildMissionRunContractSnapshot,
  resolveMissionPromptContext,
} from "../../mission/run-contract.js";
import type { PromptStackOptions } from "../../prompts/index.js";
import { getOpenAITools } from "@vex-agent/tools/registry.js";
import { computeBand, type ContextUsageBand } from "../context-band.js";
import { resolveProvider } from "@vex-agent/inference/registry.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import { refreshBlobTtlForRecentMessages } from "../../wake/blob-refresh.js";
import logger from "@utils/logger.js";
import { toToolDefinitions, DEFAULT_LOOP_CONFIG } from "./shared.js";
import {
  registerMissionRunAbortController,
  unregisterMissionRunAbortController,
} from "./abort.js";
import {
  finalizeMissionRunError,
  finalizeMissionRunStatus,
} from "./mission-finalize.js";

// ── startMission ────────────────────────────────────────────────

interface MissionActivationMessageInput {
  sessionId: string;
  missionId: string;
  runId: string;
  loopMode: LoopMode;
}

async function addMissionActivationMessage(
  input: MissionActivationMessageInput,
): Promise<void> {
  const content = [
    "[Engine: mission_started — The operator accepted the mission draft and the shell activation command has already been executed.",
    "You are now inside an active mission run.",
    "Do not ask the operator to run `/mission start` or `/mission continue` again.",
    "Treat earlier setup messages asking for `/mission start` as historical context only.",
    "Execute the frozen Mission Contract now.]",
  ].join(" ");

  await messagesRepo.addEngineMessage(
    input.sessionId,
    content,
    {
      source: "engine",
      messageType: "mission_started",
      visibility: "internal",
      payload: {
        missionId: input.missionId,
        runId: input.runId,
        loopMode: input.loopMode,
      },
    },
  );
}

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

  const contractSnapshot = buildMissionRunContractSnapshot(mission);
  await missionRunsRepo.createRun(runId, missionId, sessionId, loopMode, {
    contractSnapshotJson: contractSnapshot,
  });

  const controller = registerMissionRunAbortController(runId);
  // Wrap the entire post-`createRun` block. Any throw — hydrate failure,
  // prompt prep, runTurnLoop (provider 4xx/5xx, network), even
  // finalizeMissionRunStatus — must land the run in `paused_error` instead
  // of orphaning it at `running`. Caller maps `MissionRunPausedError` into
  // `{ ok: false, error, hint }` via the shell action wrapper.
  try {
    await addMissionActivationMessage({ sessionId, missionId, runId, loopMode });

    const hydrated = await hydrateEngineSession(sessionId);
    if (!hydrated) throw new Error(`Session ${sessionId} not found`);

    // Build mission-specific prompt options.
    const missionPromptContext = contractSnapshot.missionPromptContext;

    const promptOptions: PromptStackOptions = {
      missionRunContext: {
        missionPromptContext,
        iterationCount: 0,
      },
    };

    const buildToolsForBand = (contextUsageBand: ContextUsageBand) => toToolDefinitions(getOpenAITools({
      chatMode: loopMode,
      role: "parent",
      sessionKind: "mission",
      missionRunActive: true,
      contextUsageBand,
    }));
    const tools = buildToolsForBand(computeBand(hydrated.tokenCount, config.contextLimit));

    const loopConfig: TurnLoopConfig = {
      ...DEFAULT_LOOP_CONFIG,
      contextLimit: config.contextLimit,
      buildToolsForBand,
    };

    const result = await runTurnLoop(
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

    const missionStatus = await finalizeMissionRunStatus(
      missionId,
      runId,
      sessionId,
      result.stopReason,
      result.stopPayload,
    );

    return {
      text: result.text,
      toolCallsMade: result.toolCallsMade,
      pendingApprovals: result.pendingApprovals,
      stopReason: result.stopReason,
      missionStatus,
    };
  } catch (err: unknown) {
    await finalizeMissionRunError(missionId, runId, sessionId, err);
    throw new MissionRunPausedError({ runId, missionId, sessionId, cause: err });
  } finally {
    unregisterMissionRunAbortController(runId);
  }
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
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    throw new Error(`Run ${runId} is terminal (${run.status}) — cannot resume`);
  }

  const mission = await missionsRepo.getMission(run.missionId);
  if (!mission) throw new Error(`Mission ${run.missionId} not found`);

  const controller = registerMissionRunAbortController(runId);
  // Wrap the entire resumable section. Same recovery contract as
  // `startMission`: any throw lands in `paused_error` so the operator can
  // `/retry` once the underlying issue is resolved.
  try {
    // Resume run
    await missionRunsRepo.updateStatus(runId, "running");

    // Refresh tool_output_blob TTLs on the session's recent messages so a
    // long paused_wake / paused_approval window doesn't leave the model
    // with expired overflow pointers. Idempotent — callers that already
    // refreshed (ingress preempt, wake executor) pay a cheap no-op.
    await refreshBlobTtlForRecentMessages(run.sessionId);

    const hydrated = await hydrateEngineSession(run.sessionId);
    if (!hydrated) throw new Error(`Session ${run.sessionId} not found`);

    const missionPromptContext = resolveMissionPromptContext({
      snapshot: run.contractSnapshotJson,
      fallbackMission: mission,
    });
    const promptOptions: PromptStackOptions = {
      missionRunContext: {
        missionPromptContext,
        iterationCount: run.iterationCount,
      },
    };

    // Resume — compute the band from the lagging token count so
    // warning-band tools (PR-9) are visible if the previous turn already
    // pushed the window past 80%. Turn-loop recomputes per iteration for
    // dispatch context.
    const buildToolsForBand = (contextUsageBand: ContextUsageBand) => toToolDefinitions(getOpenAITools({
      chatMode: run.loopMode,
      role: "parent",
      sessionKind: "mission",
      missionRunActive: true,
      contextUsageBand,
    }));
    const resumeBand = computeBand(hydrated.tokenCount, config.contextLimit);
    const tools = buildToolsForBand(resumeBand);

    const loopConfig: TurnLoopConfig = {
      ...DEFAULT_LOOP_CONFIG,
      contextLimit: config.contextLimit,
      buildToolsForBand,
    };

    const result = await runTurnLoop(
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

    const missionStatus = await finalizeMissionRunStatus(
      run.missionId,
      runId,
      run.sessionId,
      result.stopReason,
      result.stopPayload,
    );

    return {
      text: result.text,
      toolCallsMade: result.toolCallsMade,
      pendingApprovals: result.pendingApprovals,
      stopReason: result.stopReason,
      missionStatus,
    };
  } catch (err: unknown) {
    await finalizeMissionRunError(run.missionId, runId, run.sessionId, err);
    throw new MissionRunPausedError({
      runId,
      missionId: run.missionId,
      sessionId: run.sessionId,
      cause: err,
    });
  } finally {
    unregisterMissionRunAbortController(runId);
  }
}
