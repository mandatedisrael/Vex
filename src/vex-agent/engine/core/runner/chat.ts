/**
 * Engine runner — chat turn entry point.
 */

import type { TurnResult } from "../../types.js";
import { hydrateEngineSession } from "../hydrate.js";
import type { TurnLoopConfig } from "../turn-loop.js";
import { runTurnLoop } from "../turn-loop.js";
import { getOpenAITools } from "@vex-agent/tools/registry.js";
import { computeBand, type ContextUsageBand } from "../context-band.js";
import { resolveProvider } from "@vex-agent/inference/registry.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import logger from "@utils/logger.js";
import { toToolDefinitions, DEFAULT_LOOP_CONFIG } from "./shared.js";

// ── processChatTurn ─────────────────────────────────────────────

/**
 * Process a single chat turn. User sends message → engine responds.
 * For sessionKind=chat, loopMode=off.
 */
export async function processChatTurn(
  sessionId: string,
  userInput: string,
): Promise<TurnResult> {
  logger.info("engine.chat.turn", { sessionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  // Save user message
  await messagesRepo.addMessage(
    sessionId,
    { role: "user", content: userInput, timestamp: new Date().toISOString() },
    { source: "user", messageType: "chat", visibility: "user" },
  );

  // Hydrate
  const hydrated = await hydrateEngineSession(sessionId);
  if (!hydrated) throw new Error(`Session ${sessionId} not found`);

  // Force chat semantics — even if session has a mission attached
  const chatContext = { ...hydrated.context, sessionKind: "chat" as const, loopMode: "off" as const };

  const buildToolsForBand = (contextUsageBand: ContextUsageBand) => toToolDefinitions(getOpenAITools({
    chatMode: "off",
    role: "parent",
    sessionKind: "chat",
    missionRunActive: false,
    contextUsageBand,
  }));
  const tools = buildToolsForBand(computeBand(hydrated.tokenCount, config.contextLimit));

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    // Chat iterates through tool-call rounds until the model emits a final text
    // reply; turn-loop.ts:367 breaks on text for sessionKind="chat", so this cap
    // only engages when the model loops on tool-calls without ever summarising.
    maxIterations: 10,
    contextLimit: config.contextLimit,
    buildToolsForBand,
  };

  const result = await runTurnLoop(
    chatContext,
    hydrated.messages,
    hydrated.summary,
    hydrated.tokenCount,
    provider,
    config,
    tools,
    loopConfig,
  );

  return {
    text: result.text,
    toolCallsMade: result.toolCallsMade,
    pendingApprovals: result.pendingApprovals,
    stopReason: result.stopReason,
    missionStatus: null,
  };
}
