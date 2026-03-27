/**
 * Tool registry — single source of truth for all agent tools.
 *
 * CLI tools use a single `args` string parameter — the model constructs
 * full CLI arguments from SKILL.md reference docs it reads every prompt.
 *
 * Internal tools use structured parameters — engine parses them directly.
 *
 * NAMING CONVENTION for CLI tools:
 *   `_` = space separator (executor replaces _ with space)
 *   `-` = hyphen in subcommand name (preserved by executor)
 *   Example: `jaine_pools_scan-core` → `echoclaw jaine pools scan-core`
 *   Example: `0g-compute_ledger_deposit` → `echoclaw 0g-compute ledger deposit`
 */

import type { JsonSchema, ChatMode } from "./types.js";
import { CLI_TOOLS } from "./cli-tool-defs.js";
import { EXECUTE_TOOL_PARAMS_SCHEMA } from "./echo-tools/types.js";

// ── Tool definition ─────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  kind: "internal" | "cli";
  mutating: boolean;
  /** If true, tool is only available in restricted/full modes — filtered out in manual ("off") mode */
  proactive?: boolean;
}

export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
}

// ── Internal tools (structured params, handled by engine) ───────────

const INTERNAL: ToolDef[] = [
  { name: "discover_tools", kind: "internal", mutating: false, description: "Discover protocol capabilities from echoTools catalog. This returns protocol tool metadata only (not internal runtime tools).",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Free-text intent (e.g. 'swap on solana', 'bridge usdc')" },
      namespace: { type: "string", description: "Protocol namespace filter (e.g. solana, khalani, kyberswap)" },
      includeMutating: { type: "boolean", description: "Include mutating capabilities" },
      includeDeclared: { type: "boolean", description: "Include template-only/declaration capabilities" },
      limit: { type: "number", description: "Maximum tools to return (default managed by runtime)" },
    } } },
  { name: "execute_tool", kind: "internal", mutating: false, description: "Execute a discovered protocol capability by toolId with structured params. Mutating protocol executions require approval in restricted/off mode.",
    parameters: EXECUTE_TOOL_PARAMS_SCHEMA },

  { name: "web_search", kind: "internal", mutating: false, description: "Search the internet for any information — token research, project docs, market news, chain analytics, protocol updates, contract audits, or any other data not available through CLI tools",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "web_fetch", kind: "internal", mutating: false, description: "Fetch any URL and return its content as markdown — documentation pages, block explorers, analytics dashboards, project websites, API responses, or any other web resource",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "file_read", kind: "internal", mutating: false, description: "Load a knowledge/skill file into context. Use preview=true to see first 1000 chars without loading full file — useful to check relevance before committing to full context load.",
    parameters: { type: "object", properties: {
      path: { type: "string" },
      preview: { type: "boolean", description: "If true, returns first 1000 chars without adding to context" },
    }, required: ["path"] } },
  { name: "file_write", kind: "internal", mutating: false, description: "Create or update a knowledge file",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "file_list", kind: "internal", mutating: false, description: "List files in a knowledge directory",
    parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "file_delete", kind: "internal", mutating: false, description: "Delete a knowledge file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "memory_manage", kind: "internal", mutating: false, description: "Manage persistent memory — list, append, replace, or delete entries. Memory is loaded into every prompt, so keep entries short (1-2 lines each).",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["list", "append", "replace", "delete"], description: "list: show all entries with IDs. append: add new entry. replace: update entry by ID. delete: remove entry by ID." },
      append: { type: "string", description: "Text to append (action=append)" },
      id: { type: "number", description: "Entry ID to replace or delete (action=replace/delete)" },
      content: { type: "string", description: "New content for replacement (action=replace)" },
    }, required: ["action"] } },
  { name: "memory_update", kind: "internal", mutating: false, description: "Append to persistent memory (deprecated — use memory_manage action=append)",
    parameters: { type: "object", properties: { append: { type: "string" } }, required: ["append"] } },
  { name: "trade_log", kind: "internal", mutating: false, description: "Log or enrich a trade entry",
    parameters: { type: "object", properties: { trade: { type: "object", description: "TradeEntry object with type, chain, status, input, output, pnl, meta, reasoning" } }, required: ["trade"] } },
  { name: "schedule_create", kind: "internal", mutating: false, description: "Create a recurring cron task",
    parameters: { type: "object", properties: {
      name: { type: "string" }, cron: { type: "string" },
      type: { type: "string", enum: ["cli_execute", "inference", "alert", "snapshot", "backup"] },
      description: { type: "string" },
      payload: { type: "object", description: "Task payload — for inference: {prompt}, for cli_execute: {command, args?}, for alert: {message}" },
      loopMode: { type: "string" },
    }, required: ["name", "cron", "type"] } },
  { name: "schedule_remove", kind: "internal", mutating: false, description: "Remove a scheduled task",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  // ── Subagent tools ──────────────────────────────────────────────────
  { name: "subagent_spawn", kind: "internal", mutating: false,
    description: "Spawn a background subagent (your child). You choose the name (Echo-prefixed). Returns immediately. Subagent gets full tool set and reads skills. Set allow_trades=true for on-chain execution rights.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Unique Echo-prefixed name for this subagent (e.g. EchoSpark, EchoNibble, EchoGhost)" },
      task: { type: "string", description: "Full task description with context: what to do, where to write results, what files to read" },
      allow_trades: { type: "boolean", description: "If true, subagent can execute mutating/trading tools (default: false)" },
      max_iterations: { type: "number", description: "Max tool iterations (default: 25)" },
    }, required: ["name", "task"] } },
  { name: "subagent_status", kind: "internal", mutating: false,
    description: "Check status, progress, and results of spawned subagents. Shows what the subagent is doing, iterations completed, tools used.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Specific subagent ID (omit for all active/recent)" },
    } } },
  { name: "subagent_stop", kind: "internal", mutating: false,
    description: "Stop a running subagent. Its partial results are preserved.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID to stop" },
    }, required: ["id"] } },

  { name: "wallet_read", kind: "internal", mutating: false,
    description: "Read wallet state for EVM/Solana. Supports ensure/address/balance/balances with Khalani-backed multi-chain visibility.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["ensure", "address", "balance", "balances"], description: "Read operation to run." },
      chain: { type: "string", enum: ["eip155", "solana"], description: "Wallet chain selector for address/ensure." },
      wallet: { type: "string", enum: ["eip155", "solana", "all"], description: "Wallet scope for balances." },
      chainIds: { type: "string", description: "Optional chain filter for balances, comma-separated IDs or aliases." },
    }, required: ["action"] } },

  { name: "wallet_send_prepare", kind: "internal", mutating: false,
    description: "Prepare a wallet transfer intent (no broadcast): EVM native, Solana native, or Solana SPL token.",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Transfer network family." },
      to: { type: "string", description: "Recipient address." },
      amount: { type: "string", description: "Amount in user-facing units." },
      token: { type: "string", description: "For Solana token sends: symbol or mint address." },
      note: { type: "string", description: "Optional note for intent metadata." },
    }, required: ["network", "to", "amount"] } },

  { name: "wallet_send_confirm", kind: "internal", mutating: false,
    description: "Confirm and broadcast a prepared wallet transfer intent. Requires approval outside full mode.",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Transfer network family." },
      intentId: { type: "string", description: "Prepared intent ID to confirm." },
      transferType: { type: "string", enum: ["native", "token"], description: "For Solana: choose native SOL or SPL token intent type." },
    }, required: ["network", "intentId"] } },

  { name: "wallet_backup", kind: "internal", mutating: false,
    description: "Manage wallet backups (create/list/restore). Restore requires approval.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["create", "list", "restore"], description: "Backup operation to run." },
      backupDir: { type: "string", description: "Required when action=restore." },
    }, required: ["action"] } },
];

// ── Registry API ────────────────────────────────────────────────────

export const TOOLS: readonly ToolDef[] = [...INTERNAL, ...CLI_TOOLS];

const byName = new Map<string, ToolDef>(TOOLS.map(t => [t.name, t]));

export function getToolDef(name: string): ToolDef | undefined {
  return byName.get(name);
}

export function isInternal(name: string): boolean {
  return byName.get(name)?.kind === "internal";
}

export function isMutating(name: string): boolean {
  return byName.get(name)?.mutating === true;
}

/**
 * Tools whose CLI commands actually declare a `--yes` option.
 * Only these should receive `--yes` when auto-confirmed by executor/scheduler.
 */
const YES_SUPPORTED = new Set([
  // 0G native transfers
  "send_confirm",
  // Solana transfers
  "solana_send_confirm", "solana_send-token_confirm",
  // Solana DeFi
  "solana_swap_execute",
  "solana_stake_delegate", "solana_stake_withdraw", "solana_stake_claim-mev",
  "solana_dca_create", "solana_dca_cancel",
  "solana_limit_create", "solana_limit_cancel",
  "solana_lend_deposit", "solana_lend_withdraw",
  "solana_predict_buy", "solana_predict_sell", "solana_predict_claim",
  "solana_burn", "solana_close-accounts",
  "solana_studio_create", "solana_studio_claim-fees",
  "solana_send-invite", "solana_clawback",
  // Khalani bridge
  "khalani_bridge",
  // KyberSwap
  "kyberswap_swap_sell",
  "kyberswap_limit-order_create", "kyberswap_limit-order_cancel", "kyberswap_limit-order_hard-cancel",
  "kyberswap_zap_in", "kyberswap_zap_out", "kyberswap_zap_migrate",
  // Polymarket
  "polymarket_setup", "polymarket_buy", "polymarket_sell",
  "polymarket_cancel", "polymarket_cancel-all", "polymarket_cancel-market",
  // Jaine DEX
  "jaine_swap_sell", "jaine_swap_buy",
  // Slop bonding
  "slop_trade_buy", "slop_trade_sell",
  // 0G Compute
  "0g-compute_ledger_deposit", "0g-compute_ledger_fund",
  "0g-compute_provider_ack",
  "0g-compute_api-key_create", "0g-compute_api-key_revoke", "0g-compute_api-key_revoke-all",
  // MarketMaker
  "marketmaker_order_add",
]);

export function supportsYes(name: string): boolean {
  return YES_SUPPORTED.has(name);
}

export function toOpenAITools(chatMode: ChatMode = "off"): OpenAITool[] {
  const filtered = chatMode === "off"
    ? TOOLS.filter(t => !t.proactive)
    : TOOLS;
  return filtered.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
