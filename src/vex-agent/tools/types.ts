/**
 * Tool system types — shared between internal tools and protocol tools.
 *
 * This module defines what a tool looks like to the LLM (ToolDef),
 * what a tool call looks like from the engine (ToolCallRequest),
 * and what a tool returns (ToolResult).
 */

import type { ActionKind } from "./taxonomy.js";

// ── Tool definition (what LLM sees) ─────────────────────────────

/**
 * Session-aware visibility rules for a tool. Orthogonal to `requiresEnv`,
 * `proactive`, and `excludeRoles` (those stay as-is). When omitted, the tool
 * is visible under the existing filter chain only — no session-context gating.
 *
 * Evaluated inside `getOpenAITools` against a `ToolVisibilityContext`. Handler
 * code SHOULD still defense-in-depth its own preconditions in `InternalToolContext`
 * (PR-3 extended that too with `sessionKind` + `contextUsageBand`) — the
 * visibility filter only controls what the LLM sees, not what it can be made
 * to attempt.
 */
export interface ToolVisibility {
  /**
   * Minimum context-usage band at which the tool becomes visible.
   * `"warning"` → visible when band is `warning`, `barrier`, or `critical`.
   * `"barrier"` → visible only when band is `barrier` or `critical` (PR2).
   * `"critical"` → visible only when band is `critical`.
   * Undefined → visible in all bands.
   */
  band?: "warning" | "barrier" | "critical";
  /**
   * True → require an active mission run (`missionRunActive === true`).
   * Used by autonomy primitives like `loop_defer` — agent mode never loops.
   */
  requiresMissionActiveRun?: boolean;
  /** True → require an active mission run specifically (same as above today). */
  requiresMissionRun?: boolean;
  /** True → require mission setup/edit (`sessionKind === "mission"` and no active run). */
  requiresMissionSetup?: boolean;
  /** True → hide in `sessionKind === "agent"` sessions. */
  hiddenInAgent?: boolean;
  /** True → hide during mission setup (`sessionKind === "mission"` and no active run). */
  hiddenInMissionSetup?: boolean;
}

/**
 * Pressure-safety classification — orthogonal to `mutating`.
 *
 * `mutating` is permission-gated (restricted vs full session permission)
 * and tells the approval queue whether the call needs explicit user
 * approval. `pressureSafety` is band-gated (PR2) and tells the dispatcher
 * whether the call is allowed when context pressure forces a compaction
 * before further work.
 *
 * Bands `barrier` and `critical` block calls where `pressureSafety ===
 * "mutating"`. `compact_only` is visible only at those bands. `read_only`
 * and `safe_at_barrier` pass through.
 */
export type PressureSafety =
  | "safe_at_barrier"
  | "read_only"
  | "mutating"
  | "compact_only";

export interface ToolDef {
  /** Unique tool name — used by LLM in tool_calls */
  name: string;
  /** Human-readable description for LLM context */
  description: string;
  /** JSON Schema for parameters */
  parameters: JsonSchema;
  /** Internal = handled in-process, protocol = via discover+execute */
  kind: "internal" | "protocol";
  /** Whether this tool modifies state (trades, transfers, posts). Permission-gated. */
  mutating: boolean;
  /**
   * Pressure-safety classification. REQUIRED — every tool MUST be deliberately
   * classified so the dispatcher knows whether to block at barrier/critical.
   */
  pressureSafety: PressureSafety;
  /**
   * Action taxonomy — explicit side-effect classification (see `./taxonomy.ts`).
   * REQUIRED — every tool MUST be deliberately classified so puzzle 5 phase 2+
   * (approval intents, wallet intents, audit) can make policy decisions
   * without re-deriving from the loose `mutating` boolean. Mirrors the
   * `pressureSafety` invariant: the compiler enforces classification at
   * registration time.
   */
  actionKind: ActionKind;
  /** If true, tool is only available in restricted/full modes */
  proactive?: boolean;
  /** ENV var required for this tool. If set and ENV is empty, tool is hidden. */
  requiresEnv?: string;
  /** Show tool ONLY when this env var is NOT set. Inverse of requiresEnv. For setup/config tools. */
  showOnlyWhenEnvMissing?: string;
  /** Roles that should NOT see/use this tool. Hard-enforced at dispatch time. */
  excludeRoles?: string[];
  /**
   * Surface(s) on which this tool is advertised. Default `undefined` ≡ "both".
   *
   * - `"agent"` → only the Vex Agent runtime sees it (agent / mission).
   *   `getProductionMcpTools` filters it out. Use for tools
   *   that only make sense inside the agent loop (`mission_stop`, `loop_defer`,
   *   `tool_output_read`).
   * - `"mcp"` → only the MCP server (`getProductionMcpTools`) advertises it.
   *   `getOpenAITools` filters it out. Use for self-documentation tools whose
   *   content the agent already gets via system prompt (`vex_introduction`,
   *   `vex_namespace_tools`).
   * - `"both"` (or undefined) → visible on both surfaces. Default for the vast
   *   majority of operational tools.
   *
   * Surface controls advertising only — the dispatcher still routes calls for
   * any registered tool name regardless of surface.
   */
  surface?: "agent" | "mcp" | "both";
  /**
   * Session-aware visibility rules. When omitted, the tool is subject only
   * to the existing filter chain (requiresEnv, proactive, excludeRoles).
   * See `ToolVisibility` for the individual gates.
   */
  visibility?: ToolVisibility;
}

/**
 * Property value within a JsonSchema. Recursive — supports nested objects
 * (`properties`/`required`/`additionalProperties`) and arrays (`items`).
 *
 * Phase 0 widened this from the original 3-field shape (`{type, description?, enum?}`)
 * to support strict-mode requirements from OpenAI/Azure: `items` on arrays is
 * mandatory, `additionalProperties: false` must be settable on nested objects.
 * The full per-provider projection layer (Phase 1 of the long-term plan) builds
 * on this baseline shape.
 */
export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  /** Schema of array elements. Required by OpenAI strict + Azure when type === "array". */
  items?: JsonSchemaProperty;
  /** Nested-object property map. */
  properties?: Record<string, JsonSchemaProperty>;
  /** Required keys of a nested object. */
  required?: string[];
  /** When false on an object, rejects extra keys (OpenAI strict requirement). */
  additionalProperties?: boolean;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  /** Top-level strictness flag. Per-provider projection sets this defensively. */
  additionalProperties?: boolean;
}

// ── Tool call (from engine to dispatcher) ────────────────────────

export interface ToolCallRequest {
  /** Tool name — matches ToolDef.name */
  name: string;
  /** Parsed arguments from LLM */
  args: Record<string, unknown>;
  /** Tool call ID from provider — must be preserved for round-trip */
  toolCallId: string;
}

// ── Tool result (from handler back to engine) ────────────────────

export interface ToolResult {
  /** Whether the tool executed successfully */
  success: boolean;
  /** Output text to show to LLM */
  output: string;
  /** Structured data (optional — for trade capture, UI enrichment) */
  data?: Record<string, unknown>;
  /** If true, tool queued for approval instead of executing */
  pendingApproval?: boolean;
  /** Engine signal — structured command from tool to engine (e.g. stop_mission) */
  engineSignal?: EngineSignal;
  /**
   * Action taxonomy stamp — what kind of action this dispatch actually performed
   * (see `./taxonomy.ts`). Stamped by:
   *  - `dispatchTool` as a fallback from `getActionKind(toolName)` for internal
   *    tools when the handler did not set it,
   *  - `executeProtocolTool` from the TARGET protocol manifest (NOT from the
   *    `execute_tool` wrapper's own classification), on every known-manifest
   *    return path (approval-pending, pressure-denied, param-invalid, success,
   *    handler-thrown failure). Unknown protocol tool returns omit the field.
   *
   * Policy / approval / audit layers (puzzle 5 phase 2+) consume this field
   * to classify what actually happened, regardless of which wrapper was called.
   * Kept top-level rather than nested under `data` because `data` is handler
   * payload (trade capture, UI enrichment) and should not be polluted with
   * policy metadata (Codex review, puzzle 5/1A, 2026-05-23).
   */
  actionKind?: ActionKind;
}

/**
 * Structured signal from an internal tool to the engine runtime.
 *
 * - stop_mission: parent mission stop (business stop reason)
 * - wait_for_parent: child pauses for parent help (subagent_request_parent)
 * - complete_subagent: child finished task (subagent_report_complete)
 * - defer_until: the agent wants to sleep until a wake time (loop_defer)
 * - compact_committed: `compact_now` archived the conversation prefix, updated
 *   the rolling summary, and enqueued a Track 2 chunking job (PR2). Turn-loop
 *   drains remaining tool calls in the batch with `batch_aborted_by_compact`,
 *   reloads live messages, merges operator interrupts, updates
 *   `mission_runs.last_checkpoint_at`, and injects a deterministic resume
 *   packet for `POST_COMPACT_BRIDGE_CYCLES` subsequent turns.
 */
export interface EngineSignal {
  type:
    | "stop_mission"
    | "wait_for_parent"
    | "complete_subagent"
    | "defer_until"
    | "compact_committed";
  reason: string;
  summary: string;
  evidence?: Record<string, unknown>;
  /** For wait_for_parent: the subagent message ID to track the request */
  messageId?: number;
  /** For defer_until: ISO8601 timestamp when the wake executor should resume the session. */
  dueAt?: string;
  /** For compact_committed: the freshly-bumped sessions.checkpoint_generation value. */
  generation?: number;
  /** For compact_committed: the compact_job id enqueued for Track 2 chunking, or null on cooldown noop. */
  jobId?: number | null;
}

// ── OpenAI-compatible tool format (for inference providers) ──────

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/** Convert ToolDef[] to OpenAI tools format for inference API */
export function toOpenAITools(tools: readonly ToolDef[]): OpenAITool[] {
  return tools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
