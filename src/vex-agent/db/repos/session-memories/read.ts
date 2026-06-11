/**
 * Session-memories — read path. `getById` and `listActiveBySession` select
 * active rows via the shared `MEMORY_COLUMNS` list and `mapRow`;
 * `listUnresolvedOutstandingItems` aggregates unresolved outstanding items
 * across active chunks (resume-packet read, covered by the partial index
 * `idx_sm_session_active`).
 */

import { query, queryOne } from "../../client.js";
import {
  MEMORY_COLUMNS,
  mapRow,
  type SessionMemory,
  type SessionMemoryRow,
} from "./types.js";

export async function getById(id: number): Promise<SessionMemory | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await queryOne<SessionMemoryRow>(
    `SELECT ${MEMORY_COLUMNS} FROM session_memories WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function listActiveBySession(
  sessionId: string,
  limit = 50,
): Promise<SessionMemory[]> {
  const rows = await query<SessionMemoryRow>(
    `SELECT ${MEMORY_COLUMNS}
     FROM session_memories
     WHERE session_id = $1 AND status = 'active'
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map(mapRow);
}

export interface UnresolvedOutstandingItem {
  memoryId: number;
  theme: string;
  itemId: string;
  text: string;
}

/**
 * Unresolved outstanding items aggregated across the session's ACTIVE
 * chunks, newest chunks first. Used by the resume packet (D-RESUME-SQL —
 * SQL moved 1:1 from `engine/prompts/resume-packet.ts`); the caller owns
 * sanitization before any prompt injection.
 */
export async function listUnresolvedOutstandingItems(
  sessionId: string,
  limit: number,
): Promise<UnresolvedOutstandingItem[]> {
  const rows = await query<{ memory_id: number; theme: string; item_id: string; text: string }>(
    `SELECT m.id AS memory_id, m.theme, item->>'id' AS item_id, item->>'text' AS text
     FROM session_memories m,
          jsonb_array_elements(m.outstanding_items) item
     WHERE m.session_id = $1
       AND m.status = 'active'
       AND item->>'resolved_at' IS NULL
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map((r) => ({
    memoryId: r.memory_id,
    theme: r.theme,
    itemId: r.item_id,
    text: r.text,
  }));
}
