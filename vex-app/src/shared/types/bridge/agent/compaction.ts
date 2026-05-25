import type { Result } from "../../../ipc/result.js";
import type {
  CompactionStatusInput,
  CompactionStatusResult,
} from "../../../schemas/compaction.js";

/**
 * Compaction status — read-only Track-2 worker projection for the runtime
 * bar (agent integration stage 7-1). Returns the session's latest
 * `compact_jobs` row + active job count, or `null` for a missing/deleted/
 * out-of-scope session. The renderer never controls the executor.
 */
export interface CompactionBridge {
  readonly getStatus: (
    input: CompactionStatusInput,
  ) => Promise<Result<CompactionStatusResult>>;
}
