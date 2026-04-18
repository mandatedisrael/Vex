/**
 * Subagent engine runner — runs a child engine session.
 *
 * Reuses engine-core: hydrate, turn-loop, prompts.
 * Constraints: respects allowTrades and parent loopMode.
 * Uses session_links as canonical relationship graph.
 */

import type { EngineContext, LoopMode, StopReason } from "../types.js";
import { hydrateEngineSession } from "../core/hydrate.js";
import { runTurnLoop, type TurnLoopConfig } from "../core/turn-loop.js";
import { getOpenAITools } from "@echo-agent/tools/registry.js";
import type { ToolDefinition } from "@echo-agent/inference/types.js";
import { resolveProvider } from "@echo-agent/inference/registry.js";
import { loadEnvConfig, loadSubagentConfig } from "@echo-agent/inference/config.js";
import * as subagentsRepo from "@echo-agent/db/repos/subagents.js";
import * as sessionLinksRepo from "@echo-agent/db/repos/session-links.js";
import { relayToParent } from "./relay.js";
import * as subagentMessages from "@echo-agent/db/repos/subagent-messages.js";
import type { PromptStackOptions } from "../prompts/index.js";

export interface SubagentResult {
  subagentId: string;
  sessionId: string;
  output: string;
  toolCallsMade: number;
  success: boolean;
  /** Stop reason from turn loop — lifecycle helper needs this to distinguish pause vs terminal. */
  stopReason: StopReason | null;
}

// Removed: DEFAULT_MAX_ITERATIONS / DEFAULT_TIMEOUT_MS
// Now sourced from loadSubagentConfig() (ENV-backed with fallbacks)

/**
 * Run a subagent's engine session.
 *
 * 1. Load subagent config from DB
 * 2. Determine constraints (allowTrades, parent loopMode)
 * 3. Build prompt stack with subagent layer
 * 4. Run turn loop
 * 5. Relay result to parent
 */
export async function runSubagentEngine(
  subagentId: string,
  signal?: AbortSignal,
): Promise<SubagentResult> {
  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  // Load subagent
  const subagent = await subagentsRepo.getById(subagentId);
  if (!subagent) throw new Error(`Subagent ${subagentId} not found`);

  // Session discovered via session_links (canonical graph)
  const sessionLink = await sessionLinksRepo.getSubagentSession(subagentId);
  if (!sessionLink) throw new Error(`No session link found for subagent ${subagentId}`);
  const sessionId = sessionLink.childSessionId;

  // Determine parent constraints from session_links → parent session → active run.
  // Parent's rolling summary snapshot is also captured here so the child's
  // briefing can include it — copy by value, so later drift on the parent's
  // summary does not affect this child's prompt.
  const parentLink = await sessionLinksRepo.getParentSession(sessionId);
  let parentLoopMode: LoopMode = "restricted";
  let parentSummarySnapshot: string | undefined;
  if (parentLink) {
    const parentHydrated = await hydrateEngineSession(parentLink.parentSessionId);
    if (parentHydrated) {
      parentLoopMode = parentHydrated.context.loopMode;
      if (parentHydrated.summary && parentHydrated.summary.trim().length > 0) {
        parentSummarySnapshot = parentHydrated.summary;
      }
    }
  }

  // Effective mode: allowTrades=false → always restricted. Otherwise inherit parent.
  const allowTrades = subagent.allowTrades ?? false;
  const effectiveLoopMode: LoopMode = allowTrades ? parentLoopMode : "restricted";

  // Hydrate session
  const hydrated = await hydrateEngineSession(sessionId);
  if (!hydrated) throw new Error(`Subagent session ${sessionId} not found`);

  // Build context
  const context: EngineContext = {
    ...hydrated.context,
    loopMode: effectiveLoopMode,
    isSubagent: true,
  };

  const promptOptions: PromptStackOptions = {
    subagentContext: {
      task: subagent.task,
      allowTrades,
      parentLoopMode,
      parentSummarySnapshot,
    },
  };

  const openAITools = getOpenAITools(effectiveLoopMode, "subagent");
  const tools: ToolDefinition[] = openAITools.map(t => ({
    type: "function" as const,
    function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters as unknown as Record<string, unknown> },
  }));

  // Use ENV-backed subagent config, with subagent.maxIterations as override
  const envConfig = loadEnvConfig();
  const subConfig = loadSubagentConfig(envConfig);

  const loopConfig: TurnLoopConfig = {
    maxIterations: subagent.maxIterations || subConfig.maxIterations,
    timeoutMs: subConfig.timeoutMs,
    contextLimit: subConfig.contextLimit,
  };

  // Runner does NOT manage lifecycle status — caller (subagent.ts) does.
  // Runner only executes the turn loop and relays results.

  try {
    const result = await runTurnLoop(
      context,
      hydrated.messages,
      hydrated.summary,
      hydrated.tokenCount,
      provider,
      config,
      tools,
      loopConfig,
      promptOptions,
      signal,
    );

    const output = result.text ?? "Subagent completed without text output.";

    // Conditional relay: skip for pauses and structured-report completions
    // waiting_for_parent = paused (not finished), complete_subagent = report already in subagent_messages
    const hasStructuredReport = (await subagentMessages.getMessagesByType(subagentId, "report_complete")).length > 0;
    const skipRelay = result.stopReason === "waiting_for_parent" || hasStructuredReport;
    if (!skipRelay) {
      await relayToParent(subagentId, output);
    }

    // success=false if stopped by runtime error, timeout, or iteration_limit
    const runtimeFailures = new Set(["timeout", "iteration_limit", "system_error"]);
    const success = !result.stopReason || !runtimeFailures.has(result.stopReason);

    return {
      subagentId,
      sessionId,
      output,
      toolCallsMade: result.toolCallsMade,
      success,
      stopReason: result.stopReason,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await relayToParent(subagentId, `Subagent error: ${errorMsg}`);

    return {
      subagentId,
      sessionId,
      output: errorMsg,
      toolCallsMade: 0,
      success: false,
      stopReason: null,
    };
  }
}
