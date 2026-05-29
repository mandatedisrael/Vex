import type { Result } from "../../../ipc/result.js";
import type {
  RuntimeCancelWakeResult,
  RuntimeRequestInput,
  RuntimeRequestPauseResult,
  RuntimeRequestResumeResult,
  RuntimeRequestStopResult,
  RuntimeStateDto,
} from "../../../schemas/runtime.js";

/**
 * Runtime state + control plane for the active mission run.
 *
 * `getState` is read-only. The four control mutations are LIVE
 * (puzzle 03 DB-backed control plane + runner leases): each resolves
 * to a `Result` wrapping that action's own per-action discriminated
 * union keyed on `outcome`, so the renderer narrows on `outcome` to
 * drive the correct UI transition. No raw owner IDs cross the boundary.
 */
export interface RuntimeBridge {
  readonly getState: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeStateDto>>;
  readonly requestPause: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeRequestPauseResult>>;
  readonly requestStop: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeRequestStopResult>>;
  readonly requestResume: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeRequestResumeResult>>;
  readonly cancelWake: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeCancelWakeResult>>;
}
