/**
 * Engine — public API.
 *
 * Entry points for chat, mission setup, mission run, approval resume,
 * and subagent execution. Transport layer imports from here.
 */

export {
  processChatTurn,
  processMissionSetupTurn,
  startMission,
  resumeMissionRun,
  processFullAutonomousTurn,
  resumeFullAutonomousSession,
} from "./core/runner.js";

export { approveAndResume } from "./core/resume.js";
export { rejectApproval } from "./core/reject.js";
export { runTool } from "./core/run-tool.js";

export { runSubagentEngine } from "./subagents/runner.js";

export { routeUserMessage } from "./ingress.js";

export { startWakeExecutor } from "./wake/executor.js";
export type { WakeExecutorHandle, WakeDeps, ClaimedWake, ClaimedWakeOutcome } from "./wake/executor.js";

export {
  abortMissionRun,
  abortActiveMissionForSession,
} from "./core/runner/abort.js";
export type { AbortMissionRunResult } from "./core/runner/abort.js";

export * from "./types.js";
