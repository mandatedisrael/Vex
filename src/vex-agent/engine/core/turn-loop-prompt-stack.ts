/**
 * Per-turn prompt-stack assembly — context-pressure banner, resume
 * packet (post-compact bridge), tool catalog, memory routing.
 * Extracted from `turn-loop.ts` for scaling.
 *
 * Bridge counter behavior is preserved: the helper decrements the
 * counter on every turn the bridge is "still active" (counter > 0),
 * regardless of whether the resume packet fetch ultimately succeeded.
 * This matches the original loop semantics (`postCompactBridgeRemaining--`
 * was outside the try/catch).
 */

import type { EngineContext } from "../types.js";
import type { PromptStackOptions } from "../prompts/index.js";
import type {
  ToolDefinition,
} from "@vex-agent/inference/types.js";
import { pressureFraction, type ContextUsageBand } from "./context-band.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import { buildContextPressureBanner } from "../prompts/context-pressure.js";
import { buildResumePacket } from "../prompts/resume-packet.js";
import { buildToolCatalogPrompt } from "../prompts/tool-catalog.js";
import type { ToolVisibilityContext } from "@vex-agent/tools/registry.js";
import logger from "@utils/logger.js";

export interface TurnPromptStackResult {
  readonly promptOptions: PromptStackOptions;
  readonly tools: ToolDefinition[];
  readonly nextPostCompactBridgeRemaining: number;
}

export async function buildTurnPromptStack(args: {
  readonly context: EngineContext;
  readonly turnBand: ContextUsageBand;
  readonly currentTokenCount: number;
  readonly contextLimit: number;
  readonly postCompactBridgeRemaining: number;
  readonly basePromptOptions: PromptStackOptions;
  readonly memoryRoutingPrompt: string;
  readonly defaultTools: ToolDefinition[];
  readonly buildToolsForBand?: (band: ContextUsageBand) => ToolDefinition[];
}): Promise<TurnPromptStackResult> {
  const turnFraction = pressureFraction(args.currentTokenCount, args.contextLimit);
  const promptOptions: PromptStackOptions = { ...args.basePromptOptions };
  promptOptions.contextPressureBanner = buildContextPressureBanner(args.turnBand, turnFraction);

  let nextPostCompactBridgeRemaining = args.postCompactBridgeRemaining;
  if (args.postCompactBridgeRemaining > 0) {
    try {
      const freshSession = await sessionsRepo.getSession(args.context.sessionId);
      const generation = freshSession?.checkpointGeneration ?? 0;
      const packet = await buildResumePacket(args.context.sessionId, generation);
      if (packet.length > 0) {
        logger.info("compact.resume_packet.rendered", {
          sessionId: args.context.sessionId,
          generation,
          packetLengthChars: packet.length,
          bridgeRemainingBeforeDecrement: args.postCompactBridgeRemaining,
        });
        promptOptions.resumePacket = packet;
      }
    } catch (err) {
      logger.warn("turn.resume_packet.fetch_failed", {
        sessionId: args.context.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    nextPostCompactBridgeRemaining = args.postCompactBridgeRemaining - 1;
  }

  // Shared visibility context for BOTH `buildToolsForBand` (the OpenAI
  // tools array) AND `buildToolCatalogPrompt` (the system-prompt Tool
  // Map). Constructing it once here is the single-source-of-truth
  // guarantee — catalog and map cannot drift.
  const visibilityCtx: ToolVisibilityContext = {
    permission: args.context.sessionPermission,
    role: args.context.isSubagent ? "subagent" : "parent",
    sessionKind: args.context.sessionKind,
    missionRunActive: args.context.missionRunId !== null,
    contextUsageBand: args.turnBand,
  };
  const tools = args.buildToolsForBand?.(args.turnBand) ?? args.defaultTools;
  promptOptions.toolCatalogPrompt = buildToolCatalogPrompt(visibilityCtx);
  promptOptions.memoryRoutingPrompt = args.memoryRoutingPrompt;

  return {
    promptOptions,
    tools,
    nextPostCompactBridgeRemaining,
  };
}
