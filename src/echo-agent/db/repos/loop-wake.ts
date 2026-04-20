/**
 * Loop wake requests repo — durable substrate for `loop_defer` (PR-5) and
 * the wake executor (PR-7).
 *
 * Schema lives in `011_loop_wake_requests.sql`. Rows progress one-way:
 *   pending → consumed (executor `claimDue`)
 *   pending → cancelled (ingress router `cancelForSession` on user preempt)
 *
 * Invariants enforced by the schema:
 *   - At most one pending row per session (`uniq_loop_wake_pending_per_session`
 *     partial unique index). `enqueue` relies on this via
 *     `ON CONFLICT DO NOTHING` — re-enqueueing while pending returns `null`
 *     so callers can detect the no-op without a separate pre-check.
 *   - `status` CHECK constraint — only the three known values persist.
 *   - `kind` CHECK constraint — only `mission_run` / `full_autonomous`.
 *
 * Exactly-once claim (`claimDue`): single UPDATE that selects due pending
 * rows via `FOR UPDATE SKIP LOCKED` and flips them to `consumed`. Using a
 * dedicated short-lived `PoolClient` so the SKIP LOCKED predicate and the
 * UPDATE live in the same transaction — race-safe across concurrent
 * executor ticks (see LeadDev audit must-fix #4 rationale).
 */

import type { PoolClient } from "pg";
import { getPool, queryOne, queryOneWith, execute } from "../client.js";

// ── Types ───────────────────────────────────────────────────────────

export type LoopWakeKind = "mission_run" | "full_autonomous";
export type LoopWakeStatus = "pending" | "consumed" | "cancelled";

export interface LoopWakeRequest {
  id: string;
  sessionId: string;
  missionRunId: string | null;
  kind: LoopWakeKind;
  dueAt: string;
  status: LoopWakeStatus;
  reason: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  consumedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
}

interface LoopWakeRow {
  id: string;
  session_id: string;
  mission_run_id: string | null;
  kind: string;
  due_at: string | Date;
  status: string;
  reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | Date;
  consumed_at: string | Date | null;
  cancelled_at: string | Date | null;
  cancelled_reason: string | null;
}

function isoOrNull(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function mapRow(r: LoopWakeRow): LoopWakeRequest {
  return {
    id: r.id,
    sessionId: r.session_id,
    missionRunId: r.mission_run_id,
    kind: r.kind as LoopWakeKind,
    dueAt: iso(r.due_at),
    status: r.status as LoopWakeStatus,
    reason: r.reason,
    payload: r.payload,
    createdAt: iso(r.created_at),
    consumedAt: isoOrNull(r.consumed_at),
    cancelledAt: isoOrNull(r.cancelled_at),
    cancelledReason: r.cancelled_reason,
  };
}

// ── Enqueue ─────────────────────────────────────────────────────────

export interface EnqueueInput {
  sessionId: string;
  missionRunId: string | null;
  kind: LoopWakeKind;
  dueAt: Date;
  reason: string | null;
  payload: Record<string, unknown> | null;
}

/**
 * Insert a pending wake row. Returns the inserted row, or `null` when a
 * pending row already exists for this session (partial unique index hits
 * `ON CONFLICT DO NOTHING`). Callers — today only the `loop_defer` handler
 * in PR-5 — treat `null` as a no-op and surface that back to the model so
 * it doesn't double-enqueue.
 */
export async function enqueue(input: EnqueueInput): Promise<LoopWakeRequest | null> {
  const row = await queryOne<LoopWakeRow>(
    `INSERT INTO loop_wake_requests
       (session_id, mission_run_id, kind, due_at, status, reason, payload)
     VALUES ($1, $2, $3, $4::timestamptz, 'pending', $5, $6::jsonb)
     ON CONFLICT (session_id) WHERE status = 'pending' DO NOTHING
     RETURNING *`,
    [
      input.sessionId,
      input.missionRunId,
      input.kind,
      input.dueAt.toISOString(),
      input.reason,
      input.payload === null ? null : JSON.stringify(input.payload),
    ],
  );
  return row ? mapRow(row) : null;
}

// ── Cancel ──────────────────────────────────────────────────────────

/**
 * Cancel every pending wake for the given session — typically called once
 * at the start of `routeUserMessage` (PR-7 ingress router) before the new
 * user message is persisted, so a freshly-preempted user turn doesn't race
 * with a wake banner injection.
 *
 * Returns the number of rows flipped pending → cancelled. Zero is normal
 * (no wake was pending). The caller must NOT treat a non-zero count as
 * an assumption that a banner hasn't already been injected — cancel loses
 * a race against an in-flight `claimDue` (see PR-7 executor re-check).
 */
export async function cancelForSession(
  sessionId: string,
  reason: string,
): Promise<number> {
  return execute(
    `UPDATE loop_wake_requests
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancelled_reason = $2
     WHERE session_id = $1 AND status = 'pending'`,
    [sessionId, reason],
  );
}

// ── Claim due (exactly-once) ────────────────────────────────────────

/**
 * Atomically claim up to `limit` pending wake rows whose `due_at <= now`.
 *
 * The UPDATE takes a short-lived dedicated connection (`pool.connect()`)
 * and runs inside an explicit `BEGIN…COMMIT` so the `SELECT … FOR UPDATE
 * SKIP LOCKED` inner query and the `UPDATE … SET status='consumed'` outer
 * statement share the same transaction. That combination is the race-safe
 * contract: two parallel `claimDue` calls see disjoint row sets, because
 * the inner select skips rows that the other transaction has already
 * locked.
 *
 * Every returned row is now in status `consumed` (DB-side). Callers must
 * tolerate the row set being smaller than `limit` (possibly empty) — that
 * means either fewer rows were due or other executors raced ahead.
 */
export async function claimDue(
  now: Date,
  limit: number,
): Promise<LoopWakeRequest[]> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<LoopWakeRow>(
      `UPDATE loop_wake_requests
       SET status = 'consumed', consumed_at = NOW()
       WHERE id IN (
         SELECT id FROM loop_wake_requests
         WHERE status = 'pending' AND due_at <= $1::timestamptz
         ORDER BY due_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [now.toISOString(), limit],
    );
    await client.query("COMMIT");
    return result.rows.map(mapRow);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Swallow rollback errors — the original failure is what the caller needs.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ── Read ────────────────────────────────────────────────────────────

/**
 * Fetch the current pending wake for this session, if any. Used by the
 * executor's resume-path sanity check and by ingress routing to decide
 * whether a user message is preempting a deferred turn.
 */
export async function getPendingForSession(
  sessionId: string,
): Promise<LoopWakeRequest | null> {
  const row = await queryOneWith<LoopWakeRow>(
    getPool(),
    `SELECT * FROM loop_wake_requests
     WHERE session_id = $1 AND status = 'pending'
     LIMIT 1`,
    [sessionId],
  );
  return row ? mapRow(row) : null;
}
