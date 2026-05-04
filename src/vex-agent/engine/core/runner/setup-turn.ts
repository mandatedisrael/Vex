/**
 * Mission setup turn — runs while the operator is still describing the
 * mission. Distinct from `startMission` / `resumeMissionRun` because:
 *   - `missionRunId` is null (no run row yet — turn-loop uses this to mean
 *     "stop on text" instead of "continue autonomously").
 *   - Throws are intentionally surfaced as plain chat errors; there is no
 *     `paused_error` route here because there is no run row to flip.
 *     `editMissionDraft` / `/mission edit` already provide the recovery.
 */

import {
  type TurnResult,
  type MissionStatus,
} from "../../types.js";
import { hydrateEngineSession } from "../hydrate.js";
import type { TurnLoopConfig } from "../turn-loop.js";
import { runTurnLoop } from "../turn-loop.js";
import {
  applyMissionPatch,
  createMissionDraft,
  formatMissionDraftNotReadyNotice,
  getMissionSetupState,
  textSuggestsMissionStart,
} from "../../mission/setup.js";
import { parseModelMissionOutput } from "../../mission/patch-parser.js";
import type { PromptStackOptions } from "../../prompts/index.js";
import { getOpenAITools } from "@vex-agent/tools/registry.js";
import { computeBand, type ContextUsageBand } from "../context-band.js";
import { resolveProvider } from "@vex-agent/inference/registry.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import logger from "@utils/logger.js";
import { toToolDefinitions, DEFAULT_LOOP_CONFIG } from "./shared.js";

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

  const buildToolsForBand = (contextUsageBand: ContextUsageBand) => toToolDefinitions(getOpenAITools({
    chatMode: "off",
    role: "parent",
    sessionKind: "mission",
    missionRunActive: false, // setup — no run yet
    contextUsageBand,
  }));
  const tools = buildToolsForBand(computeBand(hydrated.tokenCount, config.contextLimit));

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    // Setup runs research tool-calls before applying mission patch; 15 fits
    // 3-4 tool-call paths plus clarifying Q&A. Mission-run's
    // DEFAULT_LOOP_CONFIG.maxIterations=50 still dominates actual execution.
    maxIterations: 15,
    contextLimit: config.contextLimit,
    buildToolsForBand,
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

  // Re-read mission status after potential patch. The DB state is the source
  // of truth; prose in the assistant response is not allowed to imply that a
  // mission can start unless the structured draft update made it ready.
  const latestSetupState = await getMissionSetupState(missionId);
  const missionStatus = (latestSetupState?.status ?? "draft") as MissionStatus;
  let text = result.text;
  if (
    latestSetupState
    && latestSetupState.status !== "ready"
    && textSuggestsMissionStart(text)
  ) {
    const notice = formatMissionDraftNotReadyNotice(latestSetupState);
    text = text ? `${text}\n\n${notice}` : notice;
    await messagesRepo.addEngineMessage(
      sessionId,
      notice,
      {
        source: "engine",
        messageType: "mission_setup",
        visibility: "internal",
        payload: {
          missionId,
          status: latestSetupState.status,
          missingFields: latestSetupState.missingFields,
          correction: "db_not_ready_start_suggestion",
        },
      },
    );
  }

  return {
    text,
    toolCallsMade: result.toolCallsMade,
    pendingApprovals: [],
    stopReason: null,
    missionStatus,
  };
}
