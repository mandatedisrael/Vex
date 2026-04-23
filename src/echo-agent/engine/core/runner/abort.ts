/**
 * Operator-driven mission abort.
 *
 * Host-only API — NOT exposed to the model. Lives outside `mission_stop`
 * tool surface (`tools/internal/mission.ts:22`) on purpose: `mission_stop`
 * with `reason="user_stopped"` is rejected by design (`mission.test.ts:78`)
 * because that reason is reserved for the operator path. This module is the
 * operator path.
 *
 * Cleanup invariant: after `abortMissionRun(runId)` resolves successfully,
 * NO future `approveAndResume` for that session can dispatch a tool. We get
 * that by:
 *   1. Cancelling pending wakes for the session (defensive — wake executor
 *      may already be claiming a `paused_wake` row when we fire).
 *   2. Rejecting every `pending` approval whose `session_id` matches the
 *      run's session. `approveAndResume` CAS in `approvalsRepo.approve`
 *      then fails because the row is no longer `pending`.
 *   3. Either firing the in-process `AbortSignal` (live loop, status drives
 *      itself to `cancelled` via `finalizeMissionRunStatus`) OR finalising
 *      directly when no controller is registered (paused states / out-of-
 *      process runs).
 *   4. The companion `resumeMissionRun` terminal guard now includes
 *      `cancelled`, and `approveAndResume` has a defensive pre-dispatch
 *      check that rejects when the active run is terminal.
 *
 * Multi-process note: the `AbortController` registry below is per-process.
 * If two processes run the same engine (e.g. a CLI host and the MCP server),
 * only the process that started/resumed the run can deliver the signal
 * cleanly. The DB-direct fall-through finalises the row for the other
 * process — race window is one in-flight turn — so either path leaves the
 * run terminal in DB. Cross-process abort signalling would need pub/sub
 * (Postgres LISTEN/NOTIFY or polling), which is out of scope.
 */

import type { MissionStatus } from "../../types.js";
import * as missionRunsRepo from "@echo-agent/db/repos/mission-runs.js";
import * as missionsRepo from "@echo-agent/db/repos/missions.js";
import * as approvalsRepo from "@echo-agent/db/repos/approvals.js";
import * as loopWakeRepo from "@echo-agent/db/repos/loop-wake.js";
import logger from "@utils/logger.js";

// ── In-process AbortController registry ─────────────────────────

const controllers = new Map<string, AbortController>();

/**
 * Hosts (`startMission`, `resumeMissionRun`) call this to obtain a controller
 * they MUST pass to `runTurnLoop`. Returns the existing controller if a
 * register call has already happened for this `runId` in this process — a
 * resume re-entry then sees the same signal as a concurrent abort caller.
 */
export function registerMissionRunAbortController(runId: string): AbortController {
  let c = controllers.get(runId);
  if (!c) {
    c = new AbortController();
    controllers.set(runId, c);
  }
  return c;
}

/** Hosts MUST call this in `finally` after `runTurnLoop` returns. */
export function unregisterMissionRunAbortController(runId: string): void {
  controllers.delete(runId);
}

export function hasMissionRunAbortController(runId: string): boolean {
  return controllers.has(runId);
}

// ── Public API ──────────────────────────────────────────────────

export interface AbortMissionRunResult {
  /**
   * `true` when the call changed state — either the in-process loop was
   * signalled OR the run was finalised directly. `false` for already-terminal
   * runs (no-op).
   */
  aborted: boolean;
  /**
   * Mission status after the call. May still be `"running"` if we only
   * fired the AbortSignal — the live loop finalises asynchronously to
   * `"cancelled"` once the next iteration check fires.
   */
  finalStatus: MissionStatus;
  /** Number of pending approvals rejected as part of this abort. */
  rejectedApprovals: number;
}

/**
 * Abort an active mission run. Operator-driven; safe to call concurrently
 * with the live loop. See module docstring for the cleanup invariant.
 */
export async function abortMissionRun(runId: string): Promise<AbortMissionRunResult> {
  const run = await missionRunsRepo.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const terminal = new Set(["completed", "failed", "stopped", "cancelled"]);
  if (terminal.has(run.status)) {
    return { aborted: false, finalStatus: run.status as MissionStatus, rejectedApprovals: 0 };
  }

  // Defensive even for `running`: wake executor could be about to claim a
  // `paused_wake` row that just raced us. Cheap no-op when nothing pending.
  await loopWakeRepo.cancelForSession(run.sessionId, "user_aborted");

  const rejectedApprovals = await rejectPendingApprovalsForSession(run.sessionId);
  if (rejectedApprovals > 0) {
    logger.info("engine.mission.abort_rejected_approvals", {
      runId,
      sessionId: run.sessionId,
      count: rejectedApprovals,
    });
  }

  // (a) `running` with live in-process loop → fire AbortSignal. Loop checks
  // `abortSignal?.aborted` at the top of each iteration (turn-loop.ts:138),
  // sets `stopReason = "user_stopped"`, breaks, and `finalizeMissionRunStatus`
  // (mission.ts:329) maps that to `cancelled`.
  if (run.status === "running" && controllers.has(runId)) {
    controllers.get(runId)!.abort();
    logger.info("engine.mission.abort_signaled", {
      runId,
      sessionId: run.sessionId,
    });
    return { aborted: true, finalStatus: "running", rejectedApprovals };
  }

  // (b) Paused states or out-of-process running → finalise directly using
  // the same status mapping the loop would have produced for `user_stopped`.
  await missionRunsRepo.updateStatus(runId, "cancelled", "user_stopped");
  await missionsRepo.setStatus(run.missionId, "cancelled");
  logger.info("engine.mission.abort_finalized_directly", {
    runId,
    sessionId: run.sessionId,
    previousStatus: run.status,
  });
  return { aborted: true, finalStatus: "cancelled", rejectedApprovals };
}

/** Resolve the active run for the session, then abort it. */
export async function abortActiveMissionForSession(
  sessionId: string,
): Promise<AbortMissionRunResult | null> {
  const activeRun = await missionRunsRepo.getActiveRunBySession(sessionId);
  if (!activeRun) return null;
  return abortMissionRun(activeRun.id);
}

// ── Internal helpers ────────────────────────────────────────────

/**
 * Filter the global pending-approvals list by sessionId and reject each.
 * `approval_queue` has no `mission_run_id`, but every approval enqueued
 * during a mission run carries the run's sessionId, so this is the safe
 * boundary. Per-row CAS in `approvalsRepo.reject` keeps the count honest
 * (we only count rows that were still `pending` at our CAS time).
 */
async function rejectPendingApprovalsForSession(sessionId: string): Promise<number> {
  const pending = await approvalsRepo.getPending();
  let count = 0;
  for (const approval of pending) {
    if (approval.sessionId !== sessionId) continue;
    const rejected = await approvalsRepo.reject(approval.id);
    if (rejected) count++;
  }
  return count;
}
