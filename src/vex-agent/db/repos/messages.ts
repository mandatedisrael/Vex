/**
 * Messages repo — session message history.
 *
 * Extended with engine metadata (source, messageType, visibility,
 * originSessionId) — backwards-compatible, all optional.
 *
 * Checkpoint support: `getLiveMessagesWithId` returns rows with their DB id so
 * `selectArchivePrefix` can compute a safe cutoff. The plain `getLiveMessages`
 * helper also maps the id now (as an optional field on `Message`), but its
 * typed shape still marks id as optional — in-memory messages constructed in
 * the turn loop do not carry ids and must never be used as a cutoff input.
 *
 * Public API module. Internals split into `./messages/` submodules by concern
 * (column tuples, types, row mapper, write paths, read paths, archive-prefix
 * selection). Consumers import from this module — submodules are
 * implementation detail. The `sessions-archive.ts` archive writers import
 * `MESSAGE_DB_COLUMNS` from here; keep the column tuples byte-identical.
 */

export {
  MESSAGE_DB_COLUMNS,
  MESSAGE_ARCHIVE_DB_COLUMNS,
} from "./messages/columns.js";
export type {
  MessageRow,
  Message,
  MessageWithId,
  MessageMetadata,
} from "./messages/types.js";
export {
  addMessageReturningId,
  addMessage,
  addEngineMessage,
} from "./messages/write.js";
export {
  getLiveMessages,
  getLiveMessagesWithId,
  getOperatorInstructionsAfter,
  getAllMessages,
} from "./messages/read.js";
export {
  type ArchivePrefixPlan,
  selectArchivePrefix,
} from "./messages/archive-prefix.js";
