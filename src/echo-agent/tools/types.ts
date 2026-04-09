/**
 * Tool system types — shared between internal tools and protocol tools.
 *
 * This module defines what a tool looks like to the LLM (ToolDef),
 * what a tool call looks like from the engine (ToolCallRequest),
 * and what a tool returns (ToolResult).
 */

// ── Tool definition (what LLM sees) ─────────────────────────────

export interface ToolDef {
  /** Unique tool name — used by LLM in tool_calls */
  name: string;
  /** Human-readable description for LLM context */
  description: string;
  /** JSON Schema for parameters */
  parameters: JsonSchema;
  /** Internal = handled in-process, protocol = via discover+execute */
  kind: "internal" | "protocol";
  /** Whether this tool modifies state (trades, transfers, posts) */
  mutating: boolean;
  /** If true, tool is only available in restricted/full modes */
  proactive?: boolean;
  /** ENV var required for this tool. If set and ENV is empty, tool is hidden. */
  requiresEnv?: string;
  /** Show tool ONLY when this env var is NOT set. Inverse of requiresEnv. For setup/config tools. */
  showOnlyWhenEnvMissing?: string;
  /** Roles that should NOT see/use this tool. Hard-enforced at dispatch time. */
  excludeRoles?: string[];
  /**
   * Hide this tool from the production MCP surface (`getProductionMcpTools`).
   * Use for tools that only make sense inside the Echo Agent runtime — e.g.
   * `schedule_*` (cron is owned by the agent, not the host) or `mission_stop`
   * (only valid mid-mission, MCP has no mission concept). Echo Agent still
   * sees and dispatches them; MCP / docs / instructions never advertise them.
   */
  excludeFromMcp?: boolean;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
  }>;
  required?: string[];
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
}

/**
 * Structured signal from an internal tool to the engine runtime.
 *
 * - stop_mission: parent mission stop (business stop reason)
 * - wait_for_parent: child pauses for parent help (subagent_request_parent)
 * - complete_subagent: child finished task (subagent_report_complete)
 */
export interface EngineSignal {
  type: "stop_mission" | "wait_for_parent" | "complete_subagent";
  reason: string;
  summary: string;
  evidence?: Record<string, unknown>;
  /** For wait_for_parent: the subagent message ID to track the request */
  messageId?: number;
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
