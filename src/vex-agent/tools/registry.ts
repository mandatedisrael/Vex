/**
 * Tool registry — single source of truth for all tools the LLM can call.
 *
 * Defines internal tools (handled in-process) and two protocol meta-tools
 * (discover_tools, execute_tool) that give access to protocol capabilities.
 *
 * Public API module. ToolDef arrays live in `./registry/<domain>.ts` (one
 * file per cohesive domain) — this barrel concatenates them and exposes the
 * lookup / filtering / projection functions consumers depend on. Adding a
 * new tool = touch one domain file plus this barrel's import + concat.
 *
 * No trade_log — runtime captures automatically.
 * No memory_manage / memory_update — replaced by knowledge_* (canonical agent memory layer).
 */

import type { ToolDef, ToolVisibility, OpenAITool } from "./types.js";
import { toOpenAITools } from "./types.js";
import type { ActionKind } from "./taxonomy.js";
import type { Permission, SessionKind } from "@vex-agent/engine/types.js";
import type { ContextUsageBand } from "@vex-agent/engine/core/context-band.js";

/**
 * Session-aware context for tool surface projection. Built by engine runners
 * before every provider call so `getOpenAITools` can gate session-scoped
 * tools (loop_defer, tool_output_read, compact_now).
 *
 * `permission` and `sessionKind` are immutable per session; the former
 * controls approval bypass on mutating tools, the latter controls
 * mode-only visibility (e.g. `loop_defer` is mission-only).
 *
 * `contextUsageBand` is derived from `sessions.token_count` via
 * `computeBand()` — it lags by one turn (previous prompt size) and callers
 * are expected to recompute per turn rather than cache.
 */
export interface ToolVisibilityContext {
  permission: Permission;
  role: "parent" | "subagent";
  sessionKind: SessionKind;
  /** True iff `missionRunId !== null`. Mission setup is `false` even when sessionKind="mission". */
  missionRunActive: boolean;
  contextUsageBand: ContextUsageBand;
}

/**
 * Convenience constructor for `ToolVisibilityContext` — agent-session
 * defaults with optional overrides. Primarily used by tests to avoid
 * inlining a 5-field object at every call site.
 */
export function defaultVisibilityContext(
  overrides: Partial<ToolVisibilityContext> = {},
): ToolVisibilityContext {
  return {
    permission: "restricted",
    role: "parent",
    sessionKind: "agent",
    missionRunActive: false,
    contextUsageBand: "normal",
    ...overrides,
  };
}

import { PROTOCOL_TOOLS } from "./registry/protocol.js";
import { KHALANI_INTERNAL_TOOLS } from "./registry/khalani.js";
import { WEB_TOOLS } from "./registry/web.js";
import { TWITTER_ACCOUNT_TOOLS } from "./registry/twitter-account.js";
import { DOCUMENT_TOOLS } from "./registry/documents.js";
import { KNOWLEDGE_TOOLS } from "./registry/knowledge.js";
import { PORTFOLIO_TOOLS } from "./registry/portfolio.js";
import { SETUP_TOOLS } from "./registry/setup.js";
import { MISSION_TOOLS } from "./registry/mission.js";
import { AUTONOMY_TOOLS } from "./registry/autonomy.js";
import { SUBAGENT_TOOLS } from "./registry/subagents.js";
import { EVM_TOOLS } from "./registry/evm.js";
import { WALLET_TOOLS } from "./registry/wallet.js";
import { COMPACT_TOOLS } from "./registry/compact.js";
import { MEMORY_TOOLS } from "./registry/memory.js";

// Order matters — the LLM sees tools in this order, which can subtly bias
// proactive selection. Protocol discovery comes first because it is the
// structured entry point into protocol-specific capabilities.
const TOOLS: readonly ToolDef[] = [
  ...PROTOCOL_TOOLS,
  ...KHALANI_INTERNAL_TOOLS,
  ...WEB_TOOLS,
  ...TWITTER_ACCOUNT_TOOLS,
  ...DOCUMENT_TOOLS,
  ...KNOWLEDGE_TOOLS,
  ...PORTFOLIO_TOOLS,
  ...SETUP_TOOLS,
  ...MISSION_TOOLS,
  ...AUTONOMY_TOOLS,
  ...SUBAGENT_TOOLS,
  ...EVM_TOOLS,
  ...WALLET_TOOLS,
  ...COMPACT_TOOLS,
  ...MEMORY_TOOLS,
];

// ── Registry API ─────────────────────────────────────────────────

const byName = new Map<string, ToolDef>(TOOLS.map(t => [t.name, t]));

export function getToolDef(name: string): ToolDef | undefined {
  return byName.get(name);
}

export function isInternalTool(name: string): boolean {
  return byName.has(name);
}

export function isMutatingTool(name: string): boolean {
  return byName.get(name)?.mutating === true;
}

/**
 * Look up the `pressureSafety` classification for a tool. Returns `undefined`
 * when the tool name is not registered — caller decides whether unknown
 * tools are dispatched through (legacy behavior) or denied. The dispatcher
 * currently returns `null` (proceed) on undefined so the routing layer can
 * produce a descriptive "unknown tool" error rather than a pressure error.
 */
export function getPressureSafety(name: string): ToolDef["pressureSafety"] | undefined {
  return byName.get(name)?.pressureSafety;
}

/**
 * Look up the action taxonomy (`actionKind`) for an internal tool. Returns
 * `undefined` only for unregistered names — the field is REQUIRED on `ToolDef`.
 * Used by `dispatchTool` as the fallback stamp for `ToolResult.actionKind`;
 * `executeProtocolTool` overrides with the derived target classification.
 */
export function getActionKind(name: string): ActionKind | undefined {
  return byName.get(name)?.actionKind;
}

export function getAllTools(): readonly ToolDef[] {
  return TOOLS;
}

/**
 * Filter the master TOOLS array for a given session context, returning
 * `ToolDef` rows (not the OpenAI projection). Shared upstream of
 * `getOpenAITools` AND of `buildToolCatalogPrompt` so the LLM-visible
 * catalog and the system-prompt Tool Map never drift — both layers
 * consume the same filter output for the same `ToolVisibilityContext`.
 *
 * Filter chain (order matters):
 *   1. `requiresEnv` / `showOnlyWhenEnvMissing` — env-var gates.
 *   2. `proactive` — hidden when `sessionKind === "agent"`.
 *   3. `excludeRoles` — hard role gate.
 *   4. `passesVisibility` — band gate + mission-setup/run / agent-hidden /
 *      mission-setup-hidden / requiresMissionActiveRun gates.
 *   5. `passesPressureSafety` — PR2 cutover catalog-level filter
 *      (drops `mutating` at barrier+, drops `compact_only` below barrier).
 */
export function getVisibleToolDefs(ctx: ToolVisibilityContext): readonly ToolDef[] {
  return TOOLS
    .filter(t => !t.requiresEnv || Boolean(process.env[t.requiresEnv]?.trim()))
    .filter(t => !t.showOnlyWhenEnvMissing || !process.env[t.showOnlyWhenEnvMissing]?.trim())
    .filter(t => ctx.sessionKind === "agent" ? !t.proactive : true)
    .filter(t => !t.excludeRoles?.includes(ctx.role))
    .filter(t => passesVisibility(t.visibility, ctx))
    .filter(t => passesPressureSafety(t, ctx.contextUsageBand));
}

/**
 * Get tools as OpenAI format, filtered for the given session context.
 *
 * Thin wrapper over `getVisibleToolDefs` + the OpenAI projection — keeps
 * the filter chain in one place.
 */
export function getOpenAITools(ctx: ToolVisibilityContext): OpenAITool[] {
  return toOpenAITools(getVisibleToolDefs(ctx));
}

/**
 * Catalog-level pressure-safety filter — the soft layer that keeps the
 * LLM-visible tool catalog consistent with the dispatcher's hard-deny.
 *
 * At pressure barrier+ (`barrier` or `critical`), the agent's full mutating
 * surface is restricted — only `read_only`, `safe_at_barrier`, and
 * `compact_only` tools are usable. Showing `mutating` tools in the catalog
 * at those bands would invite the model to emit calls the dispatcher then
 * rejects with the deny error, wasting a turn and confusing the model. The
 * inverse also holds: `compact_only` tools (currently only `compact_now`)
 * are NOT useful below barrier, where there is no compactable pressure.
 *
 * Tools without `pressureSafety` declared default to "mutating" via the
 * required-field invariant in `ToolDef`, so undefined cases cannot reach
 * here — the compiler enforced classification at registration time.
 */
function passesPressureSafety(tool: ToolDef, band: ContextUsageBand): boolean {
  const safety = tool.pressureSafety;
  const atBarrier = band === "barrier" || band === "critical";
  if (atBarrier && safety === "mutating") return false;
  if (!atBarrier && safety === "compact_only") return false;
  return true;
}

function passesVisibility(
  v: ToolVisibility | undefined,
  ctx: ToolVisibilityContext,
): boolean {
  if (!v) return true;

  // Band gate (PR2: 4 bands).
  // `band: "warning"`  = visible at warning OR barrier OR critical.
  // `band: "barrier"`  = visible at barrier OR critical.
  // `band: "critical"` = visible only at critical.
  if (v.band === "warning" && ctx.contextUsageBand === "normal") return false;
  if (v.band === "barrier"
      && (ctx.contextUsageBand === "normal" || ctx.contextUsageBand === "warning")) {
    return false;
  }
  if (v.band === "critical" && ctx.contextUsageBand !== "critical") return false;

  // Mission active run gate — only mission sessions with an active run
  // see autonomy primitives like `loop_defer`. Agent mode never loops.
  if (v.requiresMissionActiveRun && !ctx.missionRunActive) {
    return false;
  }

  if (v.requiresMissionRun
      && (ctx.sessionKind !== "mission" || !ctx.missionRunActive)) {
    return false;
  }

  if (v.requiresMissionSetup
      && (ctx.sessionKind !== "mission" || ctx.missionRunActive)) {
    return false;
  }

  if (v.hiddenInAgent && ctx.sessionKind === "agent") return false;
  if (v.hiddenInMissionSetup
      && ctx.sessionKind === "mission"
      && !ctx.missionRunActive) {
    return false;
  }

  return true;
}

/** Check if a tool is blocked for a given role. Hard enforcement at dispatch time. */
export function isToolBlockedForRole(name: string, role: "parent" | "subagent"): boolean {
  const def = byName.get(name);
  if (!def) return false;
  return def.excludeRoles?.includes(role) ?? false;
}

// ── Tool Map (system-prompt-facing categorization) ───────────────

/**
 * Ordered, visibility-coherent categorization of the agent-surface tools
 * used to render the `# Available Tool Map` system-prompt section. The
 * map's ORDER carries model-priority intent (e.g. protocol discovery /
 * execution first because everything mutating routes through them; reads
 * before writes within each substrate; runtime safety nets like
 * `compact_now` next to the substrate they protect). Do NOT alphabetize
 * within categories — the declaration order is the LLM-facing order.
 *
 * Subagent tools (`registry/subagents.ts`) are dormant (empty array); if
 * re-enabled in the future, add a `Subagent control` category here and
 * extend the integrity test in
 * `__tests__/vex-agent/tools/registry-tool-map.test.ts`.
 */
export interface ToolMapCategory {
  /** Visible label rendered before the comma-separated tool names. */
  label: string;
  /** Tool names in render order. Must resolve to registered ToolDefs. */
  toolNames: readonly string[];
}

export const TOOL_MAP_CATEGORIES: readonly ToolMapCategory[] = [
  { label: "Protocol discovery/execution", toolNames: ["discover_tools", "execute_tool"] },
  { label: "Live state reads", toolNames: ["wallet_balances", "evm_read", "portfolio"] },
  {
    label: "Khalani read shortcuts",
    toolNames: [
      "khalani_chains_list",
      "khalani_tokens_top",
      "token_find",
      "khalani_tokens_balances",
    ],
  },
  { label: "Research", toolNames: ["web_research", "twitter_account"] },
  { label: "Runtime overflow recovery", toolNames: ["tool_output_read"] },
  {
    label: "Session memory — this conversation/mission only",
    toolNames: ["memory_recall", "mark_outstanding_resolved"],
  },
  { label: "Context compaction — pressure only", toolNames: ["compact_now"] },
  {
    label: "Knowledge recall/history — curated across sessions",
    toolNames: [
      "knowledge_recall",
      "knowledge_recall_overflow",
      "knowledge_get",
      "knowledge_lineage",
      "knowledge_history",
    ],
  },
  {
    label: "Knowledge write/lifecycle",
    toolNames: ["knowledge_write", "knowledge_supersede", "knowledge_update_status"],
  },
  {
    label: "Documents read — scratchpad, not semantic memory",
    toolNames: ["document_read", "document_list"],
  },
  {
    label: "Documents write — scratchpad, not semantic memory",
    toolNames: ["document_write", "document_delete"],
  },
  { label: "Wallet transfers", toolNames: ["wallet_send_prepare", "wallet_send_confirm"] },
  { label: "Mission setup draft", toolNames: ["mission_draft_update"] },
  { label: "Mission run stop", toolNames: ["mission_stop"] },
  { label: "Mission run scheduling", toolNames: ["loop_defer"] },
  { label: "Setup/onboarding", toolNames: ["polymarket_setup"] },
];

/**
 * Project the Tool Map for a given visibility context — drops categories
 * whose every tool is hidden by the filter chain, preserves declared
 * order within each surviving category. Consumed by
 * `buildToolCatalogPrompt` to render the system-prompt Tool Map section.
 */
export interface VisibleToolMapCategory {
  label: string;
  toolNames: readonly string[];
}

export function getVisibleToolsByCategory(
  ctx: ToolVisibilityContext,
): readonly VisibleToolMapCategory[] {
  const visibleNames = new Set(getVisibleToolDefs(ctx).map(t => t.name));
  const result: VisibleToolMapCategory[] = [];
  for (const category of TOOL_MAP_CATEGORIES) {
    const surviving = category.toolNames.filter(name => visibleNames.has(name));
    if (surviving.length > 0) {
      result.push({ label: category.label, toolNames: surviving });
    }
  }
  return result;
}
