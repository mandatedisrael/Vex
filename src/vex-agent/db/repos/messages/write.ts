/**
 * Messages repo — write paths.
 *
 * Storage-only inserts. None of these emit transcript events — callers that
 * need event delivery go through `appendMessage` in
 * `src/vex-agent/engine/events/append-transcript.ts`, which owns the
 * emit-after-commit ordering.
 */

import {
  queryOneWith,
  executeWith,
  getPool,
  type Executor,
} from "../../client.js";
import { nullableJsonb } from "../../params.js";
import { toIsoTimestamp } from "./mappers.js";
import type { Message, MessageWithId, MessageMetadata } from "./types.js";

/**
 * Persist `msg` and return the inserted row id + canonical `created_at`.
 *
 * Storage-only helper. **Does not emit transcript events** — callers that
 * need event delivery must go through `appendMessage` in
 * `src/vex-agent/engine/events/append-transcript.ts`, which owns the
 * emit-after-commit ordering.
 *
 * The optional `exec` parameter follows the repo's `Executor` abstraction
 * (Pool | PoolClient) so callers running inside a transaction can pass
 * their own client and have both the INSERT and the
 * `sessions.message_count` UPDATE join that tx. Without `exec`, both
 * statements run on the pool — NOT atomic on their own. Callers that need
 * atomicity wrap themselves in `withTransaction` (see `appendMessage`).
 */
export async function addMessageReturningId(
  sessionId: string,
  msg: Message,
  metadata?: MessageMetadata,
  exec?: Executor,
): Promise<MessageWithId> {
  const e = exec ?? getPool();
  const inserted = await queryOneWith<{ id: number; created_at: string | Date }>(
    e,
    `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING id, created_at`,
    [
      sessionId, msg.role, msg.content, msg.toolCallId ?? null,
      nullableJsonb(msg.toolCalls ?? null), msg.timestamp,
      metadata?.source ?? null, metadata?.messageType ?? null,
      metadata?.visibility ?? null, metadata?.originSessionId ?? null,
      nullableJsonb(metadata?.payload ?? null),
    ],
  );
  if (inserted === null) {
    throw new Error("addMessageReturningId: INSERT...RETURNING returned no row");
  }
  await executeWith(
    e,
    "UPDATE sessions SET message_count = message_count + 1 WHERE id = $1",
    [sessionId],
  );
  return {
    ...msg,
    id: inserted.id,
    timestamp: toIsoTimestamp(inserted.created_at),
    metadata: metadata ?? msg.metadata ?? null,
  };
}

/**
 * Backwards-compatible void wrapper around `addMessageReturningId`.
 * Existing call sites that do not need the id continue to compile;
 * engine code that wants event emission must instead call
 * `appendMessage` from `engine/events/append-transcript.ts`.
 */
export async function addMessage(
  sessionId: string,
  msg: Message,
  metadata?: MessageMetadata,
  exec?: Executor,
): Promise<void> {
  await addMessageReturningId(sessionId, msg, metadata, exec);
}

/** Helper for engine-generated messages with typed metadata. */
export async function addEngineMessage(
  sessionId: string,
  content: string,
  metadata: MessageMetadata & { role?: Message["role"] },
  exec?: Executor,
): Promise<void> {
  await addMessageReturningId(
    sessionId,
    { role: metadata.role ?? "system", content, timestamp: new Date().toISOString() },
    metadata,
    exec,
  );
}
