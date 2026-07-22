/**
 * Messages repo — read paths.
 *
 * Checkpoint support: `getLiveMessagesWithId` returns rows with their DB id so
 * `selectArchivePrefix` can compute a safe cutoff. The plain `getLiveMessages`
 * helper also maps the id now (as an optional field on `Message`), but its
 * typed shape still marks id as optional — in-memory messages constructed in
 * the turn loop do not carry ids and must never be used as a cutoff input.
 */

import type { PoolClient } from "pg";
import { query, queryWith } from "../../client.js";
import { mapRowToMessage } from "./mappers.js";
import type { Message, MessageRow, MessageWithId } from "./types.js";

/** Get live messages (not archived) for a session. Ordered by created_at + id for deterministic ordering. */
export async function getLiveMessages(sessionId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    "SELECT id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, metadata FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC",
    [sessionId],
  );
  return rows.map(mapRowToMessage);
}

/**
 * Get live messages with a guaranteed id on each row. Used by compact to
 * compute a safe archive cutoff — in-memory `liveMessages` kept by the turn
 * loop do not carry ids and are not valid inputs for cutoff selection.
 *
 * Tx-aware variant: pass the same `PoolClient` used for the `sessions ...
 * FOR UPDATE` lock so the prefix selector observes the same snapshot the
 * compact transaction will commit against. Without this, a concurrent
 * second compacter racing on the row lock could plan against a stale
 * transcript and silently bump a second generation with the wrong cutoff.
 */
export async function getLiveMessagesWithId(
  sessionId: string,
  client?: PoolClient,
): Promise<MessageWithId[]> {
  const sql =
    "SELECT id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, metadata FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC";
  const rows = client
    ? await queryWith<MessageRow>(client, sql, [sessionId])
    : await query<MessageRow>(sql, [sessionId]);
  return rows.map((r) => ({ ...mapRowToMessage(r), id: r.id }));
}

/**
 * Operator instructions are user messages written while an autonomous loop is
 * already active. The loop fetches only this marked subset between iterations,
 * avoiding duplicate assistant/tool rows that it just persisted itself.
 */
export async function getOperatorInstructionsAfter(
  sessionId: string,
  afterId: number,
): Promise<MessageWithId[]> {
  const rows = await query<MessageRow>(
    `SELECT id, role, content, tool_call_id, tool_calls, created_at,
            source, message_type, visibility, origin_session_id, metadata
       FROM messages
      WHERE session_id = $1
        AND id > $2
        AND role = 'user'
        AND message_type = 'operator_interrupt'
      ORDER BY id ASC`,
    [sessionId, afterId],
  );
  return rows.map((r) => ({ ...mapRowToMessage(r), id: r.id }));
}

/**
 * Get all messages including archived (for history views). Ordered by
 * `created_at + id` for deterministic ordering.
 *
 * When the giant-tool fallback forks a row into archive, the same `id` lives
 * in BOTH tables: archive holds the original payload, messages holds a short
 * placeholder. History view wants the canonical payload, so archive wins.
 * We emit all archive rows, then only those live rows whose `id` is not
 * already in archive.
 */
export async function getAllMessages(sessionId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `SELECT id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, metadata
       FROM messages_archive
      WHERE session_id = $1
     UNION ALL
     SELECT id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, metadata
       FROM messages m
      WHERE m.session_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM messages_archive a WHERE a.id = m.id
        )
     ORDER BY created_at ASC, id ASC`,
    [sessionId],
  );
  return rows.map(mapRowToMessage);
}
