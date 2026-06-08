/**
 * memory_candidates repo — public re-exports (controlled surface).
 */

export type {
  CandidateStatus,
  MemoryCandidate,
  MemoryCandidateRow,
  InsertCandidateInput,
  InsertCandidateResult,
} from "./types.js";

export { CANDIDATE_COLUMNS, mapRow } from "./types.js";

export {
  insertCandidate,
  getCandidateById,
  findLatestCandidateByContentHash,
  updateCandidateStatus,
  listCandidatesByStatus,
  type UpdateCandidateStatusPatch,
  type UpdateCandidateStatusResult,
} from "./crud.js";
