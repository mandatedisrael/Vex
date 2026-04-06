/**
 * Prompt stack composition — builds the full system prompt for the engine.
 *
 * Two layers:
 * - CONSTANT (always present): base, tool-usage, protocols
 * - VARIABLE (per mode/context): mode, chat/mission-setup/mission-run/subagent
 *
 * Rule: mode changes policy execution, never the scope of protocol knowledge.
 */

import type { EngineContext } from "../types.js";
import { buildBasePrompt } from "./base.js";
import { buildToolUsagePrompt } from "./tool-usage.js";
import { buildProtocolsPrompt } from "./protocols.js";
import { buildModePrompt } from "./mode.js";
import { buildChatPrompt } from "./chat.js";
import { buildMissionSetupPrompt, type MissionSetupContext } from "./mission-setup.js";
import { buildMissionRunPrompt, type MissionRunContext } from "./mission-run.js";
import { buildSubagentPrompt, type SubagentContext } from "./subagent.js";

export interface PromptStackOptions {
  missionSetupContext?: MissionSetupContext;
  missionRunContext?: MissionRunContext;
  subagentContext?: SubagentContext;
  /**
   * Pre-formatted Active Knowledge block (hot context entries + Known kinds).
   * Built by `formatActiveKnowledgeBlock` after pre-fetching repo state in
   * `executeTurn`. Empty string omits the section entirely.
   * Kept as a sync option (not a fetch hook) so this builder remains pure.
   */
  activeKnowledgeBlock?: string;
}

/**
 * Build the full prompt stack for the engine.
 *
 * Returns an array of prompt sections — caller joins them.
 */
export function buildPromptStack(
  context: EngineContext,
  options: PromptStackOptions = {},
): string[] {
  const layers: string[] = [];

  // ── CONSTANT — always present ─────────────────────────────
  layers.push(buildBasePrompt(context));
  // Active Knowledge block is pre-fetched in executeTurn (sync option here).
  // Empty string means "no entries and no known kinds yet" → skip the layer entirely.
  if (options.activeKnowledgeBlock && options.activeKnowledgeBlock.length > 0) {
    layers.push(options.activeKnowledgeBlock);
  }
  layers.push(buildToolUsagePrompt());
  layers.push(buildProtocolsPrompt());

  // ── VARIABLE — per mode ───────────────────────────────────
  layers.push(buildModePrompt(context.loopMode));

  // ── CONTEXTUAL — per sessionKind ──────────────────────────
  if (context.sessionKind === "chat" && !context.missionRunId) {
    layers.push(buildChatPrompt());
  }

  if (context.sessionKind === "mission" && !context.missionRunId) {
    layers.push(buildMissionSetupPrompt(context, options.missionSetupContext));
  }

  if (context.missionRunId) {
    layers.push(buildMissionRunPrompt(context, options.missionRunContext));
  }

  // ── SUBAGENT — override ───────────────────────────────────
  if (context.isSubagent) {
    layers.push(buildSubagentPrompt(context, options.subagentContext));
  }

  return layers;
}

// Re-exports for direct use
export { buildBasePrompt } from "./base.js";
export { buildToolUsagePrompt } from "./tool-usage.js";
export { buildProtocolsPrompt, resetProtocolsPromptCache } from "./protocols.js";
export { buildModePrompt } from "./mode.js";
export { buildChatPrompt } from "./chat.js";
export { buildMissionSetupPrompt, type MissionSetupContext } from "./mission-setup.js";
export { buildMissionRunPrompt, type MissionRunContext } from "./mission-run.js";
export { buildSubagentPrompt, type SubagentContext } from "./subagent.js";
