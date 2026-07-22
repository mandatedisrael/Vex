/**
 * Canonical DB column tuples for `messages` / `messages_archive`.
 *
 * Single source of truth — the `sessions-archive.ts` archive writers
 * import these tuples instead of typing `SELECT *`. Keep byte-identical:
 * the archive-column-parity guard pins ordering.
 */

/**
 * Canonical DB column list for `messages` (and the matching prefix of
 * `messages_archive`, whose only extra column is `rewind_checkpoint_id`
 * from migration 023).
 *
 * Single source of truth — the `sessions-archive.ts` archive writers
 * import this tuple instead of typing `SELECT *`. Adding a column to
 * `messages` therefore forces a deliberate update here, and any
 * forgotten archive path fails typecheck instead of silently dropping
 * data into NULL or mismatched positions.
 */
export const MESSAGE_DB_COLUMNS = [
  "id",
  "session_id",
  "role",
  "content",
  "tool_call_id",
  "tool_calls",
  "created_at",
  "source",
  "message_type",
  "visibility",
  "origin_session_id",
  "metadata",
] as const;

/** `messages_archive` adds `rewind_checkpoint_id` (mig 023). Use this
 *  list when projecting an INSERT INTO messages_archive. */
export const MESSAGE_ARCHIVE_DB_COLUMNS = [
  ...MESSAGE_DB_COLUMNS,
  "rewind_checkpoint_id",
] as const;
