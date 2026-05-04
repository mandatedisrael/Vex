/**
 * Messages repo — session message history.
 *
 * Extended with engine metadata (source, messageType, visibility,
 * originSessionId, subagentId) — backwards-compatible, all optional.
 *
 * Checkpoint support: `getLiveMessagesWithId` returns rows with their DB id so
 * `selectArchivePrefix` can compute a safe cutoff. The plain `getLiveMessages`
 * helper also maps the id now (as an optional field on `Message`), but its
 * typed shape still marks id as optional — in-memory messages constructed in
 * the turn loop do not carry ids and must never be used as a cutoff input.
 */

import { query, execute } from "../client.js";
import { nullableJsonb } from "../params.js";

export interface MessageRow {
  id: number;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_calls: unknown;
  created_at: string | Date;
  source: string | null;
  message_type: string | null;
  visibility: string | null;
  origin_session_id: string | null;
  subagent_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; command: string; args: Record<string, unknown> }>;
  timestamp: string;
  /**
   * DB primary key — populated by `getLiveMessages` / `getLiveMessagesWithId`
   * / `getAllMessages`. In-memory rows constructed in the turn loop leave this
   * undefined; never trust an undefined id for cutoff computation.
   */
  id?: number;
  /**
   * Engine metadata. `messageType` / `source` / `visibility` come from the
   * dedicated columns (set by the existing `addMessage` contract); `payload`
   * is the free-form JSONB envelope introduced by PR-7 (wake banners carry
   * `{ reason, dueAt }`; overflow stubs will carry `{ overflow, blobKey, … }`
   * in PR-11). Every consumer MUST treat `payload` as untrusted.
   */
  metadata?: MessageMetadata | null;
}

/** Message variant with a guaranteed id — returned by `getLiveMessagesWithId`. */
export type MessageWithId = Message & { id: number };

/**
 * Engine metadata — all fields optional for backwards compatibility.
 *
 * `payload` (PR-7) is the free-form envelope persisted into the
 * `messages.metadata` JSONB column. Shape is intentionally loose so new
 * engine-written message kinds (wake banners, overflow stubs, …) can extend
 * without a migration. Every producer MUST define its own shape in code and
 * treat `payload` as untrusted when reading.
 */
export interface MessageMetadata {
  source?: string;
  messageType?: string;
  visibility?: string;
  originSessionId?: string;
  subagentId?: string;
  payload?: Record<string, unknown>;
}

export async function addMessage(sessionId: string, msg: Message, metadata?: MessageMetadata): Promise<void> {
  await execute(
    `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, subagent_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
    [
      sessionId, msg.role, msg.content, msg.toolCallId ?? null,
      nullableJsonb(msg.toolCalls ?? null), msg.timestamp,
      metadata?.source ?? null, metadata?.messageType ?? null,
      metadata?.visibility ?? null, metadata?.originSessionId ?? null,
      metadata?.subagentId ?? null,
      nullableJsonb(metadata?.payload ?? null),
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
    "SELECT id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, subagent_id, metadata FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC",
    [sessionId],
  );
  return rows.map(mapRowToMessage);
}

/**
 * Get live messages with a guaranteed id on each row. Used by checkpoint to
 * compute a safe archive cutoff — in-memory `liveMessages` kept by the turn
 * loop do not carry ids and are not valid inputs for cutoff selection.
 */
export async function getLiveMessagesWithId(sessionId: string): Promise<MessageWithId[]> {
  const rows = await query<MessageRow>(
    "SELECT id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, subagent_id, metadata FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC",
    [sessionId],
  );
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
            source, message_type, visibility, origin_session_id, subagent_id, metadata
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
    `SELECT id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, subagent_id, metadata
       FROM messages_archive
      WHERE session_id = $1
     UNION ALL
     SELECT id, role, content, tool_call_id, tool_calls, created_at, source, message_type, visibility, origin_session_id, subagent_id, metadata
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

function mapRowToMessage(r: MessageRow): Message {
  return {
    role: r.role as Message["role"],
    content: r.content,
    toolCallId: r.tool_call_id ?? undefined,
    toolCalls: r.tool_calls as Message["toolCalls"],
    timestamp: toIsoTimestamp(r.created_at),
    id: r.id,
    metadata: assembleMessageMetadata(r),
  };
}

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Assemble a `MessageMetadata` envelope from the dedicated columns
 * (`source`, `message_type`, `visibility`, `origin_session_id`, `subagent_id`)
 * + the JSONB `metadata` column (`payload`). Returns `null` when every
 * field is empty so chat turns without engine metadata keep `metadata: null`.
 */
function assembleMessageMetadata(r: MessageRow): MessageMetadata | null {
  const metadata: MessageMetadata = {};
  if (r.source !== null) metadata.source = r.source;
  if (r.message_type !== null) metadata.messageType = r.message_type;
  if (r.visibility !== null) metadata.visibility = r.visibility;
  if (r.origin_session_id !== null) metadata.originSessionId = r.origin_session_id;
  if (r.subagent_id !== null) metadata.subagentId = r.subagent_id;
  if (r.metadata !== null) metadata.payload = r.metadata;

  // Defer to `null` when every field is empty so callers that test
  // `metadata == null` keep working.
  return Object.keys(metadata).length === 0 ? null : metadata;
}

// ── Archive prefix selection ────────────────────────────────────

export interface ArchivePrefixPlan {
  /** Messages destined for `messages_archive` — ordered oldest → newest. */
  prefix: MessageWithId[];
  /** Messages staying live — ordered oldest → newest. */
  tail: MessageWithId[];
  /** `prefix[last].id` when prefix is non-empty; `null` otherwise. */
  cutoffMessageId: number | null;
}

/**
 * Partition `messages` into an archivable prefix and a retained tail so that no
 * `assistant.tool_calls` ↔ `role:'tool'` pair is split across the boundary.
 *
 * Strategy: start the tail at the last `tailWindow` messages regardless of
 * role. If that index lands on a `role:'tool'` row, walk it backwards until we
 * pass the corresponding assistant — that way the assistant and ALL its tool
 * results end up in the tail together. Repeating this for adjacent tool rows
 * handles multi-tool-call batches. The assistant-save ordering in turn-loop
 * (`saveAssistantMessage` before `role:'tool'` inserts) guarantees the walk
 * terminates at the assistant without overshooting other turns' messages.
 *
 * When every live message is swallowed by the pair-integrity rule, `prefix`
 * is empty and `cutoffMessageId` is null — callers drop through to the giant-
 * tool fallback (or no-op).
 */
export function selectArchivePrefix(
  messages: readonly MessageWithId[],
  tailWindow: number,
): ArchivePrefixPlan {
  if (messages.length === 0) {
    return { prefix: [], tail: [], cutoffMessageId: null };
  }

  const window = Math.max(0, tailWindow);
  let startIdx = Math.max(0, messages.length - window);

  // Walk back while the tail starts on a tool row (would split an assistant/
  // tool_calls pair). Terminates at the parent assistant or index 0.
  while (startIdx > 0 && messages[startIdx]?.role === "tool") {
    startIdx--;
  }

  if (startIdx === 0) {
    return { prefix: [], tail: [...messages], cutoffMessageId: null };
  }

  const prefix = messages.slice(0, startIdx);
  const tail = messages.slice(startIdx);
  const last = prefix[prefix.length - 1];
  return {
    prefix,
    tail,
    cutoffMessageId: last ? last.id : null,
  };
}
