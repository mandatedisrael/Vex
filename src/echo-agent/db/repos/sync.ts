/**
 * Protocol sync repo — manages sync jobs and runs for the execution→projection pipeline.
 */

import { query, queryOne, execute } from "../client.js";

export interface SyncJob {
  id: number;
  namespace: string;
  syncType: string;
  readToolId: string | null;
  strategy: string;
  intervalSeconds: number | null;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface SyncRun {
  id: number;
  syncJobId: number;
  executionId: number | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  rowsAffected: number;
}

export async function getJobsForNamespace(namespace: string): Promise<SyncJob[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM protocol_sync_jobs WHERE namespace = $1 AND enabled = TRUE",
    [namespace],
  );
  return rows.map(mapJob);
}

export async function enqueueRun(syncJobId: number, executionId?: number): Promise<number> {
  const row = await queryOne<{ id: number }>(
    "INSERT INTO protocol_sync_runs (sync_job_id, execution_id, status) VALUES ($1, $2, 'pending') RETURNING id",
    [syncJobId, executionId ?? null],
  );
  return row?.id ?? 0;
}

/** Atomically claim one pending run for processing. */
export async function claimPendingRun(): Promise<SyncRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE protocol_sync_runs SET status = 'running', started_at = NOW()
     WHERE id = (
       SELECT id FROM protocol_sync_runs
       WHERE status = 'pending'
       ORDER BY started_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
  );
  return row ? mapRun(row) : null;
}

export async function completeRun(id: number, result: Record<string, unknown>, rowsAffected: number): Promise<void> {
  await execute(
    "UPDATE protocol_sync_runs SET status = 'completed', ended_at = NOW(), result = $2, rows_affected = $3 WHERE id = $1",
    [id, JSON.stringify(result), rowsAffected],
  );
}

export async function failRun(id: number, error: string): Promise<void> {
  await execute(
    "UPDATE protocol_sync_runs SET status = 'failed', ended_at = NOW(), error = $2 WHERE id = $1",
    [id, error],
  );
}

/** Get all enabled sync jobs. */
export async function getAllJobs(): Promise<SyncJob[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM protocol_sync_jobs WHERE enabled = TRUE ORDER BY namespace, sync_type",
  );
  return rows.map(mapJob);
}

/** Get a single sync job by ID. */
export async function getJob(id: number): Promise<SyncJob | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM protocol_sync_jobs WHERE id = $1",
    [id],
  );
  return row ? mapJob(row) : null;
}

/** Get the last completed run for a sync job (for periodic timing). */
export async function getLastCompletedRun(syncJobId: number): Promise<SyncRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM protocol_sync_runs WHERE sync_job_id = $1 AND status = 'completed' ORDER BY ended_at DESC LIMIT 1",
    [syncJobId],
  );
  return row ? mapRun(row) : null;
}

/** Claim ALL pending runs (for batch dedup in worker). */
export async function claimAllPending(): Promise<SyncRun[]> {
  const rows = await query<Record<string, unknown>>(
    `UPDATE protocol_sync_runs SET status = 'running', started_at = NOW()
     WHERE id IN (
       SELECT id FROM protocol_sync_runs
       WHERE status = 'pending'
       ORDER BY started_at ASC
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
  );
  return rows.map(mapRun);
}

function mapJob(r: Record<string, unknown>): SyncJob {
  return {
    id: r.id as number,
    namespace: r.namespace as string,
    syncType: r.sync_type as string,
    readToolId: r.read_tool_id as string | null,
    strategy: r.strategy as string,
    intervalSeconds: r.interval_seconds as number | null,
    enabled: r.enabled as boolean,
    config: (r.config as Record<string, unknown>) ?? {},
  };
}

function mapRun(r: Record<string, unknown>): SyncRun {
  return {
    id: r.id as number,
    syncJobId: r.sync_job_id as number,
    executionId: r.execution_id as number | null,
    status: r.status as string,
    startedAt: r.started_at as string,
    endedAt: r.ended_at as string | null,
    error: r.error as string | null,
    rowsAffected: r.rows_affected as number,
  };
}
