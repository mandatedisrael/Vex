/**
 * Messages repo — row → domain mapping helpers.
 *
 * Single-sourced: the read paths (`read.ts`) and the write path (`write.ts`,
 * which normalizes the RETURNING `created_at`) share `mapRowToMessage` and
 * `toIsoTimestamp` from here. Exported for sibling import — not part of the
 * public façade surface.
 */

import type { Message, MessageMetadata, MessageRow } from "./types.js";

export function mapRowToMessage(r: MessageRow): Message {
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

export function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Assemble a `MessageMetadata` envelope from the dedicated columns
 * (`source`, `message_type`, `visibility`, `origin_session_id`)
 * + the JSONB `metadata` column (`payload`). Returns `null` when every
 * field is empty so chat turns without engine metadata keep `metadata: null`.
 */
function assembleMessageMetadata(r: MessageRow): MessageMetadata | null {
  const metadata: MessageMetadata = {};
  if (r.source !== null) metadata.source = r.source;
  if (r.message_type !== null) metadata.messageType = r.message_type;
  if (r.visibility !== null) metadata.visibility = r.visibility;
  if (r.origin_session_id !== null) metadata.originSessionId = r.origin_session_id;
  if (r.metadata !== null) metadata.payload = r.metadata;

  // Defer to `null` when every field is empty so callers that test
  // `metadata == null` keep working.
  return Object.keys(metadata).length === 0 ? null : metadata;
}
