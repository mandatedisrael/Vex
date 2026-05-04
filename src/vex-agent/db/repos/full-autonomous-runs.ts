/**
 * Full-autonomous runs repo — durable runtime state for standalone autonomy.
 *
 * Mission runs already have row-level status/CAS protection. Full-autonomous
 * sessions need the same primitive so wake, user interrupt, and manual resume
 * cannot start parallel loops for the same session.
 */

import {
  ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES,
  TERMINAL_FULL_AUTONOMOUS_STATUSES,
  type FullAutonomousRunStatus,
} from "../../engine/types.js";
import { execute, getPool, queryOne } from "../client.js";
import { nullableJsonb } from "../params.js";

export interface FullAutonomousRun {
  id: string;
  sessionId: string;
  status: FullAutonomousRunStatus;
  loopMode: "full";
  startedAt: string;
  endedAt: string | null;
  lastCheckpointAt: string | null;
  stopReason: string | null;
  stopSummary: string | null;
  stopEvidenceJson: Record<string, unknown> | null;
  iterationCount: number;
}

const ACTIVE_OR_PAUSED_SQL_IN = Array.from(ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES)
  .map((s) => `'${s}'`)
  .join(",");

const ALLOWED_STATUSES: ReadonlySet<FullAutonomousRunStatus> = new Set([
  ...ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES,
  ...TERMINAL_FULL_AUTONOMOUS_STATUSES,
]);

function coerceStatus(raw: unknown, runId: string): FullAutonomousRunStatus {
  if (typeof raw === "string" && ALLOWED_STATUSES.has(raw as FullAutonomousRunStatus)) {
    return raw as FullAutonomousRunStatus;
  }
  throw new Error(`Unknown full-autonomous run status for ${runId}: ${String(raw)}`);
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toNullableIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: Record<string, unknown>): FullAutonomousRun {
  const id = row.id as string;
  return {
    id,
    sessionId: row.session_id as string,
    status: coerceStatus(row.status, id),
    loopMode: "full",
    startedAt: toIso(row.started_at),
    endedAt: toNullableIso(row.ended_at),
    lastCheckpointAt: toNullableIso(row.last_checkpoint_at),
    stopReason: row.stop_reason as string | null,
    stopSummary: row.stop_summary as string | null,
    stopEvidenceJson: row.stop_evidence_json as Record<string, unknown> | null,
    iterationCount: (row.iteration_count as number) ?? 0,
  };
}

export async function createRun(id: string, sessionId: string): Promise<void> {
  await execute(
    "INSERT INTO full_autonomous_runs (id, session_id, loop_mode) VALUES ($1, $2, 'full')",
    [id, sessionId],
  );
}

export async function getRun(id: string): Promise<FullAutonomousRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM full_autonomous_runs WHERE id = $1",
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function getActiveRunBySession(sessionId: string): Promise<FullAutonomousRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM full_autonomous_runs
      WHERE session_id = $1 AND status IN (${ACTIVE_OR_PAUSED_SQL_IN})
      ORDER BY started_at DESC LIMIT 1`,
    [sessionId],
  );
  return row ? mapRow(row) : null;
}

export async function updateStatus(
  id: string,
  status: FullAutonomousRunStatus,
  stopReason?: string,
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> },
): Promise<void> {
  const isRunning = status === "running";
  const ended = isRunning ? "NULL" : TERMINAL_FULL_AUTONOMOUS_STATUSES.has(status) ? "NOW()" : "ended_at";
  const stopReasonSql = isRunning ? "NULL" : "COALESCE($2, stop_reason)";
  const stopSummarySql = isRunning ? "NULL" : "COALESCE($3, stop_summary)";
  const stopEvidenceSql = isRunning ? "NULL" : "COALESCE($4::jsonb, stop_evidence_json)";
  await execute(
    `UPDATE full_autonomous_runs SET status = $1,
      stop_reason = ${stopReasonSql},
      stop_summary = ${stopSummarySql},
      stop_evidence_json = ${stopEvidenceSql},
      ended_at = ${ended}
      WHERE id = $5`,
    [
      status,
      stopReason ?? null,
      stopPayload?.summary ?? null,
      nullableJsonb(stopPayload?.evidence ?? null),
      id,
    ],
  );
}

export async function incrementIterations(id: string): Promise<number> {
  const row = await queryOne<{ iteration_count: number }>(
    "UPDATE full_autonomous_runs SET iteration_count = iteration_count + 1 WHERE id = $1 RETURNING iteration_count",
    [id],
  );
  return row?.iteration_count ?? 0;
}

export async function setLastCheckpoint(id: string): Promise<void> {
  await execute(
    "UPDATE full_autonomous_runs SET last_checkpoint_at = NOW() WHERE id = $1",
    [id],
  );
}

export async function casFlipToRunning(
  runId: string,
  fromStatuses: readonly FullAutonomousRunStatus[],
): Promise<FullAutonomousRunStatus | null> {
  if (fromStatuses.length === 0) return null;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ status: string }>(
      "SELECT status FROM full_autonomous_runs WHERE id = $1 FOR UPDATE",
      [runId],
    );
    if (locked.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const prev = coerceStatus(locked.rows[0].status, runId);
    if (!fromStatuses.includes(prev)) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `UPDATE full_autonomous_runs
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
      // Keep the original failure.
    });
    throw err;
  } finally {
    client.release();
  }
}
