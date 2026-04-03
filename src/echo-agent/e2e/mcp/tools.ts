/**
 * MCP tool definitions — v1 surface for E2E testing.
 *
 * 10 tools:
 *   Core: echo_discover, echo_execute
 *   Internal: echo_internal (generic access to all non-subagent internal tools)
 *   Read-only: echo_portfolio_inspect, echo_wallet_address, echo_wallet_balances
 *   Operator: echo_inspect_pipeline, echo_replay_verify
 *   Smoke: echo_discovery_smoke, echo_preview_smoke
 *
 * All prefixed echo_ to avoid collision.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import { makeContext } from "../core/scenario-runner.js";
import { inspectTable } from "../core/db-assertions.js";
import { runReplayCheck } from "../core/replay-check.js";
import { runDiscoverySmoke } from "../core/discovery-smoke.js";
import { runPreviewSmoke } from "../core/preview-smoke.js";

export function registerTools(server: McpServer): void {
  // ── Core: protocol surface (through dispatchTool for faithful E2E) ──

  server.tool(
    "echo_discover",
    "Search protocol capabilities via discover_tools (same path as engine)",
    {
      query: z.string().optional().describe("Text search on toolId/namespace/description"),
      namespace: z.string().optional().describe("Filter by namespace"),
      includeMutating: z.boolean().optional().describe("Include mutating tools"),
      limit: z.number().optional().describe("Max results (default 15)"),
    },
    async (params) => {
      const ctx = makeContext(`mcp-discover-${Date.now()}`);
      const result = await dispatchTool(
        { name: "discover_tools", args: params, toolCallId: `mcp-disco-${Date.now()}` },
        ctx,
      );
      return { content: [{ type: "text" as const, text: result.output }] };
    },
  );

  server.tool(
    "echo_execute",
    "Execute a protocol tool via execute_tool (same path as engine, with capture pipeline)",
    {
      toolId: z.string().describe("Protocol tool ID (e.g. khalani.bridge)"),
      params: z.record(z.string(), z.unknown()).optional().describe("Tool parameters"),
      sessionId: z.string().optional().describe("Session ID for audit trail (auto-generated if omitted)"),
    },
    async (args) => {
      const sessionId = args.sessionId ?? `mcp-exec-${Date.now()}`;
      const ctx = makeContext(sessionId);
      const result = await dispatchTool(
        { name: "execute_tool", args: { toolId: args.toolId, params: args.params ?? {} }, toolCallId: `mcp-${Date.now()}` },
        ctx,
      );
      return { content: [{ type: "text" as const, text: result.output }] };
    },
  );

  // ── Read-only internal (DB observability) ────────────────────

  server.tool(
    "echo_portfolio_inspect",
    "DB-backed portfolio inspection: open_positions, activity, executions, balances, snapshots, summary, lots, profits, closed_positions, non_trading_history. NOTE: balances/snapshots are not authoritative in E2E (no fullBalanceSync). Use echo_wallet_balances for wallet state.",
    {
      view: z.enum(["open_positions", "activity", "executions", "balances", "snapshots", "summary", "lots", "profits", "closed_positions", "non_trading_history", "bridges", "lp_history", "orders", "unrealized"]).describe("What to inspect"),
      namespace: z.string().optional().describe("Filter by namespace"),
      productType: z.string().optional().describe("Filter by product type"),
      instrumentKey: z.string().optional().describe("Filter by instrument_key (lots, profits)"),
      walletAddress: z.string().optional().describe("Filter by wallet_address (profits)"),
      status: z.string().optional().describe("Filter by status (lots, orders)"),
      groupBy: z.string().optional().describe("Group by for profits: instrument (default) or namespace"),
      limit: z.number().optional().describe("Max results"),
    },
    async (params) => {
      const ctx = makeContext(`mcp-inspect-${Date.now()}`);
      const result = await dispatchTool(
        { name: "portfolio_inspect", args: params, toolCallId: `mcp-pi-${Date.now()}` },
        ctx,
      );
      return { content: [{ type: "text" as const, text: result.output }] };
    },
  );

  server.tool(
    "echo_wallet_address",
    "Get wallet address for a chain family",
    {
      chain: z.string().optional().describe("Chain family: eip155 or solana (default: eip155)"),
    },
    async (params) => {
      const ctx = makeContext(`mcp-wallet-${Date.now()}`);
      const result = await dispatchTool(
        { name: "wallet_read", args: { action: "address", chain: params.chain }, toolCallId: `mcp-wa-${Date.now()}` },
        ctx,
      );
      return { content: [{ type: "text" as const, text: result.output }] };
    },
  );

  server.tool(
    "echo_wallet_balances",
    "Get multi-chain token balances via Khalani (source of truth for wallet state in E2E)",
    {
      wallet: z.string().optional().describe("Wallet family: eip155, solana, or all (default: all)"),
      chainIds: z.string().optional().describe("Comma-separated chain IDs to filter"),
    },
    async (params) => {
      const ctx = makeContext(`mcp-wallet-${Date.now()}`);
      const result = await dispatchTool(
        { name: "wallet_read", args: { action: "balances", wallet: params.wallet, chainIds: params.chainIds }, toolCallId: `mcp-wb-${Date.now()}` },
        ctx,
      );
      return { content: [{ type: "text" as const, text: result.output }] };
    },
  );

  // ── Operator: test harness ───────────────────────────────────

  server.tool(
    "echo_inspect_pipeline",
    "Read-only, whitelisted inspection of pipeline tables. Filters are per-table aware — only columns that exist in each table are applied.",
    {
      table: z.enum(["protocol_executions", "protocol_capture_items", "proj_activity", "proj_open_positions", "proj_pnl_lots", "proj_pnl_matches", "proj_lp_events", "proj_lp_event_legs"]).describe("Table to inspect"),
      limit: z.number().optional().describe("Max rows (default 20, max 50)"),
      executionId: z.number().optional().describe("Filter by execution_id (or id for protocol_executions)"),
      toolId: z.string().optional().describe("Filter by tool_id (protocol_executions only)"),
      sessionId: z.string().optional().describe("Filter by session_id (protocol_executions only)"),
      positionKey: z.string().optional().describe("Filter by position_key (proj_activity, proj_open_positions)"),
      instrumentKey: z.string().optional().describe("Filter by instrument_key (proj_activity, proj_open_positions, proj_pnl_lots)"),
      namespace: z.string().optional().describe("Filter by namespace (protocol_executions, proj_activity, proj_open_positions, proj_pnl_lots, proj_lp_events)"),
      lpEventId: z.number().optional().describe("Filter by lp_event_id (proj_lp_event_legs only)"),
    },
    async (params) => {
      const rows = await inspectTable(params.table, {
        limit: params.limit,
        executionId: params.executionId,
        toolId: params.toolId,
        sessionId: params.sessionId,
        positionKey: params.positionKey,
        instrumentKey: params.instrumentKey,
        namespace: params.namespace,
        lpEventId: params.lpEventId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ table: params.table, count: rows.length, rows }, null, 2) }] };
    },
  );

  server.tool(
    "echo_replay_verify",
    "Run replayProjections() and verify audit trail intact + projections rebuilt correctly (content hash, not just counts)",
    {},
    async () => {
      const result = await runReplayCheck();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── Generic internal tool access ─────────────────────────────

  const BLOCKED_INTERNAL = new Set([
    "subagent_spawn", "subagent_status", "subagent_stop",
    "subagent_reply", "subagent_request_parent", "subagent_report_complete",
  ]);

  server.tool(
    "echo_internal",
    "Call any internal tool directly (same as engine dispatch). Excludes subagent tools. Examples: polymarket_setup, wallet_read, memory_manage, document_read, schedule_create, web_search, mission_stop.",
    {
      tool: z.string().describe("Internal tool name (e.g. polymarket_setup, wallet_read)"),
      params: z.record(z.string(), z.unknown()).optional().describe("Tool parameters"),
    },
    async (args) => {
      if (BLOCKED_INTERNAL.has(args.tool)) {
        return { content: [{ type: "text" as const, text: `Tool "${args.tool}" is blocked in MCP E2E (subagent tools not exposed)` }] };
      }
      const ctx = makeContext(`mcp-internal-${Date.now()}`);
      const result = await dispatchTool(
        { name: args.tool, args: args.params ?? {}, toolCallId: `mcp-int-${Date.now()}` },
        ctx,
      );
      return { content: [{ type: "text" as const, text: result.output }] };
    },
  );

  // ── Automated smoke tools ────────────────────────────────────

  server.tool(
    "echo_discovery_smoke",
    "Run discovery smoke for all active namespaces — verify each returns tools",
    {},
    async () => {
      const ctx = makeContext(`disco-smoke-${Date.now()}`);
      const results = await runDiscoverySmoke(ctx);
      const pass = results.every(r => r.count > 0);
      return { content: [{ type: "text" as const, text: JSON.stringify({ pass, namespaces: results }, null, 2) }] };
    },
  );

  server.tool(
    "echo_preview_smoke",
    "Run preview smoke — verify dryRun produces zero writes in all 6 pipeline tables (incl. proj_pnl_matches). Checks zero-write invariant only; handler failures are acceptable.",
    {},
    async () => {
      const result = await runPreviewSmoke();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
