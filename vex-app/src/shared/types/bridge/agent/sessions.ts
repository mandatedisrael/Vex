import type { Result } from "../../../ipc/result.js";
import type {
  SessionCreateInput,
  SessionCreateResult,
  SessionDeleteInput,
  SessionDeleteResult,
  SessionGetInput,
  SessionGetModelInput,
  SessionList,
  SessionListItem,
  SessionModelDto,
  SessionSetPinnedInput,
  SessionSetPinnedResult,
} from "../../../schemas/sessions.js";

export interface SessionsBridge {
  readonly create: (
    input: SessionCreateInput
  ) => Promise<Result<SessionCreateResult>>;
  readonly list: () => Promise<Result<SessionList>>;
  readonly get: (
    input: SessionGetInput
  ) => Promise<Result<SessionListItem | null>>;
  /**
   * Pin/unpin a session. Idempotent on both sides: re-pinning preserves
   * the existing `pinnedAt`, re-unpinning is a no-op. Returns `null`
   * when the id is unknown (stale renderer cache).
   */
  readonly setPinned: (
    input: SessionSetPinnedInput
  ) => Promise<Result<SessionSetPinnedResult>>;
  /**
   * Soft-delete a session. Main enforces fail-closed against active
   * mission runs and pending approvals; the discriminated outcome
   * tells the renderer whether cache cleanup is appropriate.
   */
  readonly delete: (
    input: SessionDeleteInput
  ) => Promise<Result<SessionDeleteResult>>;
  /**
   * Resolve the global runtime model for the session — `source:
   * "global_default"` (from `AGENT_PROVIDER`/`AGENT_MODEL`) or
   * `"unconfigured"`. Vex uses one global model; there is no
   * per-session model write.
   */
  readonly getModel: (
    input: SessionGetModelInput
  ) => Promise<Result<SessionModelDto>>;
}
