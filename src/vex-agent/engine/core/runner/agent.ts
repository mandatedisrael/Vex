/**
 * Engine runner — agent turn entry point.
 *
 * "Agent" is the one-shot conversational session kind (post-M12 rename
 * from "chat"). The model may emit tool calls, dispatch transactions
 * subject to session permission, and respond with text. No loop — when
 * a final text reply lands the turn ends. Wake / `loop_defer` are
 * mission-mode only.
 */

import type { TurnResult } from "../../types.js";
import { hydrateEngineSession } from "../hydrate.js";
import type { TurnLoopConfig } from "../turn-loop.js";
import { runTurnLoop } from "../turn-loop.js";
import { getOpenAITools } from "@vex-agent/tools/registry.js";
import { computeBand, type ContextUsageBand } from "../context-band.js";
import { resolveProvider } from "@vex-agent/inference/registry.js";
import { appendMessage } from "@vex-agent/engine/events/index.js";
import logger from "@utils/logger.js";
import { toToolDefinitions, DEFAULT_LOOP_CONFIG } from "./shared.js";

// ── processAgentTurn ────────────────────────────────────────────

/**
 * Process a single agent turn. User sends message → engine responds.
 * For sessionKind="agent", the turn-loop iterates tool-call rounds
 * until the model emits a final text reply (capped by maxIterations).
 */
export async function processAgentTurn(
  sessionId: string,
  userInput: string,
  signal?: AbortSignal,
): Promise<TurnResult> {
  logger.info("engine.agent.turn", { sessionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  // Puzzle 03 — claim the session lease BEFORE the first state
  // mutation (codex blocker #2): two rapid `chat.submit` IPC calls
  // on the same session must not both append user messages + fork
  // the turn loop.
  const ownerId = `agent-turn-${Math.random().toString(36).slice(2, 12)}`;
  const { claimSessionLease } = await import("../../runtime/lease-and-status.js");
  const claim = await claimSessionLease({
    sessionId,
    ownerId,
    processKind: "electron_main",
    ttlMs: 5 * 60_000,
  });
  if (claim.outcome === "lease_busy") {
    throw new Error(
      `Session ${sessionId} runner lease busy — another agent turn is in progress.`,
    );
  }
  const { createLeaseHandle } = await import("../../runtime/lease-handle.js");
  const sessionLease = createLeaseHandle({
    lease: claim.lease,
    ownerId,
    ttlMs: 5 * 60_000,
  });

  try {
    // Save user message (FIRST state mutation, under lease)
    await appendMessage(
      sessionId,
      { role: "user", content: userInput, timestamp: new Date().toISOString() },
      { source: "user", messageType: "chat", visibility: "user" },
    );

  // Hydrate
  const hydrated = await hydrateEngineSession(sessionId);
  if (!hydrated) throw new Error(`Session ${sessionId} not found`);

  // Force agent semantics — even if session has a mission attached, this
  // entry point always processes a single agent turn (no mission loop).
  const agentContext = { ...hydrated.context, sessionKind: "agent" as const };

  const buildToolsForBand = (contextUsageBand: ContextUsageBand) => toToolDefinitions(getOpenAITools({
    permission: agentContext.sessionPermission,
    role: "parent",
    sessionKind: "agent",
    missionRunActive: false,
    contextUsageBand,
  }));
  const tools = buildToolsForBand(computeBand(hydrated.tokenCount, config.contextLimit));

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    // Agent iterates through tool-call rounds until the model emits a final
    // text reply; turn-loop.ts breaks on text for sessionKind="agent", so this
    // cap only engages when the model loops on tool-calls without ever
    // summarising.
    maxIterations: 10,
    contextLimit: config.contextLimit,
    buildToolsForBand,
  };

  const result = await runTurnLoop(
    agentContext,
    hydrated.messages,
    hydrated.summary,
    hydrated.tokenCount,
    provider,
    config,
    tools,
    loopConfig,
    {}, // promptOptions (default)
    undefined, // abortSignal — chat turns have no mission-boundary controller
    signal, // inferenceAbortSignal (9-5a) — chat-turn "stop generating"
  );

    return {
      text: result.text,
      toolCallsMade: result.toolCallsMade,
      pendingApprovals: result.pendingApprovals,
      stopReason: result.stopReason,
      missionStatus: null,
    };
  } finally {
    const { releaseLeaseAndEmitControlState } = await import(
      "../../runtime/release-and-emit.js"
    );
    await releaseLeaseAndEmitControlState(sessionLease, sessionId);
  }
}
