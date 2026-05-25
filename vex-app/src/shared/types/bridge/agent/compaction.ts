import type { Result } from "../../../ipc/result.js";
import type {
  CompactionHistoryInput,
  CompactionHistoryResult,
  CompactionStatusInput,
  CompactionStatusResult,
} from "../../../schemas/compaction.js";

/**
 * Compaction status + history — read-only Track-2 projections.
 *  - `getStatus` (7-1): latest job + active count for the runtime-bar chip;
 *    `null` for a missing/deleted/out-of-scope session.
 *  - `listHistory` (7-2a): the session's compaction-generation timeline for
 *    the knowledge/memory panel; `null` for a missing/foreign session.
 * The renderer never controls the executor.
 */
export interface CompactionBridge {
  readonly getStatus: (
    input: CompactionStatusInput,
  ) => Promise<Result<CompactionStatusResult>>;
  readonly listHistory: (
    input: CompactionHistoryInput,
  ) => Promise<Result<CompactionHistoryResult>>;
}
