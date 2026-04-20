/**
 * Checkpoint handoffs repo — durable substrate for the PR-9 pre-checkpoint
 * handoff contract. One active row per `(session_id, target_generation)` at
 * any time; concurrent writers race via latest-wins superseding.
 *
 * Consumption happens inside `runCheckpointWriteTx` (PR-8 per-session
 * mutex + FOR UPDATE row lock) so the handoff for the freshly-bumped
 * generation is read, applied, and flipped to `consumed` atomically with
 * the `sessions.checkpoint_generation` bump.
 */

import type { PoolClient } from "pg";
import { getPool, queryOne, queryOneWith } from "../client.js";

// ── Types ───────────────────────────────────────────────────────────

export type CheckpointHandoffStatus = "active" | "consumed" | "superseded";

export interface CheckpointHandoffPayload {
  /**
   * Free-form preserve directives, ≤ 2000 chars. Intended as the model's
   * own note about what must survive compaction (e.g. "plan already picked,
   * only step 3 executed"). Merged into the rolling summary input.
   */
  preserveMd: string;
  /** Recall seed used by PR-10's `effectiveRecallSeed` post-wake / post-compact. */
  preferredRecallQuery: string;
  /** Stable identifiers to prioritise in recall (wallet ids, symbols, etc.). */
  importantEntities: string[];
  /** Unresolved follow-ups the model wants the post-compact turn to see. */
  openLoops: string[];
}

export interface CheckpointHandoff {
  id: string;
  sessionId: string;
  targetCheckpointGeneration: number;
  payload: CheckpointHandoffPayload;
  status: CheckpointHandoffStatus;
  createdAt: string;
  consumedAt: string | null;
}

interface CheckpointHandoffRow {
  id: string;
  session_id: string;
  target_checkpoint_generation: number;
  payload: CheckpointHandoffPayload;
  status: string;
  created_at: string | Date;
  consumed_at: string | Date | null;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(r: CheckpointHandoffRow): CheckpointHandoff {
  return {
    id: r.id,
    sessionId: r.session_id,
    targetCheckpointGeneration: r.target_checkpoint_generation,
    payload: r.payload,
    status: r.status as CheckpointHandoffStatus,
    createdAt: toIso(r.created_at),
    consumedAt: r.consumed_at === null ? null : toIso(r.consumed_at),
  };
}

// ── Write (latest-wins) ─────────────────────────────────────────────

/**
 * Write an active handoff for `(sessionId, targetGen)`. If an active row
 * already exists for that pair (concurrent tool call on the same turn),
 * flip it to `superseded` and insert the new row in the SAME transaction
 * so there is never a window with zero active handoffs for a target_gen
 * that the checkpoint could observe.
 *
 * Callers may provide their own `PoolClient` when bundling with other
 * writes (not used today but kept for symmetry with the other repos).
 */
export async function writeHandoff(
  sessionId: string,
  targetGeneration: number,
  payload: CheckpointHandoffPayload,
  client?: PoolClient,
): Promise<CheckpointHandoff> {
  if (client) {
    return runWriteHandoff(client, sessionId, targetGeneration, payload);
  }
  const pool = getPool();
  const own = await pool.connect();
  try {
    await own.query("BEGIN");
    const row = await runWriteHandoff(own, sessionId, targetGeneration, payload);
    await own.query("COMMIT");
    return row;
  } catch (err) {
    try {
      await own.query("ROLLBACK");
    } catch {
      // Swallow — original error is what matters.
    }
    throw err;
  } finally {
    own.release();
  }
}

async function runWriteHandoff(
  tx: PoolClient,
  sessionId: string,
  targetGeneration: number,
  payload: CheckpointHandoffPayload,
): Promise<CheckpointHandoff> {
  // Flip any existing active row to superseded. Partial unique index allows
  // multiple `superseded` rows, so this is safe even under concurrent writers.
  await tx.query(
    `UPDATE checkpoint_handoffs
     SET status = 'superseded'
     WHERE session_id = $1
       AND target_checkpoint_generation = $2
       AND status = 'active'`,
    [sessionId, targetGeneration],
  );

  const result = await tx.query<CheckpointHandoffRow>(
    `INSERT INTO checkpoint_handoffs
       (session_id, target_checkpoint_generation, payload, status)
     VALUES ($1, $2, $3::jsonb, 'active')
     RETURNING *`,
    [sessionId, targetGeneration, JSON.stringify(payload)],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("writeHandoff: INSERT RETURNING produced no row");
  }
  return mapRow(row);
}

// ── Read ────────────────────────────────────────────────────────────

/**
 * Look up the active handoff for `(sessionId, targetGen)`. Returns `null`
 * when none exists — Phase II of the checkpoint treats that as "nothing to
 * apply" and proceeds with the normal prefix-based summary.
 */
export async function getActive(
  sessionId: string,
  targetGeneration: number,
  client?: PoolClient,
): Promise<CheckpointHandoff | null> {
  const sql = `SELECT * FROM checkpoint_handoffs
               WHERE session_id = $1
                 AND target_checkpoint_generation = $2
                 AND status = 'active'
               LIMIT 1`;
  const params = [sessionId, targetGeneration];
  const row = client
    ? (await client.query<CheckpointHandoffRow>(sql, params)).rows[0] ?? null
    : await queryOne<CheckpointHandoffRow>(sql, params);
  return row ? mapRow(row) : null;
}

/**
 * Flip an active handoff to `consumed` inside the caller's transaction.
 * Returns the row count so the caller can detect a lost race (row already
 * consumed or superseded between `getActive` and `consume`).
 */
export async function consume(
  id: string,
  client: PoolClient,
): Promise<number> {
  const result = await client.query(
    `UPDATE checkpoint_handoffs
     SET status = 'consumed', consumed_at = NOW()
     WHERE id = $1 AND status = 'active'`,
    [id],
  );
  return result.rowCount ?? 0;
}

// ── Test-only helpers ───────────────────────────────────────────────

/**
 * Delete every handoff for `sessionId`. Test hatch — production code never
 * prunes handoffs (they carry audit value as a superseded trail).
 */
export async function __deleteAllForSessionTestOnly(sessionId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "DELETE FROM checkpoint_handoffs WHERE session_id = $1",
    [sessionId],
  );
}

/** Small helper used by tests to read a row by id without going through the active filter. */
export async function __getByIdTestOnly(id: string): Promise<CheckpointHandoff | null> {
  const row = await queryOneWith<CheckpointHandoffRow>(
    getPool(),
    "SELECT * FROM checkpoint_handoffs WHERE id = $1",
    [id],
  );
  return row ? mapRow(row) : null;
}
