/**
 * Mission run finalisation — turns a `runTurnLoop` outcome (or a thrown
 * error) into the right `mission_runs` / `missions` row state.
 *
 * Two entry points:
 *   - `finalizeMissionRunStatus(...)` — happy path: the loop returned with
 *     a `stopReason` (or null for a still-running tape), and we map that
 *     to the correct terminal / paused / running status pair across the
 *     run row and its parent mission row.
 *   - `finalizeMissionRunError(...)` — provider error / hydrate failure /
 *     anything thrown from the post-`createRun` block in `startMission` or
 *     the post-`updateStatus("running")` block in `resumeMissionRun`.
 *     Persists `paused_error` with structured evidence; the caller is
 *     expected to re-throw `MissionRunPausedError` so shell wrappers map
 *     the failure to `{ ok: false }` instead of a fake "started" line.
 */

import type { MissionStatus, StopReason } from "../../types.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import logger from "@utils/logger.js";
import { consumeMissionRunAbortIntent } from "./abort.js";
import {
  isContinuableRuntimeStop,
  scheduleRuntimeContinuation,
} from "./runtime-continuation.js";

const ERROR_MESSAGE_LIMIT = 4096;

export async function finalizeMissionRunStatus(
  missionId: string,
  runId: string,
  sessionId: string,
  stopReason: StopReason | null,
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> },
): Promise<MissionStatus> {
  if (!stopReason) return "running";

  const { shouldTerminateRun } = await import("../stop-conditions.js");

  if (shouldTerminateRun(stopReason)) {
    if (stopReason === "user_stopped" && consumeMissionRunAbortIntent(runId) === "edit") {
      await missionRunsRepo.updateStatus(runId, "stopped", stopReason, stopPayload);
      await missionsRepo.clearApprovedAt(missionId);
      await missionsRepo.setStatus(missionId, "draft");
      return "draft";
    }

    const status: MissionStatus = stopReason === "goal_reached"
      ? "completed"
      : stopReason === "user_stopped"
        ? "cancelled"
        : "failed";
    await missionsRepo.setStatus(missionId, status);
    await missionRunsRepo.updateStatus(runId, status, stopReason, stopPayload);
    return status;
  }

  if (isContinuableRuntimeStop(stopReason)) {
    const continuation = await scheduleRuntimeContinuation({
      sessionId,
      missionRunId: runId,
      trigger: stopReason,
    });
    await missionRunsRepo.updateStatus(runId, "paused_wake", "waiting_for_wake", {
      summary: `${stopReason}: runtime slice exhausted; automatic continuation scheduled`,
      evidence: {
        trigger: stopReason,
        dueAt: continuation.dueAt,
        enqueued: continuation.enqueued,
      },
    });
    return "running";
  }

  if (stopReason === "system_error") {
    await missionsRepo.setStatus(missionId, "failed");
    await missionRunsRepo.updateStatus(runId, "failed", stopReason);
    return "failed";
  }

  // PR2 cutover: the runtime escalates to `compact_unable_at_critical` when
  // the forced-fallback compact returns `noop` twice in a row at critical
  // band — the agent cannot make forward progress without compaction it
  // refuses to perform. Treat as a paused error (operator intervention
  // surface) rather than a hard "failed" finalisation: the run row stays
  // visible for /retry just like provider-error pauses, and the parent
  // mission row stays `running` so the active-run lookup still surfaces it.
  if (stopReason === "compact_unable_at_critical") {
    await missionRunsRepo.updateStatus(runId, "paused_error", stopReason, {
      summary: stopPayload?.summary ?? "Two consecutive forced-fallback noops at critical pressure — operator review required.",
      evidence: stopPayload?.evidence,
    });
    return "running";
  }

  return "running";
}

/**
 * Persist a recoverable provider / runtime failure as `paused_error`.
 *
 * The mission row is intentionally left at `running` so `getActiveRunBySession`
 * still surfaces the run for `/retry` and the ingress-router paused_error
 * branch. The caller MUST re-throw `MissionRunPausedError` (defined in
 * engine/types.ts) so shell action wrappers turn the failure into a real
 * `{ ok: false, error, hint }` instead of a fake success.
 */
export async function finalizeMissionRunError(
  missionId: string,
  runId: string,
  sessionId: string,
  err: unknown,
): Promise<void> {
  const errorMessage = formatErrorMessage(err);
  const errorClass = err instanceof Error ? err.constructor.name : typeof err;
  // Log first — even if the DB write below fails, the failure stays visible.
  logger.error("engine.mission.runtime_throw", {
    runId,
    missionId,
    sessionId,
    errorClass,
    errorMessage,
  });

  try {
    await missionRunsRepo.updateStatus(runId, "paused_error", "provider_error", {
      summary: errorMessage,
      evidence: {
        errorMessage,
        errorClass,
        occurredAt: new Date().toISOString(),
        missionId,
        runId,
      },
    });
  } catch (dbErr: unknown) {
    logger.error("engine.mission.paused_error_persist_failed", {
      runId,
      missionId,
      sessionId,
      dbError: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
    // Re-throw so the caller's catch path still trips the recoverable
    // throw — masking the persist failure would silently leave the run
    // in `running` while the user sees the error, recreating the very
    // orphan-state bug this module exists to fix.
    throw dbErr;
  }
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, ERROR_MESSAGE_LIMIT);
  return String(err).slice(0, ERROR_MESSAGE_LIMIT);
}
