/**
 * Engine — public API.
 *
 * Entry points for agent turn, mission setup, mission run, approval resume,
 * and subagent execution. Transport layer imports from here.
 */

export {
  processAgentTurn,
  processMissionSetupTurn,
  startMission,
  resumeMissionRun,
  recoverFailedMissionRun,
} from "./core/runner.js";

export { approveAndResume } from "./core/resume.js";
export { rejectApproval } from "./core/reject.js";
export { runTool } from "./core/run-tool.js";

// Puzzle 5 phase 3 — bounded prepare/runPrepared split for IPC handlers.
// Back-compat wrappers (`approveAndResume`/`rejectApproval`) keep their
// inline semantics for non-IPC callers; IPC must use these directly to
// avoid blocking the renderer on a full resumed turn loop.
export {
  prepareApprove,
  prepareReject,
  expireApproval,
  runResumeAfterDecision,
  discardContinuation,
  sweepExpiredApprovals,
  ApprovalDispatchError,
  ApprovalDecisionInconsistencyError,
  ApprovalPostDecisionError,
  type ApprovePrepareOutcome,
  type RejectPrepareOutcome,
  type PreparedContinuation,
  type SweepResult,
} from "./core/approval-runtime.js";

export { runSubagentEngine } from "./subagents/runner.js";

export { routeUserMessage, submitOperatorInstruction } from "./ingress.js";
export type { TurnRequestOptions } from "./core/runner.js";

export { startWakeExecutor } from "./wake/executor.js";
export type { WakeExecutorHandle, WakeDeps, ClaimedWake, ClaimedWakeOutcome } from "./wake/executor.js";

export { startCompactJobsExecutor } from "./compact-jobs/executor.js";
export type { CompactJobsExecutorHandle } from "./compact-jobs/executor.js";

export { startMemoryManagerExecutor } from "./memory-manager/executor.js";
export type {
  MemoryManagerExecutorHandle,
  StartMemoryManagerOptions,
} from "./memory-manager/executor.js";

export {
  abortMissionRun,
  abortActiveMissionForSession,
  stopActiveMissionForEdit,
} from "./core/runner/abort.js";
export type { AbortMissionRunResult, StopMissionRunForEditResult } from "./core/runner/abort.js";

export { retryActiveMissionRun } from "./core/runner/retry.js";

export * from "./types.js";
