/**
 * Per-turn prompt-stack assembly — context-pressure banner, resume
 * packet (post-compact bridge), memory-state banner, tool catalog,
 * memory routing. Extracted from `turn-loop.ts` for scaling.
 *
 * Bridge counter behavior is preserved: the helper decrements the
 * counter on every turn the bridge is "still active" (counter > 0),
 * regardless of whether the resume packet fetch ultimately succeeded.
 * This matches the original loop semantics (`postCompactBridgeRemaining--`
 * was outside the try/catch).
 *
 * Tool visibility: this helper builds the SINGLE `ToolVisibilityContext` for
 * the turn (runner-supplied static axes + the per-turn band + `hasSessionMemory`
 * signal) and uses that one object for BOTH the OpenAI tools array AND the
 * system-prompt Tool Map, so the two can never drift.
 */

import type { EngineContext } from "../types.js";
import type { PromptStackOptions } from "../prompts/index.js";
import type {
  ToolDefinition,
} from "@vex-agent/inference/types.js";
import { pressureFraction, type ContextUsageBand } from "./context-band.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import { getSessionMemoryStats } from "@vex-agent/db/repos/session-memories/index.js";
import { buildContextPressureBanner } from "../prompts/context-pressure.js";
import { buildResumePacket } from "../prompts/resume-packet.js";
import { buildToolCatalogPrompt } from "../prompts/tool-catalog.js";
import { buildMemoryStateBanner } from "../prompts/memory-state.js";
import { MEMORY_BANNER_RECENT_THEMES_LIMIT } from "@vex-agent/memory/policy.js";
import {
  getOpenAITools,
  type ToolVisibilityContext,
  type ToolVisibilityBase,
} from "@vex-agent/tools/registry.js";
import { toToolDefinitions } from "./runner/shared.js";
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
  /**
   * Static visibility axes the runner knows up-front (permission, role,
   * sessionKind, missionRunActive). Combined with the per-turn band +
   * `hasSessionMemory` into the SINGLE `ToolVisibilityContext` used to project
   * BOTH the tools array and the Tool Map. When absent (non-runner callers),
   * the axes are derived from `context` so the single-ctx projection still holds.
   */
  readonly baseVisibility?: ToolVisibilityBase;
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

  // Per-session narrative-memory stats — fetched ONCE per turn here (the single
  // pre-inference memory read) and used for BOTH the memory-state banner AND the
  // tool-visibility gate (`hasSessionMemory`). Failure → treat as no memory
  // (banner stays empty, memory tools stay hidden); never crash the turn.
  let hasSessionMemory = false;
  try {
    const memStats = await getSessionMemoryStats(
      args.context.sessionId,
      MEMORY_BANNER_RECENT_THEMES_LIMIT,
    );
    hasSessionMemory = memStats.activeCount > 0;
    promptOptions.memoryStateBanner = buildMemoryStateBanner(memStats);
  } catch (err) {
    logger.warn("turn.memory_state.fetch_failed", {
      sessionId: args.context.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // SINGLE visibility context for BOTH `getOpenAITools` (the OpenAI tools
  // array) AND `buildToolCatalogPrompt` (the system-prompt Tool Map).
  // Built from the runner's static axes (`baseVisibility`) — falling back to
  // context-derivation for callers that don't supply it — plus the per-turn
  // band + memory signal. Constructing it once is the single-source-of-truth
  // guarantee: catalog and tools array cannot drift.
  const base: ToolVisibilityBase = args.baseVisibility ?? {
    permission: args.context.sessionPermission,
    role: args.context.isSubagent ? "subagent" : "parent",
    sessionKind: args.context.sessionKind,
    missionRunActive: args.context.missionRunId !== null,
  };
  const visibilityCtx: ToolVisibilityContext = {
    ...base,
    contextUsageBand: args.turnBand,
    hasSessionMemory,
  };

  // Project the tools array AND the Tool Map from the SAME visibilityCtx —
  // unconditional, so the two cannot drift (no stale defaultTools path).
  const tools = toToolDefinitions(getOpenAITools(visibilityCtx));
  promptOptions.toolCatalogPrompt = buildToolCatalogPrompt(visibilityCtx);
  promptOptions.memoryRoutingPrompt = args.memoryRoutingPrompt;

  return {
    promptOptions,
    tools,
    nextPostCompactBridgeRemaining,
  };
}
