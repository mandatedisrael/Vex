/**
 * memory_candidates repo — public re-exports (controlled surface).
 */

export type {
  CandidateStatus,
  MemoryCandidate,
  MemoryCandidateRow,
  InsertCandidateInput,
  InsertCandidateResult,
  MemoryCandidateRecall,
  MemoryCandidateRecallRow,
} from "./types.js";

export { CANDIDATE_COLUMNS, mapRow, mapRecallRow } from "./types.js";

export {
  insertCandidate,
  getCandidateById,
  getCandidateEmbedding,
  findLatestCandidateByContentHash,
  findCandidateByPromotedKnowledgeId,
  findPromotedWakeTargets,
  updateCandidateStatus,
  updateCandidateOutcome,
  updateReconciledCandidateOutcome,
  listCandidatesByStatus,
  recallCandidatesTopK,
  type CandidateRecallFilters,
  type UpdateCandidateStatusPatch,
  type UpdateCandidateStatusResult,
  type UpdateCandidateOutcomeResult,
  type WakeAnchorProbe,
  type WakeTarget,
} from "./crud.js";
