/**
 * Messages repo — session message history.
 *
 * Extended with engine metadata (source, messageType, visibility,
 * originSessionId, subagentId) — backwards-compatible, all optional.
 */

import { query, execute } from "../client.js";

export interface MessageRow {
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_calls: unknown;
  created_at: string;
  source: string | null;
  message_type: string | null;
  visibility: string | null;
  origin_session_id: string | null;
  subagent_id: string | null;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; command: string; args: Record<string, unknown> }>;
  timestamp: string;
}

/** Engine metadata — all fields optional for backwards compatibility. */
export interface MessageMetadata {
  source?: string;
  messageType?: string;
  visibility?: string;
  originSessionId?: string;
  subagentId?: string;
}

export async function addMessage(sessionId: string, msg: Message, metadata?: MessageMetadata): Promise<void> {
  await execute(
    `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, subagent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      sessionId, msg.role, msg.content, msg.toolCallId ?? null,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null, msg.timestamp,
      metadata?.source ?? null, metadata?.messageType ?? null,
      metadata?.visibility ?? null, metadata?.originSessionId ?? null,
      metadata?.subagentId ?? null,
    ],
  );
  await execute("UPDATE sessions SET message_count = message_count + 1 WHERE id = $1", [sessionId]);
}

/** Helper for engine-generated messages with typed metadata. */
export async function addEngineMessage(
  sessionId: string,
  content: string,
  metadata: MessageMetadata & { role?: Message["role"] },
): Promise<void> {
  await addMessage(
    sessionId,
    { role: metadata.role ?? "system", content, timestamp: new Date().toISOString() },
    metadata,
  );
}

/** Get live messages (not archived) for a session. Ordered by created_at + id for deterministic ordering. */
export async function getLiveMessages(sessionId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    "SELECT role, content, tool_call_id, tool_calls, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC",
    [sessionId],
  );
  return rows.map(r => ({
    role: r.role as Message["role"],
    content: r.content,
    toolCallId: r.tool_call_id ?? undefined,
    toolCalls: r.tool_calls as Message["toolCalls"],
    timestamp: r.created_at,
  }));
}

/** Get all messages including archived (for history views). Ordered by created_at + id for deterministic ordering. */
export async function getAllMessages(sessionId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `(SELECT id, role, content, tool_call_id, tool_calls, created_at FROM messages WHERE session_id = $1)
     UNION ALL
     (SELECT id, role, content, tool_call_id, tool_calls, created_at FROM messages_archive WHERE session_id = $1)
     ORDER BY created_at ASC, id ASC`,
    [sessionId],
  );
  return rows.map(r => ({
    role: r.role as Message["role"],
    content: r.content,
    toolCallId: r.tool_call_id ?? undefined,
    toolCalls: r.tool_calls as Message["toolCalls"],
    timestamp: r.created_at,
  }));
}
