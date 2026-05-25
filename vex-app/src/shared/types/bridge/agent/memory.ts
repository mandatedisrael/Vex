import type { Result } from "../../../ipc/result.js";
import type {
  MemoryStatsInput,
  MemoryStatsResult,
  SessionMemoryListInput,
  SessionMemoryListResult,
} from "../../../schemas/memory.js";

/**
 * Session memory — read-only per-session list + stats (agent integration
 * stage 7-2a). Sanitized (no narrative bodies / raw outstanding items /
 * embeddings; outstanding work as counts). Both return `null` for a
 * missing/foreign/deleted session.
 */
export interface MemoryBridge {
  readonly listSession: (
    input: SessionMemoryListInput,
  ) => Promise<Result<SessionMemoryListResult>>;
  readonly getStats: (
    input: MemoryStatsInput,
  ) => Promise<Result<MemoryStatsResult>>;
}
