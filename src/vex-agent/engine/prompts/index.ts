/**
 * Prompt stack composition — builds the full system prompt for the engine.
 *
 * Two layers:
 * - CONSTANT (always present): base, tool-usage, protocols
 * - VARIABLE (per mode/permission/context): permission, agent/mission-setup/mission-run/subagent
 *
 * Rule: mode and permission change policy execution, never the scope of
 * protocol knowledge.
 */

import type { EngineContext } from "../types.js";
import { buildBasePrompt } from "./base.js";
import { buildToolUsagePrompt } from "./tool-usage.js";
import { buildProtocolsPrompt } from "./protocols.js";
import { buildPermissionPrompt } from "./mode.js";
import { buildAgentPrompt } from "./agent.js";
import { buildMissionSetupPrompt, type MissionSetupContext } from "./mission-setup.js";
import { buildMissionRunPrompt, type MissionRunContext } from "./mission-run.js";
import { buildSubagentPrompt, type SubagentContext } from "./subagent.js";
import { buildWalletStateBanner } from "./wallet-state.js";
import {
  buildRuntimeClockPrompt,
  buildRuntimeClockSnapshot,
  type RuntimeClockSnapshot,
} from "../runtime-clock.js";

export interface PromptStackOptions {
  missionSetupContext?: MissionSetupContext;
  missionRunContext?: MissionRunContext;
  subagentContext?: SubagentContext;
  /** Optional test/host override; production builds this from EngineContext. */
  runtimeClock?: RuntimeClockSnapshot;
  /**
   * Optional one-time persona setup hint. Set by the agent runner ONLY on the
   * first reply of a session that has no configured persona (transcript-gated
   * so it never repeats). Prompts the agent to briefly offer to personalize its
   * name/tone. Empty/undefined omits it.
   */
  personaSetupHint?: string;
  /**
   * Pre-formatted Active Knowledge block (hot context entries + Known kinds).
   * Built by `formatActiveKnowledgeBlock` after pre-fetching repo state in
   * `executeTurn`. Empty string omits the section entirely.
   * Kept as a sync option (not a fetch hook) so this builder remains pure.
   */
  activeKnowledgeBlock?: string;
  /**
   * Pre-formatted context-pressure banner from `buildContextPressureBanner`.
   * Empty string (band='normal') omits the section. Built by `runTurnLoop`
   * from the lagging token-count + context-limit before invoking `executeTurn`.
   */
  contextPressureBanner?: string;
  /**
   * Pre-formatted post-compact resume packet from `buildResumePacket`. Present
   * only for the first `POST_COMPACT_BRIDGE_CYCLES` turns following a
   * `compact_committed` engine signal. Empty string omits the section.
   * Built async by `runTurnLoop` (DB reads); buildPromptStack stays sync.
   */
  resumePacket?: string;
  /**
   * Pre-formatted memory-state banner from `buildMemoryStateBanner`. Built
   * async in `buildTurnPromptStack` from `getSessionMemoryStats` — a single
   * per-turn read shared with the `hasSessionMemory` tool-visibility signal.
   * Empty/undefined omits the section.
   */
  memoryStateBanner?: string;
  /**
   * Pre-formatted knowledge-state banner from `buildKnowledgeStateBanner`.
   * Complements (does NOT replace) `activeKnowledgeBlock`: this banner
   * carries the count signal + empty-state guidance; the block carries
   * curated entries. Built async in `executeTurn`.
   */
  knowledgeStateBanner?: string;
  /**
   * Pre-rendered Memory Routing Rule (4-line static decision hierarchy
   * from `buildMemoryRoutingRule`). Built by `runTurnLoop` once per loop
   * — the content is static so the prompt-stack option is the cheapest
   * delivery vector.
   */
  memoryRoutingPrompt?: string;
  /**
   * Pre-rendered Tool Map for the current `ToolVisibilityContext` from
   * `buildToolCatalogPrompt`. Built in `buildTurnPromptStack` using the SAME
   * visibility context the OpenAI tools array is projected from, so the
   * LLM-visible tool catalog and the system-prompt Tool Map stay in lockstep.
   * Empty string omits the section (e.g. no agent-surface tools visible).
   */
  toolCatalogPrompt?: string;
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
  // One-time persona-setup offer (first reply, unconfigured persona only).
  if (options.personaSetupHint && options.personaSetupHint.length > 0) {
    layers.push(options.personaSetupHint);
  }
  layers.push(buildRuntimeClockPrompt(options.runtimeClock ?? buildRuntimeClockSnapshot({
    sessionStartedAt: context.sessionStartedAt ?? null,
    missionRunStartedAt: context.missionRunStartedAt ?? null,
    missionDeadline: context.missionDeadline ?? null,
  })));

  // ── PRESSURE / MEMORY / KNOWLEDGE banners ─────────────────
  // Order chosen so the agent reads pressure-state first (drives immediate
  // tool behaviour), then post-compact bridge (if any), then size signals
  // for the two retrieval surfaces, then the curated Active Knowledge entries.
  if (options.contextPressureBanner && options.contextPressureBanner.length > 0) {
    layers.push(options.contextPressureBanner);
  }
  if (options.resumePacket && options.resumePacket.length > 0) {
    layers.push(options.resumePacket);
  }
  if (options.memoryStateBanner && options.memoryStateBanner.length > 0) {
    layers.push(options.memoryStateBanner);
  }
  if (options.knowledgeStateBanner && options.knowledgeStateBanner.length > 0) {
    layers.push(options.knowledgeStateBanner);
  }
  if (options.activeKnowledgeBlock && options.activeKnowledgeBlock.length > 0) {
    layers.push(options.activeKnowledgeBlock);
  }
  // Memory Routing Rule sits between the memory/knowledge state signals
  // and the Tool Map so the model has the substrate decision hierarchy
  // primed BEFORE it scans the catalog for "what can I call right now".
  if (options.memoryRoutingPrompt && options.memoryRoutingPrompt.length > 0) {
    layers.push(options.memoryRoutingPrompt);
  }
  // Visibility-aware Tool Map — built in buildTurnPromptStack from the same
  // `ToolVisibilityContext` the OpenAI `tools` array is projected from, so the
  // catalog the LLM sees in the `tools` array and the map it sees in the prompt
  // cannot drift.
  if (options.toolCatalogPrompt && options.toolCatalogPrompt.length > 0) {
    layers.push(options.toolCatalogPrompt);
  }

  layers.push(buildToolUsagePrompt());
  layers.push(buildProtocolsPrompt());

  // ── VARIABLE — per mode + permission ──────────────────────
  layers.push(buildPermissionPrompt({ mode: context.sessionKind, permission: context.sessionPermission }));

  // Active session wallet addresses — agent awareness. Mirrors the tool
  // resolution path exactly (buildSessionWalletResolution + resolveSelectedAddressSet).
  layers.push(buildWalletStateBanner(context));

  // ── CONTEXTUAL — per sessionKind ──────────────────────────
  if (context.sessionKind === "agent" && !context.missionRunId) {
    layers.push(buildAgentPrompt());
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
export { buildPermissionPrompt } from "./mode.js";
export { buildAgentPrompt } from "./agent.js";
export { buildMissionSetupPrompt, type MissionSetupContext } from "./mission-setup.js";
export { buildMissionRunPrompt, type MissionRunContext } from "./mission-run.js";
export { buildSubagentPrompt, type SubagentContext } from "./subagent.js";
