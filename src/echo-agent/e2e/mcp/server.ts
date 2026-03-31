/**
 * E2E MCP Server — local stdio transport for Claude Code.
 *
 * Source-run via: pnpm exec tsx src/echo-agent/e2e/mcp/server.ts
 * Supports --smoke flag for startup health check.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setup } from "../core/scenario-runner.js";
import { registerTools } from "./tools.js";

// ── Startup smoke ──────────────────────────────────────────────

async function runStartupSmoke(): Promise<void> {
  // 1. Verify alias resolution (this import itself proves @echo-agent/* works)
  const { getPool } = await import("@echo-agent/db/client.js");

  // 2. Verify DB connection
  const pool = getPool();
  const result = await pool.query("SELECT 1 as ok");
  if (result.rows[0]?.ok !== 1) throw new Error("DB connection check failed");

  // 3. Run migrations
  await setup();

  console.error("[echo-agent-e2e] Startup smoke passed: aliases ✓ DB ✓ migrations ✓");
}

// ── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const isSmoke = process.argv.includes("--smoke");

  try {
    await runStartupSmoke();
  } catch (err) {
    console.error("[echo-agent-e2e] Startup smoke FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (isSmoke) {
    console.error("[echo-agent-e2e] Smoke check passed. Exiting.");
    const { closePool } = await import("@echo-agent/db/client.js");
    await closePool();
    process.exit(0);
  }

  // Start MCP server
  const server = new McpServer({
    name: "echo-agent-e2e",
    version: "1.0.0",
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[echo-agent-e2e] MCP server running (stdio transport)");
}

main().catch((err) => {
  console.error("[echo-agent-e2e] Fatal:", err);
  process.exit(1);
});
