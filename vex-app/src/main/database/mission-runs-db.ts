/**
 * Mission runs DB helper for `runtime.getState`.
 *
 * Mirrors `sessions-db.ts` decoupling: own `pg.Client` per call. The
 * helper resolves the single active or paused run for a session (the
 * engine guarantees at most one at a time through its mission CAS,
 * but this code never trusts that invariant blindly — it sorts by
 * `started_at DESC` and takes the first row).
 *
 *   mission_runs(
 *     id, mission_id, session_id, status, started_at, ended_at,
 *     last_checkpoint_at, stop_reason, stop_summary, iteration_count,
 *     recovered_from_run_id (migration 015)
 *   )
 */

import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  missionRunStatusSchema,
  type MissionRunStatus,
} from "@shared/schemas/sessions.js";
import { type RuntimeStateDto } from "@shared/schemas/runtime.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

const ACTIVE_OR_PAUSED_STATUSES: readonly MissionRunStatus[] = [
  "running",
  "paused_approval",
  "paused_wake",
  "paused_error",
  "paused_user",
];

// `correlationId` intentionally omitted; `registerHandler` stamps
// `ctx.requestId` downstream. See `messages-db.ts` for full rationale.
function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "runtime",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function dbError(reason: string, cause?: unknown): Result<never, VexError> {
  log.warn(`[mission-runs-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "runtime",
    message: "Unable to load runtime state.",
    retryable: true,
    userActionable: false,
    redacted: true,
  });
}

async function withClient<T>(
  fn: (client: Client) => Promise<Result<T, VexError>>,
): Promise<Result<T, VexError>> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[mission-runs-db] buildPoolConfig threw", cause);
    return dbUnavailable();
  }
  if (cfg === null) return dbUnavailable();

  const clientConfig: ClientConfig = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  };
  const client = new Client(clientConfig);
  try {
    await client.connect();
  } catch (cause) {
    log.warn("[mission-runs-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[mission-runs-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface MissionRunRow {
  readonly id: string;
  readonly session_id: string;
  readonly status: string;
  readonly started_at: string | Date;
  readonly last_checkpoint_at: string | Date | null;
  readonly stop_reason: string | null;
  readonly iteration_count: number | string | null;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIso(value);
}

function normaliseStatus(raw: string): MissionRunStatus | null {
  const parsed = missionRunStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const PENDING_CONTROL_KINDS = new Set([
  "pause_after_step",
  "stop_terminal",
  "resume",
  "cancel_wake",
]);

function normalisePendingControlKind(
  raw: string | null,
): "pause_after_step" | "stop_terminal" | "resume" | "cancel_wake" | null {
  if (raw === null) return null;
  return PENDING_CONTROL_KINDS.has(raw)
    ? (raw as "pause_after_step" | "stop_terminal" | "resume" | "cancel_wake")
    : null;
}

function toIntOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

/**
 * Latest mission_run for a session regardless of status (incl. terminal).
 * Unlike `getActiveRunForSession` (active/paused only), this lets the
 * `mission.retry` dispatcher distinguish a terminal run (→ blocked_terminal)
 * from a session that never had a run (→ no_active_run). `null` = no run ever.
 */
export async function getLatestRunForSession(
  sessionId: string,
): Promise<
  Result<{ missionRunId: string; status: MissionRunStatus } | null, VexError>
> {
  return withClient(async (client) => {
    try {
      const result = await client.query<{ id: string; status: string }>(
        `SELECT id, status
           FROM mission_runs
          WHERE session_id = $1
          ORDER BY started_at DESC
          LIMIT 1`,
        [sessionId],
      );
      const row = result.rows[0];
      if (!row) return ok(null);
      const parsed = missionRunStatusSchema.safeParse(row.status);
      if (!parsed.success) {
        return dbError(
          `getLatestRunForSession: unrecognized run status "${row.status}"`,
        );
      }
      return ok({ missionRunId: row.id, status: parsed.data });
    } catch (cause) {
      return dbError("getLatestRunForSession query failed", cause);
    }
  });
}

export async function getActiveRunForSession(
  sessionId: string,
): Promise<Result<RuntimeStateDto, VexError>> {
  return withClient(async (client) => {
    try {
      // Puzzle 03: one round-trip pulls the active run + the runner
      // lease summary + the top pending control kind so the renderer
      // doesn't need three IPC calls to gate pause/stop/resume
      // buttons. `LEFT JOIN` keeps the row when no lease / no pending
      // request exists for the session.
      const result = await client.query<
        MissionRunRow & {
          lease_active: boolean | null;
          lease_expires_at: Date | null;
          pending_control_kind: string | null;
        }
      >(
        `SELECT m.id, m.session_id, m.status, m.started_at, m.last_checkpoint_at,
                m.stop_reason, m.iteration_count,
                CASE WHEN l.session_id IS NOT NULL AND l.expires_at >= NOW()
                     THEN TRUE ELSE FALSE END               AS lease_active,
                CASE WHEN l.session_id IS NOT NULL AND l.expires_at >= NOW()
                     THEN l.expires_at ELSE NULL END        AS lease_expires_at,
                r.kind                                       AS pending_control_kind
           FROM mission_runs m
           LEFT JOIN runner_leases l ON l.session_id = m.session_id
           LEFT JOIN LATERAL (
             SELECT kind FROM runtime_control_requests
              WHERE session_id = m.session_id
                AND status IN ('pending', 'observed')
              ORDER BY created_at ASC
              LIMIT 1
           ) r ON TRUE
          WHERE m.session_id = $1
            AND m.status = ANY($2::text[])
          ORDER BY m.started_at DESC
          LIMIT 1`,
        [sessionId, ACTIVE_OR_PAUSED_STATUSES],
      );
      const row = result.rows[0];
      if (!row) {
        // No active run for this session — also surface session-only
        // lease + pending control state (chat-only flow can hold a
        // lease + a stop_terminal request even without a mission run).
        const fallback = await client.query<{
          lease_active: boolean | null;
          lease_expires_at: Date | null;
          pending_control_kind: string | null;
        }>(
          `SELECT
              CASE WHEN l.session_id IS NOT NULL AND l.expires_at >= NOW()
                   THEN TRUE ELSE FALSE END           AS lease_active,
              CASE WHEN l.session_id IS NOT NULL AND l.expires_at >= NOW()
                   THEN l.expires_at ELSE NULL END    AS lease_expires_at,
              (SELECT kind FROM runtime_control_requests
                 WHERE session_id = $1
                   AND status IN ('pending', 'observed')
                 ORDER BY created_at ASC
                 LIMIT 1)                              AS pending_control_kind
            FROM (SELECT $1::text AS session_id) s
            LEFT JOIN runner_leases l ON l.session_id = s.session_id`,
          [sessionId],
        );
        const f = fallback.rows[0];
        return ok({
          sessionId,
          hasActiveRun: false,
          missionRunId: null,
          status: null,
          stopReason: null,
          lastCheckpointAt: null,
          startedAt: null,
          iterationCount: null,
          leaseActive: Boolean(f?.lease_active),
          leaseExpiresAt: f?.lease_expires_at ? toIso(f.lease_expires_at) : null,
          pendingControlKind: normalisePendingControlKind(
            f?.pending_control_kind ?? null,
          ),
        });
      }
      const status = normaliseStatus(row.status);
      return ok({
        sessionId,
        hasActiveRun: status !== null,
        missionRunId: row.id,
        status,
        stopReason: row.stop_reason,
        lastCheckpointAt: toIsoOrNull(row.last_checkpoint_at),
        startedAt: toIso(row.started_at),
        iterationCount: toIntOrNull(row.iteration_count),
        leaseActive: Boolean(row.lease_active),
        leaseExpiresAt: row.lease_expires_at
          ? toIso(row.lease_expires_at)
          : null,
        pendingControlKind: normalisePendingControlKind(
          row.pending_control_kind,
        ),
      });
    } catch (cause) {
      return dbError("getActiveRunForSession query failed", cause);
    }
  });
}
