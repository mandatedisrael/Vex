/**
 * Phase 4d — autonomous mission auto-retry scheduling.
 *
 * When a mission run throws a TRANSIENT provider/runtime error and the mission
 * opted in (autonomous-full only) and no irreversible side effect has occurred,
 * the run is auto-resumed after an exponential backoff, up to 5 times. After
 * that it stays `paused_error` for a human (Recover button).
 *
 * SAFETY (full mode has no approval backstop):
 *   - The eligibility decision reads the run row FRESH under a row lock — the
 *     unsafe stamp is written DURING tool dispatch, so any run object captured
 *     before the turn is stale.
 *   - The increment + paused_error persist happen in the SAME transaction, so a
 *     scheduled wake's `attempt` always matches the persisted `error_retry_count`.
 *   - The wake is enqueued AFTER commit; if that fails the run is simply left
 *     recoverable (no auto-resume) rather than half-scheduled.
 *   - Re-eligibility is RE-CHECKED atomically at wake-claim time
 *     (`claimRunForAutoRetry`) — this function only decides the schedule.
 */

import { withTransaction, queryOneWith } from "../../../db/client.js";
import type { PoolClient } from "pg";
import * as missionRunsRepo from "../../../db/repos/mission-runs.js";
import * as loopWakeRepo from "../../../db/repos/loop-wake.js";
import { classifyMissionRunError } from "./mission-error-classifier.js";
import { readMissionErrorSignal } from "./mission-error-signal.js";
import {
  AUTO_RETRY_WAKE_TRIGGER,
  MAX_AUTO_RETRIES,
  snapshotAutoRetryEnabled,
} from "./mission-auto-retry-policy.js";
import logger from "@utils/logger.js";

/** Backoff per attempt (1-indexed): attempt 1 → 2s, 2 → 4s, … 5 → 32s. */
const BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 32_000];

interface LockedRunRow {
  readonly status: string;
  readonly stop_reason: string | null;
  readonly error_retry_count: number;
  readonly auto_retry_unsafe: boolean;
  readonly contract_snapshot_json: Record<string, unknown> | null;
  readonly permission: string;
}

export interface ErrorPausePersistInput {
  readonly runId: string;
  readonly err: unknown;
  readonly summary: string;
  readonly evidenceBase: Record<string, unknown>;
}

export interface ErrorPauseDecision {
  /** Non-null when an auto-retry wake should be enqueued after commit. */
  readonly scheduled: { readonly attempt: number; readonly dueAt: string } | null;
}

/**
 * Decide auto-retry eligibility (fresh locked read), then persist `paused_error`
 * — incrementing the retry count in the SAME transaction when eligible. The
 * caller enqueues the wake AFTER this resolves.
 */
export async function persistErrorPauseWithMaybeAutoRetry(
  input: ErrorPausePersistInput,
  nowMs: number,
): Promise<ErrorPauseDecision> {
  const classified = classifyMissionRunError(input.err);
  const signal = readMissionErrorSignal(input.err);
  return withTransaction(async (client: PoolClient) => {
    const row = await queryOneWith<LockedRunRow>(
      client,
      `SELECT mr.status, mr.stop_reason, mr.error_retry_count, mr.auto_retry_unsafe,
              mr.contract_snapshot_json, s.permission
         FROM mission_runs mr
         JOIN sessions s ON s.id = mr.session_id
        WHERE mr.id = $1
        FOR UPDATE OF mr`,
      [input.runId],
    );

    const eligible =
      row !== null &&
      classified === "transient" &&
      row.auto_retry_unsafe === false &&
      row.error_retry_count < MAX_AUTO_RETRIES &&
      row.permission === "full" &&
      snapshotAutoRetryEnabled(row.contract_snapshot_json);

    // Error-diagnostics phase (D-RUNTIME): stamp the classification + the
    // reader's own-property signals on every paused_error row's evidence, so
    // a human recovering the run (or a later dashboard) can see WHY the
    // auto-retry decision went the way it did without re-deriving it.
    // `errorName` (raw `err.name`) is deliberately NOT persisted here — it is
    // arbitrary caller-controlled text, unlike the bounded `errorClass`
    // (`err.constructor.name`) evidenceBase already carries upstream and the
    // shape-validated `causeCode` below.
    const evidence: Record<string, unknown> = {
      ...input.evidenceBase,
      classified,
      statusCode: signal.status,
      causeCode: signal.causeCode,
    };
    let scheduled: { attempt: number; dueAt: string } | null = null;

    if (eligible) {
      // attempt = the new (post-increment) count, in [1, MAX_AUTO_RETRIES].
      const attempt = await missionRunsRepo.incrementErrorRetryCount(
        input.runId,
        client,
      );
      const dueAt = new Date(nowMs + BACKOFF_MS[attempt - 1]).toISOString();
      evidence.autoRetry = {
        attempt,
        maxAttempts: MAX_AUTO_RETRIES,
        nextRetryAt: dueAt,
      };
      scheduled = { attempt, dueAt };
    }

    await missionRunsRepo.updateStatus(
      input.runId,
      "paused_error",
      "provider_error",
      { summary: input.summary, evidence },
      client,
    );

    return { scheduled };
  });
}

/**
 * Enqueue the auto-retry wake (after the persist tx commits). A null/failed
 * enqueue leaves the run recoverable (no auto-resume) rather than represented
 * as actively retrying — logged, never thrown.
 */
export async function enqueueAutoRetryWake(input: {
  readonly sessionId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly dueAt: string;
}): Promise<void> {
  try {
    const row = await loopWakeRepo.enqueue({
      sessionId: input.sessionId,
      missionRunId: input.runId,
      dueAt: new Date(input.dueAt),
      reason: `auto_retry attempt ${input.attempt}/${MAX_AUTO_RETRIES}`,
      payload: { trigger: AUTO_RETRY_WAKE_TRIGGER, attempt: input.attempt },
    });
    if (row === null) {
      logger.warn("engine.mission.auto_retry_wake_not_enqueued", {
        runId: input.runId,
        sessionId: input.sessionId,
        attempt: input.attempt,
        reason: "pending_wake_exists",
      });
    }
  } catch (err) {
    logger.error("engine.mission.auto_retry_wake_enqueue_failed", {
      runId: input.runId,
      sessionId: input.sessionId,
      attempt: input.attempt,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
