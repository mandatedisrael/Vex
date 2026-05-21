/**
 * `observeAndApplyControl` — atomic observe + apply for
 * `pause_after_step` / `stop_terminal` control requests. Called from
 * engine safe checkpoints (turn-loop iteration boundary).
 *
 *   1. Lock the next pending request matching `kinds`
 *      (`FOR UPDATE SKIP LOCKED`).
 *   2. Lock the active mission_run for that session (if any).
 *   3. For `pause_after_step`: UPDATE run status='paused_user',
 *      stop_reason='user_paused'. Wake cleanup conditional on
 *      `previousStatus === "paused_wake"`.
 *   4. For `stop_terminal`: UPDATE run status='stopped' uniformly
 *      (puzzle 04 may refine to 'cancelled' when there's no committed
 *      work yet). Cancel pending wakes. Release the lease so a future
 *      resume can re-claim.
 *   5. Mark the request `cleared`.
 *
 * Returns the outcome discriminator + previous status + wake count.
 * Event broadcast happens AFTER the surrounding caller acts on the
 * returned outcome (so the bus emits only after commit).
 */

import {
  withTransaction,
  queryOneWith,
  executeWith,
} from "../../../db/client.js";
import { TERMINAL_RUN_STATUSES } from "../../types.js";
import type {
  ObserveControlInput,
  ObserveControlOutcome,
} from "./_types.js";
import {
  type ControlRequestRow,
  type MissionRunRow,
  mapControlRequest,
} from "./_row-shapes.js";

export async function observeAndApplyControl(
  input: ObserveControlInput,
): Promise<ObserveControlOutcome> {
  return withTransaction(async (client) => {
    // 1. Lock next matching pending request.
    const claimed = await queryOneWith<{ id: string }>(
      client,
      `SELECT id FROM runtime_control_requests
        WHERE session_id = $1
          AND kind = ANY($2::text[])
          AND status = 'pending'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [input.sessionId, input.kinds],
    );
    if (claimed === null) {
      return { outcome: "no_request" };
    }

    const observedRow = await queryOneWith<ControlRequestRow>(
      client,
      `UPDATE runtime_control_requests
          SET status      = 'observed',
              observed_at = NOW()
        WHERE id = $1
        RETURNING id, session_id, mission_run_id, kind, status, requested_by,
                  reason, correlation_id, created_at, observed_at,
                  cleared_at, expires_at`,
      [claimed.id],
    );
    if (observedRow === null) {
      throw new Error(
        "observeAndApplyControl: request row vanished between SELECT and UPDATE",
      );
    }
    const request = mapControlRequest(observedRow);

    // 2. Lock the active run for this session (if any).
    const activeRun = await queryOneWith<MissionRunRow>(
      client,
      `SELECT id, status, session_id
         FROM mission_runs
        WHERE session_id = $1
          AND status NOT IN (${[...TERMINAL_RUN_STATUSES].map((_, i) => `$${i + 2}`).join(", ")})
        ORDER BY started_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.sessionId, ...TERMINAL_RUN_STATUSES],
    );

    // 3+4. Apply the state transition by kind.
    if (request.kind === "pause_after_step") {
      if (activeRun === null) {
        // No active run to pause — just clear and emit a no-op outcome.
        await executeWith(
          client,
          `UPDATE runtime_control_requests
              SET status     = 'cleared',
                  cleared_at = NOW(),
                  reason     = COALESCE(reason, 'no_active_run')
            WHERE id = $1`,
          [request.id],
        );
        return {
          outcome: "paused_user_applied",
          request,
          previousStatus: "running",
          wakeCancelledCount: 0,
        };
      }
      const previousStatus = activeRun.status;

      await executeWith(
        client,
        `UPDATE mission_runs
            SET status        = 'paused_user',
                stop_reason   = 'user_paused',
                last_checkpoint_at = NOW()
          WHERE id = $1`,
        [activeRun.id],
      );

      let wakeCancelledCount = 0;
      if (previousStatus === "paused_wake") {
        wakeCancelledCount = await executeWith(
          client,
          `UPDATE loop_wake_requests
              SET status            = 'cancelled',
                  cancelled_at      = NOW(),
                  cancelled_reason  = 'consumed_by_pause'
            WHERE session_id = $1 AND status = 'pending'`,
          [input.sessionId],
        );
      }

      await executeWith(
        client,
        `UPDATE runtime_control_requests
            SET status      = 'cleared',
                cleared_at  = NOW()
          WHERE id = $1`,
        [request.id],
      );

      return {
        outcome: "paused_user_applied",
        request,
        previousStatus,
        wakeCancelledCount,
      };
    }

    // stop_terminal
    if (activeRun === null) {
      await executeWith(
        client,
        `UPDATE runtime_control_requests
            SET status     = 'cleared',
                cleared_at = NOW(),
                reason     = COALESCE(reason, 'no_active_run')
          WHERE id = $1`,
        [request.id],
      );
      return {
        outcome: "stop_applied",
        request,
        previousStatus: "running",
        terminalStatus: "stopped",
        wakeCancelledCount: 0,
      };
    }
    const previousStatus = activeRun.status;

    await executeWith(
      client,
      `UPDATE mission_runs
          SET status      = 'stopped',
              stop_reason = 'user_stopped',
              ended_at    = NOW(),
              last_checkpoint_at = NOW()
        WHERE id = $1`,
      [activeRun.id],
    );

    const wakeCancelledCount = await executeWith(
      client,
      `UPDATE loop_wake_requests
          SET status            = 'cancelled',
              cancelled_at      = NOW(),
              cancelled_reason  = 'consumed_by_stop'
        WHERE session_id = $1 AND status = 'pending'`,
      [input.sessionId],
    );

    // Release any active lease so a future fresh run can claim.
    await executeWith(
      client,
      `DELETE FROM runner_leases WHERE session_id = $1`,
      [input.sessionId],
    );

    await executeWith(
      client,
      `UPDATE runtime_control_requests
          SET status     = 'cleared',
              cleared_at = NOW()
        WHERE id = $1`,
      [request.id],
    );

    return {
      outcome: "stop_applied",
      request,
      previousStatus,
      terminalStatus: "stopped",
      wakeCancelledCount,
    };
  });
}
