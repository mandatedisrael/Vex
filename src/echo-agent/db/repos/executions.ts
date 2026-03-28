/**
 * Protocol executions repo — audit log of every mutating tool call.
 */

import { query, queryOne, execute } from "../client.js";

export interface ExecutionRecord {
  id: number;
  toolId: string;
  namespace: string;
  sessionId: string | null;
  success: boolean;
  tradeCapture: Record<string, unknown> | null;
  externalRefs: Record<string, unknown>;
  durationMs: number | null;
  createdAt: string;
}

export async function recordExecution(
  toolId: string,
  namespace: string,
  sessionId: string | null,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
  success: boolean,
  tradeCapture: Record<string, unknown> | null,
  externalRefs: Record<string, unknown>,
  durationMs: number,
): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO protocol_executions (tool_id, namespace, session_id, params, result, success, trade_capture, external_refs, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [toolId, namespace, sessionId, JSON.stringify(params), JSON.stringify(result),
     success, tradeCapture ? JSON.stringify(tradeCapture) : null, JSON.stringify(externalRefs), durationMs],
  );
  return row?.id ?? 0;
}

export async function getByExternalRef(key: string, value: string): Promise<ExecutionRecord[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM protocol_executions WHERE external_refs->>$1 = $2 ORDER BY created_at DESC",
    [key, value],
  );
  return rows.map(mapRow);
}

export async function getByNamespace(namespace: string, limit = 50): Promise<ExecutionRecord[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM protocol_executions WHERE namespace = $1 ORDER BY created_at DESC LIMIT $2",
    [namespace, limit],
  );
  return rows.map(mapRow);
}

export async function getById(id: number): Promise<ExecutionRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM protocol_executions WHERE id = $1",
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function getBySession(sessionId: string): Promise<ExecutionRecord[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM protocol_executions WHERE session_id = $1 ORDER BY created_at DESC",
    [sessionId],
  );
  return rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): ExecutionRecord {
  return {
    id: r.id as number,
    toolId: r.tool_id as string,
    namespace: r.namespace as string,
    sessionId: r.session_id as string | null,
    success: r.success as boolean,
    tradeCapture: r.trade_capture as Record<string, unknown> | null,
    externalRefs: (r.external_refs as Record<string, unknown>) ?? {},
    durationMs: r.duration_ms as number | null,
    createdAt: r.created_at as string,
  };
}
