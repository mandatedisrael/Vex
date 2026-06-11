import type { Result } from "../../../ipc/result.js";
import type {
  CompactionHistoryInput,
  CompactionHistoryResult,
  CompactionRetryInput,
  CompactionRetryResult,
  CompactionStatusInput,
  CompactionStatusResult,
} from "../../../schemas/compaction.js";

/**
 * Compaction status + history (read) + retry (the one mutation).
 *  - `getStatus` (7-1): latest job + active count for the runtime-bar chip;
 *    `null` for a missing/deleted/out-of-scope session.
 *  - `listHistory` (7-2a): the session's compaction-generation timeline for
 *    the memory panel; `null` for a missing/foreign session.
 *  - `retry` (8-5): re-enqueue a permanently-failed generation for another
 *    attempt. The renderer never controls the executor's scheduling.
 */
export interface CompactionBridge {
  readonly getStatus: (
    input: CompactionStatusInput,
  ) => Promise<Result<CompactionStatusResult>>;
  readonly listHistory: (
    input: CompactionHistoryInput,
  ) => Promise<Result<CompactionHistoryResult>>;
  readonly retry: (
    input: CompactionRetryInput,
  ) => Promise<Result<CompactionRetryResult>>;
}
