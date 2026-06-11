import type { Result } from "../../../ipc/result.js";
import type {
  LongMemoryListInput,
  LongMemoryListResult,
} from "../../../schemas/long-memory.js";

/**
 * Long-term memory inspection (memory-system S9 rewire).
 *  - `list`: read-only sanitized list of the global long-term memory store
 *    (no content_md / source_refs / embeddings).
 *
 * Deliberately read-only: the lifecycle is owned by the agent's memory
 * manager — there is no renderer-driven mutation of long-term memory.
 */
export interface LongMemoryBridge {
  readonly list: (
    input: LongMemoryListInput,
  ) => Promise<Result<LongMemoryListResult>>;
}
