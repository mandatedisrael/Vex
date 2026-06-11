/**
 * Session-memories repo — public re-exports.
 *
 * Consumers should import from `@vex-agent/db/repos/session-memories` to
 * avoid coupling to internal file layout.
 */

export type {
  OutstandingItem,
  NewOutstandingItem,
  SessionMemory,
  NewSessionMemory,
  RecallFilters,
  RecallHit,
  SessionMemoryRow,
  SessionMemoryRecallRow,
} from "./types.js";

export {
  BODY_MD_SCHEMA_VERSION,
  newOutstandingItem,
  renderBodyMd,
  computeContentHash,
  mapRow,
  MEMORY_COLUMNS,
} from "./types.js";

export {
  insertMemories,
  insertPreparedMemory,
  prepareMemoryRender,
  getById,
  listActiveBySession,
  listUnresolvedOutstandingItems,
  getSessionMemoryStats,
  markOutstandingResolved,
  updateEmbedding,
  type InsertResult,
  type PreparedMemoryRender,
  type SessionMemoryStats,
  type ResolveOutstandingResult,
  type UnresolvedOutstandingItem,
} from "./crud.js";

export { recallTopK } from "./recall.js";
