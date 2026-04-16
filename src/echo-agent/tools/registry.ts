/**
 * Tool registry — single source of truth for all tools the LLM can call.
 *
 * Defines internal tools (handled in-process) and two protocol meta-tools
 * (discover_tools, execute_tool) that give access to protocol capabilities.
 *
 * No trade_log — runtime captures automatically.
 * No memory_manage / memory_update — replaced by knowledge_* (canonical agent memory layer).
 */

import type { ToolDef, JsonSchema, OpenAITool } from "./types.js";
import { toOpenAITools } from "./types.js";
import { buildDiscoverNamespaceDescription } from "./protocols/descriptions.js";

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
    description: "Search protocol capabilities using a short English capability phrase. Query should be a compact English intent like: 'buy token on solana', 'bridge usdc to base', 'prediction market orderbook', 'wallet token balances'. Returns the best matching protocol tools for use with execute_tool.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Short English capability phrase (e.g. 'bridge usdc to base', 'swap on solana', 'prediction market orderbook'). Translate the user's intent to English before calling — the retrieval surface is English-only." },
      namespace: { type: "string", description: buildDiscoverNamespaceDescription() },
      includeMutating: { type: "boolean", description: "Include mutating/trading capabilities" },
      includeDeclared: { type: "boolean", description: "Include not-yet-active capabilities" },
      limit: { type: "number", description: "Max tools to return (default: 5)" },
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

  // Documents (DB-first, freeform agent scratchpad — canonical structured memory lives in knowledge_*)
  {
    name: "document_read", kind: "internal", mutating: false,
    description: "Read a freeform note from the notes space. For canonical structured memory use knowledge_get. Use preview=true for first 1000 chars without context load.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      slug: { type: "string", description: "Document slug" },
      folder: { type: "string", description: "Folder slug (optional, default: root)" },
      preview: { type: "boolean", description: "Preview mode (first 1000 chars, no context load)" },
    }, required: ["slug"] },
  },
  {
    name: "document_write", kind: "internal", mutating: false,
    description: "Create or update a freeform note in the notes space. For canonical structured memory (rules, observations, strategies) use knowledge_write instead — it embeds and is retrievable.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      folder: { type: "string", description: "Folder slug (optional)" },
      title: { type: "string", description: "Document title" },
      slug: { type: "string", description: "URL-safe identifier (auto-generated from title if omitted)" },
      content: { type: "string", description: "Markdown content" },
    }, required: ["title", "content"] },
  },
  {
    name: "document_list", kind: "internal", mutating: false,
    description: "List notes in a space, optionally filtered by folder.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      folder: { type: "string", description: "Folder slug filter" },
    } },
  },
  {
    name: "document_delete", kind: "internal", mutating: false,
    description: "Archive (soft-delete) a note.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space" },
      slug: { type: "string", description: "Document slug" },
      folder: { type: "string", description: "Folder slug" },
    }, required: ["slug"] },
  },

  // Knowledge — canonical agent memory with embeddings + tiered TTL.
  // Free-form `kind`, English-only contents, embedding-on-write via local Docker Model Runner.
  // All five tools are visible regardless of EMBEDDING_BASE_URL (no requiresEnv) — write/recall
  // fail loud at runtime if the embeddings service is unavailable, while get/update_status
  // and recall_overflow continue to work without it.
  {
    name: "knowledge_write", kind: "internal", mutating: false,
    description:
      "Write a NEW canonical knowledge entry: a distilled rule, observation, or fact that should be retrievable later. " +
      "Use this ONLY for net-new facts — if you are replacing or updating an existing entry, use knowledge_supersede(previous_id) instead. " +
      "title, summary, and content_md MUST be in English regardless of conversation language — the embedding model achieves significantly better retrieval on English text. " +
      "kind is free-form snake_case (e.g. pumpfun_entry_pattern, risk_rule). Reuse a kind from Active Knowledge → Known kinds before creating a new one. " +
      "Use pinned=true for evergreen rules (no TTL), or ttl_hours to override the default 7-day TTL for time-bounded observations. " +
      "Fails loud if the local embeddings service is unavailable.",
    parameters: { type: "object", properties: {
      kind: { type: "string", description: "Free-form snake_case kind, English. Reuse from Known kinds when possible (e.g. pumpfun_entry_pattern, risk_rule, bridge_observation)." },
      title: { type: "string", description: "Single thesis or rule, in English." },
      summary: { type: "string", description: "1-3 sentences in English. This is the embedding input together with title — write for retrieval." },
      content_md: { type: "string", description: "Optional full markdown body in English (defaults to summary). Returned by recall and knowledge_get." },
      tags: { type: "array", description: "Optional string tags (e.g. ['solana', 'memecoin'])." },
      confidence: { type: "number", description: "Agent confidence in 0..1." },
      source_refs: { type: "object", description: "Provenance: { protocol_executions:[ids], proj_activity:[ids], proj_pnl_lots:[ids] }." },
      ttl_hours: { type: "number", description: "Override default 7-day TTL (1..8760). Ignored if pinned=true." },
      pinned: { type: "boolean", description: "Evergreen rule — bypasses TTL and stays in Active Knowledge." },
    }, required: ["kind", "title", "summary"] },
  },
  {
    name: "knowledge_supersede", kind: "internal", mutating: false,
    description:
      "Atomically replace an existing active knowledge entry with a new version. Use this whenever you are updating a rule, observation, or fact you previously wrote — a meaningful change in text, thresholds, or assessment means a new version, not an in-place edit. " +
      "The old entry is flipped to status='superseded' (hidden from recall and Active Knowledge) with its explicit successor link; the new entry becomes the active one. " +
      "previous_id is the id of the entry you are replacing (get it from knowledge_recall or Active Knowledge). reason explains why the old version stopped holding. " +
      "Optionally include change_summary (what's new) and what_failed (evidence that invalidated the old version). " +
      "Rejects if the predecessor is not active, already superseded, or if the new content is identical to the predecessor (or any other existing row). " +
      "title, summary, content_md MUST be in English. Fails loud if the local embeddings service is unavailable.",
    parameters: { type: "object", properties: {
      previous_id: { type: "number", description: "Id of the active entry being replaced." },
      kind: { type: "string", description: "Free-form snake_case kind for the NEW entry, English. Usually the same as the predecessor's kind." },
      title: { type: "string", description: "Updated thesis/rule, in English." },
      summary: { type: "string", description: "1-3 sentences, English. Embedding input together with title." },
      content_md: { type: "string", description: "Optional full markdown body, English (defaults to summary)." },
      tags: { type: "array", description: "Optional string tags." },
      confidence: { type: "number", description: "Agent confidence in 0..1." },
      source_refs: { type: "object", description: "Provenance for the new version." },
      ttl_hours: { type: "number", description: "Override default 7-day TTL (1..8760). Ignored if pinned=true." },
      pinned: { type: "boolean", description: "Evergreen rule — bypasses TTL." },
      reason: { type: "string", description: "Short reason the old version stopped holding (stored on the old row's status_reason)." },
      change_summary: { type: "string", description: "Optional: what's different about the new version (stored on the new row)." },
      what_failed: { type: "string", description: "Optional: evidence that invalidated the old version (stored on the new row)." },
    }, required: ["previous_id", "kind", "title", "summary", "reason"] },
  },
  {
    name: "knowledge_recall", kind: "internal", mutating: false,
    description:
      "Semantic recall over canonical knowledge. Returns up to 10 entries inline (with full content_md) and writes any overflow to a tmp cache (see overflow.cacheKey, readable via knowledge_recall_overflow for ~15 minutes). " +
      "query MUST be in English (translate intent first) — the embedding model achieves best retrieval on English text. " +
      "NOT 100% read-only: lazily cleans up expired cache entries and writes overflow when results exceed 10 entries or 50000 chars. " +
      "Fails loud if the local embeddings service is unavailable.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Search query in English (translate user's intent first)." },
      k: { type: "number", description: "Max results (default 8, hard max 15)." },
      kind: { type: "string", description: "Optional kind filter — reuse from Active Knowledge → Known kinds." },
      include_expired: { type: "boolean", description: "Include entries past their TTL (default true; TTL is hot-context cutoff, not existence)." },
    }, required: ["query"] },
  },
  {
    name: "knowledge_recall_overflow", kind: "internal", mutating: false,
    description: "Read overflow results from a previous knowledge_recall by cacheKey. Cache lives ~15 minutes after the originating recall. Does not require the embeddings service.",
    parameters: { type: "object", properties: {
      cacheKey: { type: "string", description: "Overflow cacheKey returned by a previous knowledge_recall response." },
    }, required: ["cacheKey"] },
  },
  {
    name: "knowledge_get", kind: "internal", mutating: false,
    description: "Fetch a canonical knowledge entry by id. Loads content_md into the engine context. Does not require the embeddings service.",
    parameters: { type: "object", properties: {
      id: { type: "number", description: "Knowledge entry id." },
    }, required: ["id"] },
  },
  {
    name: "knowledge_update_status", kind: "internal", mutating: false,
    description:
      "Mark a knowledge entry as invalidated or archived. Both remove the entry from recall and Active Knowledge. " +
      "Use this for terminal lifecycle (this fact is just wrong / no longer relevant), NOT for replacing a fact with a new version — for replacement use knowledge_supersede(previous_id). " +
      "Cannot transition back to active — write a new entry instead. Does not require the embeddings service.",
    parameters: { type: "object", properties: {
      id: { type: "number", description: "Knowledge entry id." },
      status: { type: "string", enum: ["invalidated", "archived"], description: "New status. Both remove the entry from semantic recall and Active Knowledge." },
      reason: { type: "string", description: "Optional human-readable reason — persisted to status_reason on the row." },
    }, required: ["id", "status"] },
  },

  // Scheduling — echo-agent only. Cron lifecycle is owned by the agent
  // runtime, not the MCP host; MCP hides these via `excludeFromMcp`.
  {
    name: "schedule_create", kind: "internal", mutating: false,
    excludeFromMcp: true,
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
    excludeFromMcp: true,
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

  // Setup / Configuration
  {
    name: "polymarket_setup", kind: "internal", mutating: true,
    showOnlyWhenEnvMissing: "POLYMARKET_API_KEY",
    excludeRoles: ["subagent"],
    description: "Derive and save Polymarket CLOB API credentials from your wallet keystore. Run this to enable Polymarket trading tools (buy/sell/cancel). No parameters needed — credentials are derived automatically from your configured wallet.",
    parameters: { type: "object", properties: {}, required: [] },
  },

  // Mission — echo-agent only. MCP has no mission concept (`missionRunId`
  // is always null in MCP context); hide via `excludeFromMcp`.
  {
    name: "mission_stop", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    excludeFromMcp: true,
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

  // EVM on-chain reads
  {
    name: "evm_read", kind: "internal", mutating: false,
    description: "Read on-chain EVM data — transaction receipts, ERC-721 mint detection, ERC-20 metadata, native balances. Uses khalani chain registry for RPC. Read-only.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["tx_receipt", "erc721_mint", "erc20_metadata", "balance"], description: "What to read" },
      chainId: { type: "string", description: "Chain ID or alias (e.g. '137', 'polygon', 'ethereum')" },
      txHash: { type: "string", description: "Transaction hash (for tx_receipt, erc721_mint)" },
      address: { type: "string", description: "Contract or wallet address (for erc20_metadata, balance; also recipient filter for erc721_mint)" },
    }, required: ["action", "chainId"] },
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
    description: "Prepare a transfer intent (no broadcast). Returns intent ID for confirmation. Supports native tokens, ERC-20, and ERC-721 on any EVM chain. Solana: SOL + SPL tokens only (no pNFT/cNFT).",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      chain: { type: "string", description: "EVM chain ID or alias (e.g. 'polygon', '137', '0g'). Default: 0g. Ignored for solana." },
      to: { type: "string", description: "Recipient address" },
      amount: { type: "string", description: "Amount in user-facing units (for native/ERC-20) or '1' for ERC-721" },
      token: { type: "string", description: "Token: 'native' for chain native, contract address for ERC-20, 'nft:{contract}:{tokenId}' for ERC-721. Solana: symbol or mint (SOL + SPL only, NFT not supported)." },
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
    .filter(t => !t.showOnlyWhenEnvMissing || !process.env[t.showOnlyWhenEnvMissing]?.trim())
    .filter(t => chatMode === "off" ? !t.proactive : true)
    .filter(t => !t.excludeRoles?.includes(role));
  return toOpenAITools(filtered);
}

/**
 * Surface for the production MCP server (`src/mcp`).
 *
 * Reuses the canonical env / showOnlyWhenEnvMissing / role filtering used
 * everywhere else. The MCP server is a passive bridge — it surfaces the
 * `parent`-role view of tools (no subagent child-only tools), drops anything
 * marked `excludeFromMcp` (e.g. `schedule_*`, `mission_stop` — runtime
 * concepts owned by Echo Agent, not the MCP host), and hard-excludes any
 * name starting with `subagent_` as defense in depth (today these are
 * already filtered by `excludeRoles: ["subagent"]` for child-only ones, but
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
    .filter(t => !t.excludeFromMcp)                   // schedule_*, mission_stop — echo-agent only
    .filter(t => !t.name.startsWith("subagent_"));    // hard guard for `full-minus-subagents`
}

/** Check if a tool is blocked for a given role. Hard enforcement at dispatch time. */
export function isToolBlockedForRole(name: string, role: "parent" | "subagent"): boolean {
  const def = byName.get(name);
  if (!def) return false;
  return def.excludeRoles?.includes(role) ?? false;
}
