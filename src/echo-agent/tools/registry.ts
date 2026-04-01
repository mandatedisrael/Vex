/**
 * Tool registry — single source of truth for all tools the LLM can call.
 *
 * Defines internal tools (handled in-process) and two protocol meta-tools
 * (discover_tools, execute_tool) that give access to protocol capabilities.
 *
 * No trade_log — runtime captures automatically.
 * No memory_update — deprecated, use memory_manage.
 */

import type { ToolDef, JsonSchema, OpenAITool } from "./types.js";
import { toOpenAITools } from "./types.js";

// ── execute_tool params schema ───────────────────────────────────

const EXECUTE_TOOL_PARAMS: JsonSchema = {
  type: "object",
  properties: {
    toolId: { type: "string", description: "Protocol tool ID from discover_tools" },
    params: { type: "object", description: "Tool parameters object" },
  },
  required: ["toolId", "params"],
};

// ── Internal tool definitions ────────────────────────────────────

const TOOLS: readonly ToolDef[] = [
  // Protocol meta-tools
  {
    name: "discover_tools", kind: "internal", mutating: false,
    description: "Search available protocol capabilities by query or namespace. Returns tool metadata (ID, params, description) for use with execute_tool.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Free-text intent (e.g. 'bridge usdc', 'swap on solana')" },
      namespace: { type: "string", description: "Protocol filter (khalani, kyberswap, solana, polymarket)" },
      includeMutating: { type: "boolean", description: "Include mutating/trading capabilities" },
      includeDeclared: { type: "boolean", description: "Include not-yet-active capabilities" },
      limit: { type: "number", description: "Max tools to return" },
    } },
  },
  {
    name: "execute_tool", kind: "internal", mutating: false,
    description: "Execute a discovered protocol tool by toolId with structured params. Mutating tools require approval in restricted/off mode.",
    parameters: EXECUTE_TOOL_PARAMS,
  },

  // Web
  {
    name: "web_search", kind: "internal", mutating: false, requiresEnv: "TAVILY_API_KEY",
    description: "Search the internet — token research, market news, protocol docs, chain analytics, contract audits.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Search query" },
    }, required: ["query"] },
  },
  {
    name: "web_fetch", kind: "internal", mutating: false, requiresEnv: "TAVILY_API_KEY",
    description: "Fetch any URL as markdown — docs, block explorers, dashboards, API responses.",
    parameters: { type: "object", properties: {
      url: { type: "string", description: "URL to fetch" },
    }, required: ["url"] },
  },

  // Documents (DB-first, replaces file_*)
  {
    name: "document_read", kind: "internal", mutating: false,
    description: "Read a document from knowledge or notes. Use preview=true for first 1000 chars without context load.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["knowledge", "notes"], description: "Document space (default: knowledge)" },
      slug: { type: "string", description: "Document slug" },
      folder: { type: "string", description: "Folder slug (optional, default: root)" },
      preview: { type: "boolean", description: "Preview mode (first 1000 chars, no context load)" },
    }, required: ["slug"] },
  },
  {
    name: "document_write", kind: "internal", mutating: false,
    description: "Create or update a document in knowledge or notes.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["knowledge", "notes"], description: "Document space (default: knowledge)" },
      folder: { type: "string", description: "Folder slug (optional)" },
      title: { type: "string", description: "Document title" },
      slug: { type: "string", description: "URL-safe identifier (auto-generated from title if omitted)" },
      content: { type: "string", description: "Markdown content" },
    }, required: ["title", "content"] },
  },
  {
    name: "document_list", kind: "internal", mutating: false,
    description: "List documents in a space, optionally filtered by folder.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["knowledge", "notes"], description: "Document space (default: knowledge)" },
      folder: { type: "string", description: "Folder slug filter" },
    } },
  },
  {
    name: "document_delete", kind: "internal", mutating: false,
    description: "Archive (soft-delete) a document.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["knowledge", "notes"], description: "Document space" },
      slug: { type: "string", description: "Document slug" },
      folder: { type: "string", description: "Folder slug" },
    }, required: ["slug"] },
  },

  // Memory
  {
    name: "memory_manage", kind: "internal", mutating: false,
    description: "Manage persistent memory — list, append, replace, or delete entries. Memory is in every prompt, keep entries short (1-2 lines).",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["list", "append", "replace", "delete"], description: "Action to perform" },
      append: { type: "string", description: "Text to append (action=append)" },
      id: { type: "number", description: "Entry ID (action=replace/delete)" },
      content: { type: "string", description: "New content (action=replace)" },
    }, required: ["action"] },
  },

  // Scheduling
  {
    name: "schedule_create", kind: "internal", mutating: false,
    description: "Create a recurring cron task.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Task name" },
      cron: { type: "string", description: "Cron expression" },
      type: { type: "string", enum: ["tool_call", "wake_agent", "reminder", "monitor", "snapshot", "backup"], description: "Task type" },
      description: { type: "string", description: "Task description" },
      payload: { type: "object", description: "Task payload" },
    }, required: ["name", "cron", "type"] },
  },
  {
    name: "schedule_remove", kind: "internal", mutating: false,
    description: "Remove a scheduled task.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Task ID" },
    }, required: ["id"] },
  },

  // Portfolio
  {
    name: "portfolio_inspect", kind: "internal", mutating: false,
    description: "Inspect your own portfolio state — open positions, activity, executions, balances, snapshots, summary, lots, profits, closed_positions, non_trading_history, bridges, lp_history, orders, unrealized. DB-backed, read-only.",
    parameters: { type: "object", properties: {
      view: { type: "string", enum: ["open_positions", "activity", "executions", "balances", "snapshots", "summary", "lots", "profits", "closed_positions", "non_trading_history", "bridges", "lp_history", "orders", "unrealized"], description: "What to inspect" },
      namespace: { type: "string", description: "Protocol filter (e.g. solana, khalani)" },
      productType: { type: "string", description: "Product filter (e.g. spot, perps, prediction)" },
      instrumentKey: { type: "string", description: "Instrument filter (lots, profits)" },
      walletAddress: { type: "string", description: "Wallet filter (profits)" },
      status: { type: "string", description: "Status filter (lots, orders)" },
      groupBy: { type: "string", enum: ["instrument", "namespace"], description: "Group by for profits (default: instrument)" },
      limit: { type: "number", description: "Max rows (default 20)" },
    }, required: ["view"] },
  },

  // Mission
  {
    name: "mission_stop", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    description: "Stop the current mission run. Only valid during active mission execution. Use when a stop condition is met (goal reached, capital depleted, etc.).",
    parameters: { type: "object", properties: {
      reason: { type: "string", enum: ["goal_reached", "deadline_reached", "capital_depleted", "max_loss_hit", "no_viable_opportunity"], description: "Stop reason" },
      summary: { type: "string", description: "Concise explanation of why the mission should stop" },
      evidence: { type: "object", description: "Optional structured evidence / metrics" },
    }, required: ["reason", "summary"] },
  },

  // Subagents — parent tools
  {
    name: "subagent_spawn", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    description: "Spawn a background subagent. Returns immediately. Use subagent_status to check progress.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Echo-prefixed name (e.g. EchoSpark, EchoNibble)" },
      task: { type: "string", description: "Full task description with context and output location" },
      allow_trades: { type: "boolean", description: "Allow mutating/trading tools (default: false)" },
      max_iterations: { type: "number", description: "Max tool iterations (default: 25)" },
    }, required: ["name", "task"] },
  },
  {
    name: "subagent_status", kind: "internal", mutating: false,
    description: "Check status and results of spawned subagents. Shows pending requests for waiting subagents.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID (omit for all)" },
    } },
  },
  {
    name: "subagent_stop", kind: "internal", mutating: false,
    description: "Stop a running subagent. Partial results preserved.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID" },
    }, required: ["id"] },
  },
  {
    name: "subagent_reply", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    description: "Reply to a waiting subagent's request. Resumes the subagent.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID" },
      reply: { type: "string", description: "Your reply to the subagent's question" },
      message_id: { type: "number", description: "Original request message ID (from subagent_status pendingRequest)" },
    }, required: ["id", "reply"] },
  },

  // Subagents — child tools
  {
    name: "subagent_request_parent", kind: "internal", mutating: false,
    excludeRoles: ["parent"],
    description: "Request help from parent agent. Pauses this subagent until parent replies via subagent_reply.",
    parameters: { type: "object", properties: {
      question: { type: "string", description: "What you need from the parent" },
      context: { type: "string", description: "Additional context for the parent" },
    }, required: ["question"] },
  },
  {
    name: "subagent_report_complete", kind: "internal", mutating: false,
    excludeRoles: ["parent"],
    description: "Submit final structured report and end this subagent's execution. Saves report for parent to read via subagent_status.",
    parameters: { type: "object", properties: {
      summary: { type: "string", description: "Summary of findings/results" },
      findings: { type: "object", description: "Structured findings data" },
      success: { type: "boolean", description: "Whether the task was completed successfully (default: true)" },
    }, required: ["summary"] },
  },

  // Wallet
  {
    name: "wallet_read", kind: "internal", mutating: false,
    description: "Read wallet state. action=address: get wallet address. action=balances: get all token balances with USD prices across chains via Khalani.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["address", "balances"], description: "address: get wallet address. balances: all tokens with USD prices." },
      chain: { type: "string", enum: ["eip155", "solana"], description: "Chain family (for address action)." },
      wallet: { type: "string", enum: ["eip155", "solana", "all"], description: "Wallet scope for balances (default: all)." },
      chainIds: { type: "string", description: "Chain ID filter for balances (comma-separated IDs or aliases)." },
    }, required: ["action"] },
  },
  {
    name: "wallet_send_prepare", kind: "internal", mutating: false,
    description: "Prepare a transfer intent (no broadcast). Returns intent ID for confirmation.",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      to: { type: "string", description: "Recipient address" },
      amount: { type: "string", description: "Amount in user-facing units" },
      token: { type: "string", description: "Token symbol or mint (Solana SPL)" },
    }, required: ["network", "to", "amount"] },
  },
  {
    name: "wallet_send_confirm", kind: "internal", mutating: true,
    description: "Confirm and broadcast a prepared transfer. Requires approval in restricted/off mode.",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      intentId: { type: "string", description: "Prepared intent ID" },
    }, required: ["network", "intentId"] },
  },
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

/** Get tools as OpenAI format, filtering by mode, ENV availability, and role. */
export function getOpenAITools(
  chatMode: "full" | "restricted" | "off" = "off",
  role: "parent" | "subagent" = "parent",
): OpenAITool[] {
  const filtered = TOOLS
    .filter(t => !t.requiresEnv || Boolean(process.env[t.requiresEnv]?.trim()))
    .filter(t => chatMode === "off" ? !t.proactive : true)
    .filter(t => !t.excludeRoles?.includes(role));
  return toOpenAITools(filtered);
}

/** Check if a tool is blocked for a given role. Hard enforcement at dispatch time. */
export function isToolBlockedForRole(name: string, role: "parent" | "subagent"): boolean {
  const def = byName.get(name);
  if (!def) return false;
  return def.excludeRoles?.includes(role) ?? false;
}
