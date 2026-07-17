/**
 * Runtime control requests repo — durable user-initiated control plane
 * for the agent runtime (puzzle 03).
 *
 * Lifecycle of a row:
 *
 *   `pending`   — user-initiated request from `vex.runtime.request*` IPC.
 *   `observed`  — engine has read the request at a safe checkpoint and
 *                 is about to apply the matching state transition.
 *   `cleared`   — state transition committed; request semantics applied.
 *   `failed`    — request couldn't be applied (e.g. blocked_approval,
 *                 lease_busy, status mismatch). `reason` carries detail.
 *   `expired`   — `expires_at < NOW()` and the sweep marked it.
 *
 * Engine reads pending rows under `FOR UPDATE SKIP LOCKED` so multiple
 * concurrent checkpoint readers (different sessions) never block each
 * other. Within a session the partial index keeps the hot-path read
 * cheap.
 */

import type { PoolClient } from "pg";
import {
  query,
  queryOneWith,
  executeWith,
  type Executor,
} from "../client.js";

export type ControlRequestKind =
  | "pause_after_step"
  | "stop_terminal"
  | "resume"
  | "cancel_wake";

export type ControlRequestStatus =
  | "pending"
  | "observed"
  | "cleared"
  | "expired"
  | "failed";

export type ControlRequestSource = "user" | "system";

export interface ControlRequest {
  readonly id: string;
  readonly sessionId: string;
  readonly missionRunId: string | null;
  readonly kind: ControlRequestKind;
  readonly status: ControlRequestStatus;
  readonly requestedBy: ControlRequestSource;
  readonly reason: string | null;
  readonly correlationId: string | null;
  readonly createdAt: Date;
  readonly observedAt: Date | null;
  readonly clearedAt: Date | null;
  readonly expiresAt: Date | null;
}

interface ControlRequestRow {
  readonly id: string;
  readonly session_id: string;
  readonly mission_run_id: string | null;
  readonly kind: ControlRequestKind;
  readonly status: ControlRequestStatus;
  readonly requested_by: ControlRequestSource;
  readonly reason: string | null;
  readonly correlation_id: string | null;
  readonly created_at: Date;
  readonly observed_at: Date | null;
  readonly cleared_at: Date | null;
  readonly expires_at: Date | null;
}

function mapRow(r: ControlRequestRow): ControlRequest {
  return {
    id: r.id,
    sessionId: r.session_id,
    missionRunId: r.mission_run_id,
    kind: r.kind,
    status: r.status,
    requestedBy: r.requested_by,
    reason: r.reason,
    correlationId: r.correlation_id,
    createdAt: r.created_at,
    observedAt: r.observed_at,
    clearedAt: r.cleared_at,
    expiresAt: r.expires_at,
  };
}

export interface EnqueueInput {
  readonly sessionId: string;
  readonly missionRunId?: string | null;
  readonly kind: ControlRequestKind;
  readonly requestedBy: ControlRequestSource;
  readonly reason?: string | null;
  readonly correlationId?: string | null;
  readonly expiresAt?: Date | null;
  /**
   * Narrow two-value union (NOT the full `ControlRequestStatus`) — a caller
   * that already applied the control action synchronously (e.g. cancel_wake)
   * can insert the audit row already `'cleared'` instead of enqueueing a
   * `'pending'` row nothing will ever observe or clear. Defaults to
   * `'pending'`, the historical behavior for every other caller.
   */
  readonly initialStatus?: "pending" | "cleared";
}

/** INSERT a new control request. Returns the inserted row. */
export async function enqueueRequest(
  input: EnqueueInput,
  exec?: Executor,
): Promise<ControlRequest> {
  const status = input.initialStatus ?? "pending";
  const row = await queryOneWith<ControlRequestRow>(
    exec ?? (await import("../client.js")).getPool(),
    `INSERT INTO runtime_control_requests
       (session_id, mission_run_id, kind, requested_by, reason, correlation_id, expires_at, status, cleared_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'cleared' THEN NOW() ELSE NULL END)
     RETURNING id, session_id, mission_run_id, kind, status, requested_by,
               reason, correlation_id, created_at, observed_at, cleared_at, expires_at`,
    [
      input.sessionId,
      input.missionRunId ?? null,
      input.kind,
      input.requestedBy,
      input.reason ?? null,
      input.correlationId ?? null,
      input.expiresAt ?? null,
      status,
    ],
  );
  if (row === null) {
    throw new Error("enqueueRequest: INSERT...RETURNING returned no row");
  }
  return mapRow(row);
}

/**
 * Find the next pending request for a session that matches `kinds`,
 * lock it `FOR UPDATE SKIP LOCKED`, and atomically flip to `observed`.
 * Used at engine safe checkpoints — returns `null` if no matching
 * pending request exists.
 *
 * **Caller must already be inside `withTransaction(...)`.** The repo
 * does NOT open its own transaction so the surrounding work (lease
 * claim, status flip, wake cancel) joins the same commit.
 */
export async function observePending(
  sessionId: string,
  kinds: readonly ControlRequestKind[],
  client: PoolClient,
): Promise<ControlRequest | null> {
  // Lock the next matching pending row. SKIP LOCKED so concurrent
  // checkpoint readers on different sessions never wait.
  const claimed = await queryOneWith<{ id: string }>(
    client,
    `SELECT id FROM runtime_control_requests
       WHERE session_id = $1
         AND kind = ANY($2::text[])
         AND status = 'pending'
       ORDER BY created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    [sessionId, kinds],
  );
  if (claimed === null) return null;

  const updated = await queryOneWith<ControlRequestRow>(
    client,
    `UPDATE runtime_control_requests
       SET status = 'observed', observed_at = NOW()
     WHERE id = $1
     RETURNING id, session_id, mission_run_id, kind, status, requested_by,
               reason, correlation_id, created_at, observed_at, cleared_at, expires_at`,
    [claimed.id],
  );
  if (updated === null) {
    throw new Error("observePending: row vanished between SELECT and UPDATE");
  }
  return mapRow(updated);
}

/** Read-only: list pending or observed requests for a session. */
export async function getPendingForSession(
  sessionId: string,
): Promise<ControlRequest[]> {
  const rows = await query<ControlRequestRow>(
    `SELECT id, session_id, mission_run_id, kind, status, requested_by,
            reason, correlation_id, created_at, observed_at, cleared_at, expires_at
       FROM runtime_control_requests
      WHERE session_id = $1
        AND status IN ('pending', 'observed')
      ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(mapRow);
}

export async function markCleared(
  id: string,
  reason: string | null = null,
  exec?: Executor,
): Promise<void> {
  await executeWith(
    exec ?? (await import("../client.js")).getPool(),
    `UPDATE runtime_control_requests
       SET status = 'cleared', cleared_at = NOW(), reason = COALESCE($2, reason)
     WHERE id = $1
       AND status IN ('pending', 'observed')`,
    [id, reason],
  );
}

export async function markFailed(
  id: string,
  reason: string,
  exec?: Executor,
): Promise<void> {
  await executeWith(
    exec ?? (await import("../client.js")).getPool(),
    `UPDATE runtime_control_requests
       SET status = 'failed', cleared_at = NOW(), reason = $2
     WHERE id = $1
       AND status IN ('pending', 'observed')`,
    [id, reason],
  );
}

export async function markObserved(
  id: string,
  exec?: Executor,
): Promise<void> {
  await executeWith(
    exec ?? (await import("../client.js")).getPool(),
    `UPDATE runtime_control_requests
       SET status = 'observed', observed_at = NOW()
     WHERE id = $1
       AND status = 'pending'`,
    [id],
  );
}

/**
 * Background sweep: mark requests as `expired` whose `expires_at` has
 * passed and that are still pending or observed.
 */
export async function expireDue(
  now: Date,
  exec?: Executor,
): Promise<number> {
  return executeWith(
    exec ?? (await import("../client.js")).getPool(),
    `UPDATE runtime_control_requests
       SET status = 'expired', cleared_at = NOW()
     WHERE expires_at IS NOT NULL
       AND expires_at < $1
       AND status IN ('pending', 'observed')`,
    [now],
  );
}
