/**
 * memory_edges repo — public re-exports (controlled surface).
 */

export type {
  MemoryEdge,
  MemoryEdgeRow,
  MemoryEdgeRelation,
  UpsertEdgeInput,
  UpsertEdgeResult,
} from "./types.js";

export { EDGE_COLUMNS, mapRow } from "./types.js";

export {
  upsertEdge,
  getEdgeById,
  invalidateEdge,
  supersedeEdge,
  listActiveEdgesForEntity,
  listEdgesFrom,
  listEdgesTo,
  type InvalidateEdgePatch,
  type InvalidateEdgeResult,
  type SupersedeEdgeResult,
  type DirectionalEdgeOptions,
} from "./crud.js";
