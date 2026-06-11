/**
 * Prompt stack composition — builds the system-prompt layers for the engine,
 * split into two segments for KV-cache stability (D-LAYOUT):
 *
 * - STATIC layers — the stable cache prefix, joined into `messages[0]`
 *   (system, cacheHint "static_prefix"): base, tool-usage, protocols,
 *   permission, wallet-state, mode-core, subagent, Loaded Content (END of
 *   the prefix — a new load busts only from here).
 * - TURN layers — volatile per-call state, joined into the TRAILING system
 *   message (cacheHint "turn_state", placed AFTER history): runtime clock,
 *   context pressure, resume packet, `# Memory` (routing at its end),
 *   active plan, Tool Map, mission turn-state, one-shots.
 *
 * Hard ordering constraint preserved: state signals → memory routing → Tool
 * Map. Determinism: static layers must not contain timestamps/randomness —
 * the runtime clock and every other volatile marker live in the turn state.
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
import {
  buildMissionRunPrompt,
  buildMissionTurnState,
  type MissionRunContext,
} from "./mission-run.js";
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
   * Pre-formatted "# Active Plan" layer — the session's accepted action plan
   * (sanitised + length-capped) rendered as ADVISORY HOW guidance. Built in
   * `buildTurnPromptStack` only when plan-mode is on and a plan exists. Sits
   * among the advisory turn-state layers, subordinate to the authoritative
   * permission / wallet / mission-contract layers in the static prefix; it
   * never widens permissions or bypasses approval/safety gates.
   * Empty/undefined omits it.
   */
  activePlanBlock?: string;
  /**
   * One-shot note injected the turn AFTER the user toggles plan-mode OFF while
   * a plan existed (consumed via the `off_notice_pending` flag). Prompts the
   * agent to ask about next moves. Empty/undefined omits it.
   */
  planOffNotice?: string;
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
   * Pre-rendered `# Memory` section from `buildMemorySection` — the single
   * consolidated memory layer (session-memory state + long-memory state +
   * Active Knowledge + Memory Routing). Built once per turn in
   * `buildTurnPromptStack` from `memory.getTurnContext` — the SAME read that
   * drives the `hasSessionMemory` tool-visibility signal.
   * Empty/undefined omits the section.
   */
  memorySection?: string;
  /**
   * Pre-rendered Tool Map for the current `ToolVisibilityContext` from
   * `buildToolCatalogPrompt`. Built in `buildTurnPromptStack` using the SAME
   * visibility context the OpenAI tools array is projected from, so the
   * LLM-visible tool catalog and the system-prompt Tool Map stay in lockstep.
   * Empty string omits the section (e.g. no agent-surface tools visible).
   */
  toolCatalogPrompt?: string;
}

export interface PromptStack {
  /**
   * Stable cache-prefix layers — joined into the leading system message.
   * MUST stay deterministic across the calls of one session slice.
   */
  staticLayers: string[];
  /** Volatile per-call layers — joined into the trailing turn-state message. */
  turnLayers: string[];
}

/**
 * Build the full prompt stack for the engine, split into static-prefix
 * layers and turn-state layers — the caller joins each segment.
 */
export function buildPromptStack(
  context: EngineContext,
  options: PromptStackOptions = {},
): PromptStack {
  // ── STATIC PREFIX ─────────────────────────────────────────
  const staticLayers: string[] = [];

  staticLayers.push(buildBasePrompt(context));
  staticLayers.push(buildToolUsagePrompt());
  staticLayers.push(buildProtocolsPrompt());

  // Per mode + permission — stable within a session slice.
  staticLayers.push(buildPermissionPrompt({ mode: context.sessionKind, permission: context.sessionPermission }));

  // Active session wallet addresses — agent awareness. Mirrors the tool
  // resolution path exactly (buildSessionWalletResolution + resolveSelectedAddressSet).
  staticLayers.push(buildWalletStateBanner(context));

  // ── CONTEXTUAL mode-core — per sessionKind ────────────────
  if (context.sessionKind === "agent" && !context.missionRunId) {
    staticLayers.push(buildAgentPrompt());
  }

  if (context.sessionKind === "mission" && !context.missionRunId) {
    staticLayers.push(buildMissionSetupPrompt(context, options.missionSetupContext));
  }

  if (context.missionRunId) {
    // Mission contract core only — the per-slice iteration line renders in
    // the turn state (D-SPLIT-MISSION).
    staticLayers.push(buildMissionRunPrompt(context, options.missionRunContext));
  }

  // ── SUBAGENT — override ───────────────────────────────────
  if (context.isSubagent) {
    staticLayers.push(buildSubagentPrompt(context, options.subagentContext));
  }

  // Loaded Content sits at the END of the static prefix so a new
  // `knowledge_get`-style load busts the cache only from this point.
  const loadedContent = buildLoadedContentLayer(context);
  if (loadedContent.length > 0) {
    staticLayers.push(loadedContent);
  }

  // ── TURN STATE (after history) ────────────────────────────
  const turnLayers: string[] = [];

  turnLayers.push(buildRuntimeClockPrompt(options.runtimeClock ?? buildRuntimeClockSnapshot({
    sessionStartedAt: context.sessionStartedAt ?? null,
    missionRunStartedAt: context.missionRunStartedAt ?? null,
    missionDeadline: context.missionDeadline ?? null,
  })));

  // Pressure-state first (drives immediate tool behaviour), then the
  // post-compact bridge, then the consolidated memory section (routing at
  // its end), then the advisory plan, then the Tool Map — preserving the
  // hard constraint: state signals → memory routing → tool catalog.
  if (options.contextPressureBanner && options.contextPressureBanner.length > 0) {
    turnLayers.push(options.contextPressureBanner);
  }
  if (options.resumePacket && options.resumePacket.length > 0) {
    turnLayers.push(options.resumePacket);
  }
  if (options.memorySection && options.memorySection.length > 0) {
    turnLayers.push(options.memorySection);
  }
  // Active Plan (advisory HOW) — subordinate to the authoritative permission /
  // wallet / mission-contract layers in the static prefix.
  if (options.activePlanBlock && options.activePlanBlock.length > 0) {
    turnLayers.push(options.activePlanBlock);
  }
  // Visibility-aware Tool Map — built in buildTurnPromptStack from the same
  // `ToolVisibilityContext` the OpenAI `tools` array is projected from, so the
  // catalog the LLM sees in the `tools` array and the map it sees in the prompt
  // cannot drift.
  if (options.toolCatalogPrompt && options.toolCatalogPrompt.length > 0) {
    turnLayers.push(options.toolCatalogPrompt);
  }

  // Mission turn-state: the frozen per-slice iteration snapshot
  // (D-SPLIT-MISSION) — only when a mission run is active.
  if (context.missionRunId && options.missionRunContext) {
    turnLayers.push(buildMissionTurnState(options.missionRunContext.iterationCount));
  }

  // One-shots last: transcript-gated / consume-once notes whose semantics do
  // not depend on layer position.
  if (options.personaSetupHint && options.personaSetupHint.length > 0) {
    turnLayers.push(options.personaSetupHint);
  }
  if (options.planOffNotice && options.planOffNotice.length > 0) {
    turnLayers.push(options.planOffNotice);
  }

  return { staticLayers, turnLayers };
}

/**
 * Content injected into the prompt by tools this turn (e.g. knowledge_get
 * under a "knowledge:{id}" key). Neutral header — not documents-only.
 * Rendered as the FINAL static-prefix layer (moved out of base.ts).
 */
function buildLoadedContentLayer(context: EngineContext): string {
  if (context.loadedDocuments.size === 0) return "";
  const lines: string[] = [];
  lines.push("# Loaded Content");
  lines.push("");
  for (const [key, content] of context.loadedDocuments) {
    lines.push(`## ${key}`);
    lines.push(content);
    lines.push("");
  }
  return lines.join("\n");
}

// Re-exports for direct use
export { buildBasePrompt } from "./base.js";
export { buildToolUsagePrompt } from "./tool-usage.js";
export { buildProtocolsPrompt, resetProtocolsPromptCache } from "./protocols.js";
export { buildPermissionPrompt } from "./mode.js";
export { buildAgentPrompt } from "./agent.js";
export { buildMissionSetupPrompt, type MissionSetupContext } from "./mission-setup.js";
export {
  buildMissionRunPrompt,
  buildMissionTurnState,
  type MissionRunContext,
} from "./mission-run.js";
export { buildSubagentPrompt, type SubagentContext } from "./subagent.js";
