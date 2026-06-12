import type { Result } from "../../../ipc/result.js";
import type {
  MemoryInspectorJobsSummaryInput,
  MemoryInspectorListCandidatesInput,
  MemoryInspectorListCandidatesResult,
  MemoryInspectorListDecisionsInput,
  MemoryInspectorListDecisionsResult,
  MemoryJobsSummaryDto,
} from "../../../schemas/memory-inspector.js";

/**
 * Memory-manager inspector (memory-system S10).
 *  - `listCandidates`: read-only sanitized list of the manager's candidate
 *    buffer (no content_md / source_refs / evidence_refs / embeddings).
 *  - `listDecisions`: read-only sanitized decision audit (no evidence_refs /
 *    decision_hash).
 *  - `jobsSummary`: queue counters + recent jobs with derived item progress
 *    (no locked_by / locked_at / heartbeat_at / last_error).
 *
 * Deliberately read-only: the memory lifecycle is exclusively owned by the
 * agent's memory manager (S9) — there is no renderer-driven mutation.
 */
export interface MemoryInspectorBridge {
  readonly listCandidates: (
    input: MemoryInspectorListCandidatesInput,
  ) => Promise<Result<MemoryInspectorListCandidatesResult>>;
  readonly listDecisions: (
    input: MemoryInspectorListDecisionsInput,
  ) => Promise<Result<MemoryInspectorListDecisionsResult>>;
  readonly jobsSummary: (
    input: MemoryInspectorJobsSummaryInput,
  ) => Promise<Result<MemoryJobsSummaryDto>>;
}
