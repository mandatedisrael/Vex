/**
 * Mission runs repo — per-run state persistence.
 *
 * NO parent_run_id — session_links is the canonical relationship graph.
 * Run status is the source of truth for per-run state (not runtime_state).
 */

import {
  type MissionRunStatus,
  ACTIVE_RUN_STATUSES,
  PAUSED_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  ACTIVE_OR_PAUSED_RUN_STATUSES,
} from "../../engine/types.js";
import type { PoolClient } from "pg";

import { queryOne, queryOneWith, execute, getPool } from "../client.js";
import { nullableJsonb } from "../params.js";
import logger from "@utils/logger.js";

// ── Types ───────────────────────────────────────────────────────

/**
 * Mission run state. Approval gating reads `sessions.permission` (hydrated
 * into `EngineContext`) so
 * the per-run snapshot is no longer needed.
 */
export interface MissionRun {
  id: string;
  missionId: string;
  sessionId: string;
  status: MissionRunStatus;
  startedAt: string;
  endedAt: string | null;
  lastCheckpointAt: string | null;
  stopReason: string | null;
  stopSummary: string | null;
  stopEvidenceJson: Record<string, unknown> | null;
  iterationCount: number;
  contractSnapshotJson: Record<string, unknown> | null;
  recoveredFromRunId: string | null;
}

/** SQL `IN (…)` literal compiled once from `ACTIVE_OR_PAUSED_RUN_STATUSES`. */
const ACTIVE_OR_PAUSED_SQL_IN = Array.from(ACTIVE_OR_PAUSED_RUN_STATUSES)
  .map((s) => `'${s}'`)
  .join(",");

const ALLOWED_RUN_STATUSES: ReadonlySet<MissionRunStatus> = new Set([
  ...ACTIVE_RUN_STATUSES,
  ...PAUSED_RUN_STATUSES,
  ...TERMINAL_RUN_STATUSES,
]);

function coerceStatus(raw: unknown, runId: string): MissionRunStatus {
  if (typeof raw === "string" && ALLOWED_RUN_STATUSES.has(raw as MissionRunStatus)) {
    return raw as MissionRunStatus;
  }
  logger.warn("engine.mission.status_drift", { runId, raw: String(raw) });
  throw new Error(`Unknown mission run status for ${runId}: ${String(raw)}`);
}

function mapRow(r: Record<string, unknown>): MissionRun {
  const id = r.id as string;
  return {
    id,
    missionId: r.mission_id as string,
    sessionId: r.session_id as string,
    status: coerceStatus(r.status, id),
    startedAt: (r.started_at instanceof Date ? r.started_at.toISOString() : r.started_at as string),
    endedAt: r.ended_at ? (r.ended_at instanceof Date ? r.ended_at.toISOString() : r.ended_at as string) : null,
    lastCheckpointAt: r.last_checkpoint_at ? (r.last_checkpoint_at instanceof Date ? r.last_checkpoint_at.toISOString() : r.last_checkpoint_at as string) : null,
    stopReason: r.stop_reason as string | null,
    stopSummary: r.stop_summary as string | null,
    stopEvidenceJson: r.stop_evidence_json as Record<string, unknown> | null,
    iterationCount: (r.iteration_count as number) ?? 0,
    contractSnapshotJson: r.contract_snapshot_json as Record<string, unknown> | null,
    recoveredFromRunId: r.recovered_from_run_id as string | null,
  };
}

// ── CRUD ────────────────────────────────────────────────────────

export async function createRun(
  id: string,
  missionId: string,
  sessionId: string,
  options: {
    contractSnapshotJson?: Record<string, unknown> | null;
    recoveredFromRunId?: string | null;
  } = {},
  client?: PoolClient,
): Promise<void> {
  const sql = `INSERT INTO mission_runs (
       id, mission_id, session_id, contract_snapshot_json, recovered_from_run_id
     ) VALUES ($1, $2, $3, $4::jsonb, $5)`;
  const params = [
    id,
    missionId,
    sessionId,
    nullableJsonb(options.contractSnapshotJson ?? null),
    options.recoveredFromRunId ?? null,
  ];
  if (client) {
    await client.query(sql, params);
  } else {
    await execute(sql, params);
  }
}

export async function updateStatus(
  id: string,
  status: MissionRunStatus,
  stopReason?: string,
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> },
  client?: PoolClient,
): Promise<void> {
  // Two SQL paths (not one with conditional string-injection) so the
  // placeholder count always matches the params array. A single template
  // with `isRunning ? "NULL" : "COALESCE($N, …)"` left $2..$4 orphan when
  // status === "running" and Postgres aborts type-inference for unused
  // placeholders ("could not determine data type of parameter $2").
  if (status === "running") {
    // Live state: clear stale stop evidence from paused_wake / paused_error.
    const runningSql = `UPDATE mission_runs SET status = 'running',
       stop_reason = NULL, stop_summary = NULL,
       stop_evidence_json = NULL, ended_at = NULL
       WHERE id = $1`;
    if (client) {
      await client.query(runningSql, [id]);
    } else {
      await execute(runningSql, [id]);
    }
    return;
  }

  // Paused statuses keep prior evidence (COALESCE merge); terminal statuses
  // additionally stamp ended_at to NOW().
  const ended = TERMINAL_RUN_STATUSES.has(status) ? "NOW()" : "ended_at";
  const pausedSql = `UPDATE mission_runs SET status = $1,
     stop_reason = COALESCE($2, stop_reason),
     stop_summary = COALESCE($3, stop_summary),
     stop_evidence_json = COALESCE($4::jsonb, stop_evidence_json),
     ended_at = ${ended}
     WHERE id = $5`;
  const pausedParams = [
    status,
    stopReason ?? null,
    stopPayload?.summary ?? null,
    nullableJsonb(stopPayload?.evidence ?? null),
    id,
  ];
  if (client) {
    await client.query(pausedSql, pausedParams);
  } else {
    await execute(pausedSql, pausedParams);
  }
}

export async function setLastCheckpoint(id: string): Promise<void> {
  await execute(
    "UPDATE mission_runs SET last_checkpoint_at = NOW() WHERE id = $1",
    [id],
  );
}

export async function incrementIterations(id: string): Promise<number> {
  const row = await queryOne<{ iteration_count: number }>(
    "UPDATE mission_runs SET iteration_count = iteration_count + 1 WHERE id = $1 RETURNING iteration_count",
    [id],
  );
  return row?.iteration_count ?? 0;
}

export async function getActiveRun(
  missionId: string,
  client?: PoolClient,
): Promise<MissionRun | null> {
  const sql = `SELECT * FROM mission_runs WHERE mission_id = $1 AND status IN (${ACTIVE_OR_PAUSED_SQL_IN}) ORDER BY started_at DESC LIMIT 1`;
  const row = client
    ? await queryOneWith<Record<string, unknown>>(client, sql, [missionId])
    : await queryOne<Record<string, unknown>>(sql, [missionId]);
  return row ? mapRow(row) : null;
}

/**
 * Fetch the active run for a session (keyed by `session_id`, filtered to
 * non-terminal statuses). Used by the PR-7 ingress router — user messages
 * arrive with a session id, not a mission id, and the router needs to
 * distinguish `running` / `paused_approval` / `paused_wake` from no active
 * work at all. `getRunBySession` is intentionally statusless and unsuitable
 * for routing decisions; `getActiveRun(missionId)` is keyed by mission id.
 */
export async function getActiveRunBySession(
  sessionId: string,
  client?: PoolClient,
): Promise<MissionRun | null> {
  const sql = `SELECT * FROM mission_runs WHERE session_id = $1 AND status IN (${ACTIVE_OR_PAUSED_SQL_IN}) ORDER BY started_at DESC LIMIT 1`;
  const row = client
    ? await queryOneWith<Record<string, unknown>>(client, sql, [sessionId])
    : await queryOne<Record<string, unknown>>(sql, [sessionId]);
  return row ? mapRow(row) : null;
}

/**
 * Atomic compare-and-set transition from any of `fromStatuses` to `running`.
 *
 * Used by `/retry` and the wake executor to claim a paused run without
 * racing each other: the SELECT … FOR UPDATE locks the row, the UPDATE only
 * fires when the locked status is in the allowed set, and the function
 * returns the previous status on success or `null` if another resumer
 * already moved the row out of the allowed set.
 */
export async function casFlipToRunning(
  runId: string,
  fromStatuses: readonly MissionRunStatus[],
): Promise<MissionRunStatus | null> {
  if (fromStatuses.length === 0) return null;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockRow = await client.query<{ status: string }>(
      "SELECT status FROM mission_runs WHERE id = $1 FOR UPDATE",
      [runId],
    );
    if (lockRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const prev = coerceStatus(lockRow.rows[0].status, runId);
    if (!fromStatuses.includes(prev)) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `UPDATE mission_runs
       SET status = 'running',
           stop_reason = NULL,
           stop_summary = NULL,
           stop_evidence_json = NULL,
           ended_at = NULL
       WHERE id = $1`,
      [runId],
    );
    await client.query("COMMIT");
    return prev;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    client.release();
  }
}

export async function getRun(
  id: string,
  client?: PoolClient,
): Promise<MissionRun | null> {
  const sql = "SELECT * FROM mission_runs WHERE id = $1";
  const row = client
    ? await queryOneWith<Record<string, unknown>>(client, sql, [id])
    : await queryOne<Record<string, unknown>>(sql, [id]);
  return row ? mapRow(row) : null;
}

export async function getRunBySession(sessionId: string): Promise<MissionRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM mission_runs WHERE session_id = $1 ORDER BY started_at DESC LIMIT 1",
    [sessionId],
  );
  return row ? mapRow(row) : null;
}

export async function getLatestFailedRunBySession(sessionId: string): Promise<MissionRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM mission_runs WHERE session_id = $1 AND status = 'failed' ORDER BY ended_at DESC NULLS LAST, started_at DESC LIMIT 1",
    [sessionId],
  );
  return row ? mapRow(row) : null;
}
