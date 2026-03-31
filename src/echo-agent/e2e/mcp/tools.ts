/**
 * MCP tool definitions — v1 surface for E2E testing.
 *
 * 7 tools: 2 core (protocol surface) + 2 read-only internal + 3 operator.
 * All prefixed echo_ to avoid collision.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import { makeContext, runScenario, type Scenario } from "../core/scenario-runner.js";
import { inspectTable } from "../core/db-assertions.js";
import { runReplayCheck } from "../core/replay-check.js";

// Lazy-load scenarios to avoid importing all protocol handlers at registration time
async function loadScenarios(): Promise<Record<string, Scenario>> {
  const modules = await Promise.all([
    import("../scenarios/index.js"),
  ]);
  return modules[0].ALL_SCENARIOS;
}

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
    "DB-backed portfolio inspection: open_positions, activity, executions, balances, snapshots, summary",
    {
      view: z.enum(["open_positions", "activity", "executions", "balances", "snapshots", "summary"]).describe("What to inspect"),
      namespace: z.string().optional().describe("Filter by namespace"),
      productType: z.string().optional().describe("Filter by product type"),
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
    "echo_wallet_read",
    "Read wallet address and multi-chain balances via Khalani",
    {
      wallet: z.string().optional().describe("Wallet family: eip155 or solana"),
    },
    async (params) => {
      const ctx = makeContext(`mcp-wallet-${Date.now()}`);
      const result = await dispatchTool(
        { name: "wallet_read", args: params, toolCallId: `mcp-wr-${Date.now()}` },
        ctx,
      );
      return { content: [{ type: "text" as const, text: result.output }] };
    },
  );

  // ── Operator: test harness ───────────────────────────────────

  server.tool(
    "echo_run_scenario",
    "Run a named E2E scenario (discovery, preview, persistence, replay)",
    {
      name: z.string().describe("Scenario name (e.g. khalani-bridge-audit)"),
    },
    async (params) => {
      const scenarios = await loadScenarios();
      const scenario = scenarios[params.name];
      if (!scenario) {
        const available = Object.keys(scenarios).join(", ");
        return { content: [{ type: "text" as const, text: `Unknown scenario: ${params.name}. Available: ${available}` }] };
      }
      const results = await runScenario(scenario);
      const summary = results.map(r => ({
        toolId: r.step.toolId,
        success: r.result.success,
        expected: r.step.expect.success,
        match: r.result.success === r.step.expect.success,
        durationMs: r.durationMs,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ scenario: params.name, steps: summary }, null, 2) }] };
    },
  );

  server.tool(
    "echo_inspect_pipeline",
    "Read-only, whitelisted inspection of pipeline tables (protocol_executions, capture_items, proj_activity, proj_open_positions, proj_pnl_lots)",
    {
      table: z.enum(["protocol_executions", "protocol_capture_items", "proj_activity", "proj_open_positions", "proj_pnl_lots"]).describe("Table to inspect"),
      limit: z.number().optional().describe("Max rows (default 20, max 50)"),
      executionId: z.number().optional().describe("Filter by execution_id"),
      toolId: z.string().optional().describe("Filter by tool_id"),
      positionKey: z.string().optional().describe("Filter by position_key"),
    },
    async (params) => {
      const rows = await inspectTable(params.table, {
        limit: params.limit,
        executionId: params.executionId,
        toolId: params.toolId,
        positionKey: params.positionKey,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ table: params.table, count: rows.length, rows }, null, 2) }] };
    },
  );

  server.tool(
    "echo_replay_verify",
    "Run replayProjections() and verify audit trail intact + projections rebuilt correctly",
    {},
    async () => {
      const result = await runReplayCheck();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
