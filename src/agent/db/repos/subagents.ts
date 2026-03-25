/**
 * Subagent state repo — tracks lifecycle of spawned subagents.
 */

import { query, queryOne, execute } from "../client.js";
import type { SubagentState, SubagentStatus } from "../../types.js";

export async function insert(subagent: {
  id: string;
  name: string;
  task: string;
  allowTrades: boolean;
  parentSessionId: string | null;
  sessionId: string;
  maxIterations: number;
}): Promise<void> {
  await execute(
    `INSERT INTO subagents (id, name, task, allow_trades, parent_session_id, session_id, max_iterations)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [subagent.id, subagent.name, subagent.task, subagent.allowTrades,
     subagent.parentSessionId, subagent.sessionId, subagent.maxIterations],
  );
}

export async function updateStatus(
  id: string,
  status: SubagentStatus,
  extra?: { result?: string; error?: string; tokenCost?: number; iterations?: number },
): Promise<void> {
  const ended = status !== "running" ? "NOW()" : "ended_at";
  await execute(
    `UPDATE subagents SET status = $1, ended_at = ${ended},
     result = COALESCE($2, result), error = COALESCE($3, error),
     token_cost = COALESCE($4, token_cost), iterations = COALESCE($5, iterations)
     WHERE id = $6`,
    [status, extra?.result ?? null, extra?.error ?? null,
     extra?.tokenCost ?? null, extra?.iterations ?? null, id],
  );
}

export async function incrementIterations(id: string): Promise<void> {
  await execute("UPDATE subagents SET iterations = iterations + 1 WHERE id = $1", [id]);
}

export async function getById(id: string): Promise<SubagentState | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM subagents WHERE id = $1", [id],
  );
  return row ? mapRow(row) : null;
}

export async function getActive(): Promise<SubagentState[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM subagents WHERE status = 'running' ORDER BY started_at ASC",
  );
  return rows.map(mapRow);
}

export async function getRecent(limit = 10): Promise<SubagentState[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM subagents ORDER BY started_at DESC LIMIT $1", [limit],
  );
  return rows.map(mapRow);
}

/** Mark orphaned subagents as interrupted (restart recovery). */
export async function markOrphansInterrupted(): Promise<number> {
  const result = await query<Record<string, unknown>>(
    "UPDATE subagents SET status = 'interrupted', ended_at = NOW() WHERE status = 'running' RETURNING id",
  );
  return result.length;
}

function mapRow(row: Record<string, unknown>): SubagentState {
  return {
    id: row.id as string,
    name: row.name as string,
    task: row.task as string,
    status: row.status as SubagentStatus,
    allowTrades: row.allow_trades as boolean,
    parentSessionId: row.parent_session_id as string | null,
    sessionId: row.session_id as string | null,
    startedAt: (row.started_at as Date).toISOString(),
    endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : null,
    result: row.result as string | null,
    error: row.error as string | null,
    tokenCost: Number(row.token_cost ?? 0),
    iterations: row.iterations as number,
    maxIterations: row.max_iterations as number,
  };
}
