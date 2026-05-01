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
import type { ContextUsageBand } from "@vex-agent/engine/core/context-band.js";

/**
 * Session-aware context for tool surface projection. Built by engine runners
 * before every provider call so `getOpenAITools` can gate session-scoped
 * tools (loop_defer, checkpoint_handoff_prepare, tool_output_read — all
 * added by later PRs).
 *
 * `contextUsageBand` is derived from `sessions.token_count` via
 * `computeBand()` — it lags by one turn (previous prompt size) and callers
 * are expected to recompute per turn rather than cache.
 */
export interface ToolVisibilityContext {
  chatMode: "full" | "restricted" | "off";
  role: "parent" | "subagent";
  sessionKind: "chat" | "mission" | "full_autonomous";
  /** True iff `missionRunId !== null`. Mission setup is `false` even when sessionKind="mission". */
  missionRunActive: boolean;
  contextUsageBand: ContextUsageBand;
}

/**
 * Convenience constructor for `ToolVisibilityContext` — chat-session
 * defaults with optional overrides. Primarily used by tests to avoid
 * inlining a 5-field object at every call site.
 */
export function defaultVisibilityContext(
  overrides: Partial<ToolVisibilityContext> = {},
): ToolVisibilityContext {
  return {
    chatMode: "off",
    role: "parent",
    sessionKind: "chat",
    missionRunActive: false,
    contextUsageBand: "normal",
    ...overrides,
  };
}

import { VEX_TOOLS } from "./registry/vex.js";
import { PROTOCOL_TOOLS } from "./registry/protocol.js";
import { KHALANI_INTERNAL_TOOLS } from "./registry/khalani.js";
import { WEB_TOOLS } from "./registry/web.js";
import { DOCUMENT_TOOLS } from "./registry/documents.js";
import { KNOWLEDGE_TOOLS } from "./registry/knowledge.js";
import { PORTFOLIO_TOOLS } from "./registry/portfolio.js";
import { SETUP_TOOLS } from "./registry/setup.js";
import { MISSION_TOOLS } from "./registry/mission.js";
import { AUTONOMY_TOOLS } from "./registry/autonomy.js";
import { SUBAGENT_TOOLS } from "./registry/subagents.js";
import { EVM_TOOLS } from "./registry/evm.js";
import { WALLET_TOOLS } from "./registry/wallet.js";

// Order matters — the LLM sees tools in this order, which can subtly bias
// proactive selection. `VEX_TOOLS` (self-documentation) come first so the
// model has a one-call entry into the agent's product narrative before it
// reaches for discover_tools.
const TOOLS: readonly ToolDef[] = [
  ...VEX_TOOLS,
  ...PROTOCOL_TOOLS,
  ...KHALANI_INTERNAL_TOOLS,
  ...WEB_TOOLS,
  ...DOCUMENT_TOOLS,
  ...KNOWLEDGE_TOOLS,
  ...PORTFOLIO_TOOLS,
  ...SETUP_TOOLS,
  ...MISSION_TOOLS,
  ...AUTONOMY_TOOLS,
  ...SUBAGENT_TOOLS,
  ...EVM_TOOLS,
  ...WALLET_TOOLS,
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

export function getAllTools(): readonly ToolDef[] {
  return TOOLS;
}

/**
 * Get tools as OpenAI format, filtered for the given session context.
 *
 * Filter chain (in order):
 *   1. `requiresEnv` / `showOnlyWhenEnvMissing` — env-var gates.
 *   2. `proactive` — hidden when `chatMode === "off"`.
 *   3. `excludeRoles` — hard role gate.
 *   4. `visibility` — session-aware gates (band / mission-active / full-auto
 *      / chat-hidden / mission-setup-hidden). When a ToolDef has no
 *      `visibility`, it's visible unconditionally at this step.
 */
export function getOpenAITools(ctx: ToolVisibilityContext): OpenAITool[] {
  const filtered = TOOLS
    .filter(t => !t.requiresEnv || Boolean(process.env[t.requiresEnv]?.trim()))
    .filter(t => !t.showOnlyWhenEnvMissing || !process.env[t.showOnlyWhenEnvMissing]?.trim())
    .filter(t => ctx.chatMode === "off" ? !t.proactive : true)
    .filter(t => !t.excludeRoles?.includes(ctx.role))
    .filter(t => passesVisibility(t.visibility, ctx))
    .filter(t => isVisibleOnSurface(t, "agent"));
  return toOpenAITools(filtered);
}

/**
 * Whether `tool` is advertised on the given runtime surface.
 *
 * Default `surface === undefined` is treated as "both" — preserves the
 * pre-migration behavior for tools that don't declare a surface. The two
 * surfaces have asymmetric defaults intentionally: most operational tools
 * (knowledge, wallet, web, evm, khalani, etc.) need to appear on both, so
 * leaving `surface` unset is the sensible no-op.
 */
function isVisibleOnSurface(tool: ToolDef, surface: "agent" | "mcp"): boolean {
  return !tool.surface || tool.surface === "both" || tool.surface === surface;
}

function passesVisibility(
  v: ToolVisibility | undefined,
  ctx: ToolVisibilityContext,
): boolean {
  if (!v) return true;

  // Band gate. `band: "warning"` = visible at warning OR critical.
  // `band: "critical"` = visible only at critical.
  if (v.band === "warning" && ctx.contextUsageBand === "normal") return false;
  if (v.band === "critical" && ctx.contextUsageBand !== "critical") return false;

  // Mission active run gate — satisfied by either an active mission run
  // or a standalone full_autonomous session. Keeps loop_defer (PR-5)
  // available in both runtimes without a second flag.
  if (v.requiresMissionActiveRun
      && !ctx.missionRunActive
      && ctx.sessionKind !== "full_autonomous") {
    return false;
  }

  if (v.requiresFullAutonomous && ctx.sessionKind !== "full_autonomous") return false;
  if (v.hiddenInChat && ctx.sessionKind === "chat") return false;
  if (v.hiddenInMissionSetup
      && ctx.sessionKind === "mission"
      && !ctx.missionRunActive) {
    return false;
  }

  return true;
}

/**
 * Surface for the production MCP server (`src/mcp`).
 *
 * Reuses the canonical env / showOnlyWhenEnvMissing / role filtering used
 * everywhere else. The MCP server is a passive bridge — it surfaces the
 * `parent`-role view of tools (no subagent child-only tools), drops anything
 * marked `surface: "agent"` (e.g. `mission_stop`, `loop_defer`,
 * `checkpoint_handoff_prepare`, `tool_output_read` — Vex Agent runtime
 * concepts that the MCP host cannot drive), and hard-excludes any name
 * starting with `subagent_` as defense in depth (today these are already
 * filtered by `excludeRoles: ["subagent"]` for child-only ones, but
 * parent-spawn tools like subagent_spawn / subagent_status / subagent_stop /
 * subagent_reply are NOT role-filtered out — they belong to parent. We do
 * NOT want them in MCP regardless of role).
 *
 * MCP does NOT pass a `chatMode` filter — there is no concept of "MCP mode".
 * Proactive tools (none today) would be visible.
 */
export function getProductionMcpTools(): readonly ToolDef[] {
  return TOOLS
    .filter(t => !t.requiresEnv || Boolean(process.env[t.requiresEnv]?.trim()))
    .filter(t => !t.showOnlyWhenEnvMissing || !process.env[t.showOnlyWhenEnvMissing]?.trim())
    .filter(t => !t.excludeRoles?.includes("parent")) // none today, defensive
    .filter(t => isVisibleOnSurface(t, "mcp"))        // agent-runtime-only tools hidden (mission_stop + autonomy primitives)
    .filter(t => !t.name.startsWith("subagent_"));    // hard guard for `full-minus-subagents`
}

/** Check if a tool is blocked for a given role. Hard enforcement at dispatch time. */
export function isToolBlockedForRole(name: string, role: "parent" | "subagent"): boolean {
  const def = byName.get(name);
  if (!def) return false;
  return def.excludeRoles?.includes(role) ?? false;
}
