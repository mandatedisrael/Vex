/**
 * DB assertions — verify persistence after tool execution.
 *
 * Read-only queries on pipeline tables. Used by scenarios and MCP tools.
 */

import { query, queryOne, execute } from "@echo-agent/db/client.js";

// ── Execution assertions ───────────────────────────────────────

export async function getLastExecution(): Promise<Record<string, unknown> | null> {
  return queryOne<Record<string, unknown>>(
    "SELECT * FROM protocol_executions ORDER BY created_at DESC LIMIT 1",
    [],
  );
}

export async function getExecutionsByTool(toolId: string, limit = 10): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    "SELECT * FROM protocol_executions WHERE tool_id = $1 ORDER BY created_at DESC LIMIT $2",
    [toolId, limit],
  );
}

export async function countExecutions(toolId?: string): Promise<number> {
  const row = toolId
    ? await queryOne<{ count: string }>("SELECT COUNT(*) as count FROM protocol_executions WHERE tool_id = $1", [toolId])
    : await queryOne<{ count: string }>("SELECT COUNT(*) as count FROM protocol_executions", []);
  return parseInt(row?.count ?? "0", 10);
}

// ── Capture items assertions ───────────────────────────────────

export async function getCaptureItems(executionId: number): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    "SELECT * FROM protocol_capture_items WHERE execution_id = $1 ORDER BY id ASC",
    [executionId],
  );
}

export async function countCaptureItems(executionId: number): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM protocol_capture_items WHERE execution_id = $1",
    [executionId],
  );
  return parseInt(row?.count ?? "0", 10);
}

// ── Activity assertions ────────────────────────────────────────

export async function getActivities(executionId: number): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    "SELECT * FROM proj_activity WHERE execution_id = $1 ORDER BY id ASC",
    [executionId],
  );
}

export async function countActivities(): Promise<number> {
  const row = await queryOne<{ count: string }>("SELECT COUNT(*) as count FROM proj_activity", []);
  return parseInt(row?.count ?? "0", 10);
}

// ── Position assertions ────────────────────────────────────────

export async function getOpenPosition(positionKey: string): Promise<Record<string, unknown> | null> {
  return queryOne<Record<string, unknown>>(
    "SELECT * FROM proj_open_positions WHERE position_key = $1 AND status = 'open' LIMIT 1",
    [positionKey],
  );
}

export async function getPositionByKey(positionKey: string): Promise<Record<string, unknown> | null> {
  return queryOne<Record<string, unknown>>(
    "SELECT * FROM proj_open_positions WHERE position_key = $1 ORDER BY opened_at DESC LIMIT 1",
    [positionKey],
  );
}

export async function countOpenPositions(): Promise<number> {
  const row = await queryOne<{ count: string }>("SELECT COUNT(*) as count FROM proj_open_positions WHERE status = 'open'", []);
  return parseInt(row?.count ?? "0", 10);
}

// ── Lot assertions (spot only) ─────────────────────────────────

export async function getOpenLots(instrumentKey: string): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    "SELECT * FROM proj_pnl_lots WHERE instrument_key = $1 AND status IN ('open', 'partial') ORDER BY opened_at ASC",
    [instrumentKey],
  );
}

export async function countLots(): Promise<number> {
  const row = await queryOne<{ count: string }>("SELECT COUNT(*) as count FROM proj_pnl_lots", []);
  return parseInt(row?.count ?? "0", 10);
}

// ── Pipeline table inspection (whitelisted, read-only) ─────────

const ALLOWED_TABLES = new Set([
  "protocol_executions",
  "protocol_capture_items",
  "proj_activity",
  "proj_open_positions",
  "proj_pnl_lots",
]);

export async function inspectTable(
  table: string,
  opts?: { limit?: number; executionId?: number; toolId?: string; positionKey?: string },
): Promise<Record<string, unknown>[]> {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Table "${table}" not in whitelist: ${[...ALLOWED_TABLES].join(", ")}`);
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.executionId != null) {
    conditions.push(`execution_id = $${idx++}`);
    params.push(opts.executionId);
  }
  if (opts?.toolId) {
    conditions.push(`tool_id = $${idx++}`);
    params.push(opts.toolId);
  }
  if (opts?.positionKey) {
    conditions.push(`position_key = $${idx++}`);
    params.push(opts.positionKey);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts?.limit ?? 20, 50);
  params.push(limit);

  return query<Record<string, unknown>>(
    `SELECT * FROM ${table} ${where} ORDER BY id DESC LIMIT $${idx}`,
    params,
  );
}

// ── Reset helpers (operator-only, not exposed via MCP) ─────────

export async function resetProjections(): Promise<void> {
  await execute("TRUNCATE proj_activity, proj_open_positions, proj_pnl_lots RESTART IDENTITY");
}

export async function resetAll(): Promise<void> {
  await execute(
    "TRUNCATE protocol_executions, protocol_capture_items, proj_activity, proj_open_positions, proj_pnl_lots, protocol_sync_jobs, protocol_sync_runs RESTART IDENTITY CASCADE",
  );
}

// ── Snapshot for replay comparison ─────────────────────────────

export interface PipelineSnapshot {
  executions: number;
  captureItems: number;
  activities: number;
  openPositions: number;
  lots: number;
}

export async function takePipelineSnapshot(): Promise<PipelineSnapshot> {
  const [executions, activities, openPositions, lots] = await Promise.all([
    countExecutions(),
    countActivities(),
    countOpenPositions(),
    countLots(),
  ]);
  const ciRow = await queryOne<{ count: string }>("SELECT COUNT(*) as count FROM protocol_capture_items", []);
  const captureItems = parseInt(ciRow?.count ?? "0", 10);
  return { executions, captureItems, activities, openPositions, lots };
}
