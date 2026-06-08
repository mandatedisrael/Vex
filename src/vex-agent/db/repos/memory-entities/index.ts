/**
 * memory_entities repo — public re-exports (controlled surface).
 */

export type {
  MemoryEntity,
  MemoryEntityRow,
  MemoryEntityType,
  UpsertEntityInput,
  UpsertEntityResult,
} from "./types.js";

export { ENTITY_COLUMNS, mapRow } from "./types.js";

export {
  upsertEntity,
  getEntityById,
  findActiveEntity,
  addEntityAliases,
  invalidateEntity,
  listEntities,
  type InvalidateEntityResult,
  type ListEntitiesOptions,
} from "./crud.js";
