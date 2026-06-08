/**
 * memory_entry_entities repo — public re-exports (controlled surface).
 */

export type {
  MemoryEntryEntity,
  MemoryEntryEntityRow,
  LinkEntryEntityResult,
} from "./types.js";

export { ENTRY_ENTITY_COLUMNS, mapRow } from "./types.js";

export {
  linkEntryEntity,
  listEntitiesForEntry,
  listEntriesForEntity,
} from "./crud.js";
