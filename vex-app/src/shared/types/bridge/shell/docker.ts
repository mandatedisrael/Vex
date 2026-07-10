import type { Result } from "../../../ipc/result.js";
import type {
  ComposeDownResult,
  ComposeLog,
  ComposeUpResult,
  DockerStatus,
  InstallMethod,
  InstallProgress,
  InstallResult,
  StartResult,
  StopPreviousInstallStacksResult,
} from "../../../schemas/docker.js";
import type { AbortableInvocation } from "../common.js";

export interface DockerBridge {
  readonly detect: () => Promise<Result<DockerStatus>>;
  readonly install: (input: {
    readonly method: InstallMethod;
  }) => Promise<Result<InstallResult>>;
  readonly start: () => Promise<Result<StartResult>>;
  readonly composeUp: (input: {
    readonly pgPort?: number;
  }) => Promise<Result<ComposeUpResult>>;
  /**
   * Abortable variant of `composeUp` (PR3). Returns
   * `{promise, cancel}` so the renderer can let the user abort an
   * in-flight bootstrap (e.g. a slow image pull). On cancel, the
   * returned promise resolves to `Result<E:internal.cancelled>`.
   *
   * NOTE: this hits the SAME IPC channel as `composeUp` and shares
   * the same main-side single-flight semantics. A joined caller's
   * cancel detaches THAT caller's wait only — it never aborts the
   * shared compose subprocess (only the initiator's signal flows
   * into `runSpawn`).
   */
  readonly composeUpAbortable: (input: {
    readonly pgPort?: number;
  }) => AbortableInvocation<ComposeUpResult>;
  readonly composeDown: () => Promise<Result<ComposeDownResult>>;
  readonly stopPreviousInstallStacks: () => Promise<
    Result<StopPreviousInstallStacksResult>
  >;
  /**
   * Subscribe to install progress events. Returns an idempotent
   * unsubscribe function — call it from the React effect cleanup
   * (skill §11). The renderer never sees the raw IPC channel.
   */
  readonly onInstallProgress: (
    cb: (payload: InstallProgress) => void
  ) => () => void;
  readonly onComposeLog: (cb: (payload: ComposeLog) => void) => () => void;
}
