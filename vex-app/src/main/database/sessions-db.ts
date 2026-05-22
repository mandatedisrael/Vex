/**
 * Sessions DB helper for the multi-session app shell.
 *
 * vex-app's main process talks to the same Postgres instance the engine
 * (`src/vex-agent`) writes to, but it does NOT import the engine repos —
 * vex-app deliberately uses its own pg connections so the GUI build stays
 * decoupled from the engine module graph (mirrors the pattern in
 * `dim-lock.ts`).
 *
 * SQL is the contract here. The base Vex Agent migrations create:
 *   sessions(id PK, scope, started_at, ended_at, ..., mode CHECK ('agent'|'mission'),
 *            permission CHECK ('restricted'|'full'), initial_goal)
 *   missions(id PK, root_session_id FK, status, title, goal, ...)
 *   mission_runs(id PK, mission_id FK, session_id FK, status, ...)
 *
 * Mission creation pipeline:
 *   1. INSERT sessions (mode='mission', permission, initial_goal=NULL)
 *   2. INSERT missions (id, root_session_id=session.id, status='draft')
 *   3. Do NOT create mission_runs here — that happens later via startMission()
 *      after the conversational setup flow refines the contract.
 * Steps 1+2 run inside a single BEGIN/COMMIT — a crash after step 1 must NOT
 * leave a mission session without its missions row.
 *
 * The first chat submit for a mission stores the initial goal snapshot and
 * lets the engine's mission-setup conversational flow refine the draft.
 */

import { Client, type ClientConfig } from "pg";
import { randomUUID } from "node:crypto";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  VEX_APP_SESSION_SCOPE,
  missionRunStatusSchema,
  type MissionRunStatus,
  type SessionCreateInput,
  type SessionDeleteResult,
  type SessionListItem,
  type SessionMode,
  type SessionPermission,
} from "@shared/schemas/sessions.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;
// Mirror of engine `ACTIVE_OR_PAUSED_RUN_STATUSES` (engine/types.ts).
// Drift between these two breaks sidebar bucketing, delete guards, and
// active-run lookups — puzzle 03 introduced `paused_user` engine-side
// but the app whitelist missed it; puzzle 04 closes that gap.
const ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES: readonly MissionRunStatus[] = [
  "running",
  "paused_approval",
  "paused_wake",
  "paused_user",
  "paused_error",
];

function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "internal",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function dbError(reason: string, cause?: unknown): Result<never, VexError> {
  log.warn(`[sessions-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "internal",
    message: "Unable to complete the session operation.",
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
    log.warn("[sessions-db] buildPoolConfig threw", cause);
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
    log.warn("[sessions-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[sessions-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface SessionRow {
  readonly id: string;
  readonly mode: string;
  readonly permission: string;
  readonly initial_goal: string | null;
  readonly started_at: string | Date;
  readonly ended_at: string | Date | null;
  readonly title: string | null;
  readonly pinned_at: string | Date | null;
}

interface MissionRunStatusRow {
  readonly session_id: string;
  readonly status: string;
}

const SESSION_ROW_COLUMNS =
  "id, mode, permission, initial_goal, started_at, ended_at, title, pinned_at";

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoStringOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIsoString(value);
}

function normaliseMode(raw: string): SessionMode {
  return raw === "mission" ? "mission" : "agent";
}

function normalisePermission(raw: string): SessionPermission {
  return raw === "full" ? "full" : "restricted";
}

function normaliseMissionStatus(raw: string | null | undefined): MissionRunStatus | null {
  if (raw === null || raw === undefined) return null;
  const parsed = missionRunStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function toListItem(
  row: SessionRow,
  missionStatus: MissionRunStatus | null,
): SessionListItem {
  return {
    id: row.id,
    mode: normaliseMode(row.mode),
    permission: normalisePermission(row.permission),
    title: row.title,
    initialGoal: row.initial_goal,
    startedAt: toIsoString(row.started_at),
    endedAt: toIsoStringOrNull(row.ended_at),
    missionStatus,
    pinnedAt: toIsoStringOrNull(row.pinned_at),
  };
}

/**
 * Load the active mission_run status for a single session id. Shared by
 * `getSessionById` and `setSessionPinned` so a freshly-pinned mission row
 * never gets returned with a wiped `missionStatus`. `listSessions` keeps
 * its batch DISTINCT ON query — single-row lookups here would be N+1.
 */
async function loadMissionStatus(
  client: Client,
  sessionId: string,
): Promise<MissionRunStatus | null> {
  const result = await client.query<{ status: string }>(
    `SELECT status FROM mission_runs
       WHERE session_id = $1
         AND status = ANY($2::text[])
       ORDER BY started_at DESC LIMIT 1`,
    [sessionId, ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES],
  );
  return normaliseMissionStatus(result.rows[0]?.status);
}

/**
 * Create a session. For `mode === "mission"` this also inserts the
 * companion `missions` draft row in the same transaction. Returns the
 * newly persisted list-item shape so the renderer can update its query
 * cache without a follow-up `vex.sessions.list` roundtrip.
 *
 * Side effects:
 *   - INSERT into sessions (always)
 *   - INSERT into missions (mission mode only — status='draft', goal=NULL)
 *
 * NO LLM calls. The first turn of the mission setup flow runs later, when
 * the renderer opens the session and the engine's `processMissionSetupTurn`
 * picks up.
 */
export async function createSession(
  input: SessionCreateInput,
): Promise<Result<SessionListItem, VexError>> {
  const id = randomUUID();
  const mode: SessionMode = input.mode;
  const permission: SessionPermission = input.permission;
  const title: string = input.name;
  const initialGoal: string | null = null;

  return withClient(async (client) => {
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO sessions (id, scope, mode, permission, initial_goal, title) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, VEX_APP_SESSION_SCOPE, mode, permission, initialGoal, title],
      );
      if (mode === "mission") {
        const missionId = randomUUID();
        await client.query(
          "INSERT INTO missions (id, root_session_id, status) VALUES ($1, $2, 'draft')",
          [missionId, id],
        );
      }
      const sessionResult = await client.query<SessionRow>(
        `SELECT ${SESSION_ROW_COLUMNS} FROM sessions WHERE id = $1 AND scope = $2`,
        [id, VEX_APP_SESSION_SCOPE],
      );
      await client.query("COMMIT");
      const row = sessionResult.rows[0];
      if (!row) {
        return dbError(`createSession lost row id=${id} after INSERT`);
      }
      // Freshly created mission sessions have no mission_run yet — that
      // record only appears once startMission() is called downstream.
      return ok(toListItem(row, null));
    } catch (cause) {
      try {
        await client.query("ROLLBACK");
      } catch (rbCause) {
        log.warn("[sessions-db] ROLLBACK after createSession failure failed", rbCause);
      }
      return dbError("createSession transaction failed", cause);
    }
  });
}

/**
 * Persist the first mission chat message as the session-level initial goal
 * snapshot and seed the current draft's `goal` if it is still empty.
 *
 * This is deliberately separate from `createSession`: the modal captures only
 * immutable axes, while chat owns the mission intent text. The guarded UPDATE
 * makes repeat submits/races idempotent — only the first non-empty goal wins.
 */
export async function setInitialMissionGoalIfUnset(
  id: string,
  goal: string,
): Promise<Result<boolean, VexError>> {
  return withClient(async (client) => {
    try {
      await client.query("BEGIN");
      const sessionUpdate = await client.query<{ id: string }>(
        `UPDATE sessions
            SET initial_goal = $3
          WHERE id = $1
            AND scope = $2
            AND mode = 'mission'
            AND deleted_at IS NULL
            AND (initial_goal IS NULL OR btrim(initial_goal) = '')
          RETURNING id`,
        [id, VEX_APP_SESSION_SCOPE, goal],
      );

      const changed = (sessionUpdate.rowCount ?? 0) > 0;
      if (changed) {
        await client.query(
          `UPDATE missions
              SET goal = $2, updated_at = NOW()
            WHERE id = (
              SELECT id
                FROM missions
               WHERE root_session_id = $1
                 AND status NOT IN ('completed', 'failed', 'cancelled')
               ORDER BY created_at DESC
               LIMIT 1
            )
              AND (goal IS NULL OR btrim(goal) = '')`,
          [id, goal],
        );
      }

      await client.query("COMMIT");
      return ok(changed);
    } catch (cause) {
      try {
        await client.query("ROLLBACK");
      } catch (rbCause) {
        log.warn("[sessions-db] ROLLBACK after setInitialMissionGoalIfUnset failure failed", rbCause);
      }
      return dbError("setInitialMissionGoalIfUnset failed", cause);
    }
  });
}

/**
 * Fetch a single session by id, enriched with active mission_run status
 * (mission mode only).
 */
export async function getSessionById(
  id: string,
): Promise<Result<SessionListItem | null, VexError>> {
  return withClient(async (client) => {
    try {
      const sessionResult = await client.query<SessionRow>(
        `SELECT ${SESSION_ROW_COLUMNS} FROM sessions WHERE id = $1 AND scope = $2 AND deleted_at IS NULL`,
        [id, VEX_APP_SESSION_SCOPE],
      );
      const row = sessionResult.rows[0];
      if (!row) return ok(null);
      const missionStatus: MissionRunStatus | null =
        normaliseMode(row.mode) === "mission"
          ? await loadMissionStatus(client, id)
          : null;
      return ok(toListItem(row, missionStatus));
    } catch (cause) {
      return dbError("getSessionById failed", cause);
    }
  });
}

/**
 * List sessions (most-recent first), enriched with active mission_run
 * status for mission-mode rows. Bounded at 100 — the sidebar paginates
 * later if we exceed that.
 */
export async function listSessions(
  limit = 100,
): Promise<Result<readonly SessionListItem[], VexError>> {
  return withClient(async (client) => {
    try {
      const sessionsResult = await client.query<SessionRow>(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE scope = $1 AND deleted_at IS NULL
         ORDER BY pinned_at DESC NULLS LAST, started_at DESC
         LIMIT $2`,
        [VEX_APP_SESSION_SCOPE, limit],
      );
      const rows = sessionsResult.rows;
      if (rows.length === 0) return ok([]);

      const missionSessionIds = rows
        .filter((r) => normaliseMode(r.mode) === "mission")
        .map((r) => r.id);

      const statusBySession = new Map<string, MissionRunStatus>();
      if (missionSessionIds.length > 0) {
        // Single query, latest active run per session. DISTINCT ON keeps
        // the most recent active/paused row per session_id.
        const runsResult = await client.query<MissionRunStatusRow>(
          `SELECT DISTINCT ON (session_id) session_id, status
           FROM mission_runs
           WHERE session_id = ANY($1::text[])
             AND status = ANY($2::text[])
           ORDER BY session_id, started_at DESC`,
          [missionSessionIds, ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES],
        );
        for (const r of runsResult.rows) {
          const status = normaliseMissionStatus(r.status);
          if (status !== null) statusBySession.set(r.session_id, status);
        }
      }

      return ok(
        rows.map((r) =>
          toListItem(r, statusBySession.get(r.id) ?? null),
        ),
      );
    } catch (cause) {
      return dbError("listSessions failed", cause);
    }
  });
}

/**
 * Race-safe soft delete for the GUI sidebar. The "remove" semantics:
 *
 *   - Atomic guarded UPDATE flips `deleted_at` only when no active mission
 *     run and no pending approval reference the session. PG evaluates both
 *     NOT EXISTS clauses inside the same statement, so the success path
 *     cannot lose a race to a freshly-started mission run.
 *   - When the UPDATE returns 0 rows, classification queries figure out
 *     why and surface a discriminated `SessionDeleteOutcome` so the
 *     renderer can show actionable copy.
 *
 * Hard delete is intentionally NOT implemented — `mission_runs`, `missions`,
 * `approval_queue`, `usage_log`, and `loop_wake_requests` all reference
 * `sessions(id)` without `ON DELETE CASCADE`, so a hard DELETE would
 * either error on FK constraints or require coordinated cleanup that
 * races with in-flight engine cycles.
 *
 * The function is split into `*WithClient` + thin wrapper so the
 * outcome-classification branching can be unit-tested with a fake
 * `pg.Client` (see `__tests__/sessions-db.test.ts`).
 */
export async function softDeleteSessionWithClient(
  client: Client,
  id: string,
): Promise<Result<SessionDeleteResult, VexError>> {
  try {
    // 1. Atomic guarded UPDATE — single statement; PG evaluates the
    //    NOT EXISTS clauses against the same snapshot as the UPDATE.
    const updateResult = await client.query<{ id: string }>(
      `UPDATE sessions
          SET deleted_at = NOW()
        WHERE id = $1
          AND scope = $2
          AND deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM mission_runs
             WHERE session_id = $1
               AND status = ANY($3::text[])
          )
          AND NOT EXISTS (
            SELECT 1 FROM approval_queue
             WHERE session_id = $1 AND status = 'pending'
          )
        RETURNING id`,
      [id, VEX_APP_SESSION_SCOPE, ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES],
    );
    if ((updateResult.rowCount ?? 0) > 0) return ok({ outcome: "removed" });

    // 2. Classification — explicit per branch, no default tail.
    const rowResult = await client.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM sessions WHERE id = $1 AND scope = $2",
      [id, VEX_APP_SESSION_SCOPE],
    );
    if (rowResult.rows.length === 0) return ok({ outcome: "not_found" });
    if (rowResult.rows[0].deleted_at !== null) {
      return ok({ outcome: "already_removed" });
    }

    const activeMission = await client.query(
      `SELECT 1 FROM mission_runs
         WHERE session_id = $1
           AND status = ANY($2::text[])
         LIMIT 1`,
      [id, ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES],
    );
    if (activeMission.rows.length > 0) {
      return ok({ outcome: "blocked_active_mission" });
    }

    const pendingApproval = await client.query(
      "SELECT 1 FROM approval_queue WHERE session_id = $1 AND status = 'pending' LIMIT 1",
      [id],
    );
    if (pendingApproval.rows.length > 0) {
      return ok({ outcome: "blocked_pending_approval" });
    }

    // Atomic UPDATE saw a blocker that disappeared by classification time
    // (engine completed a mission_run / approval got resolved). Neutral
    // retry: re-clicking Remove will succeed on the next atomic UPDATE.
    return ok({ outcome: "state_changed" });
  } catch (cause) {
    return dbError("softDeleteSession failed", cause);
  }
}

export async function softDeleteSession(
  id: string,
): Promise<Result<SessionDeleteResult, VexError>> {
  return withClient((client) => softDeleteSessionWithClient(client, id));
}

/**
 * Pin or unpin a session. Idempotent semantics on both sides:
 *   - re-pinning a pinned row keeps the existing `pinned_at` (via
 *     `COALESCE`) so the sidebar's "most recently pinned first" order
 *     does NOT shuffle on accidental double-clicks.
 *   - re-unpinning an already-unpinned row is a no-op.
 *
 * Returns the updated `SessionListItem` (enriched with `missionStatus`)
 * or `null` when the id is unknown — caller had a stale view, treating
 * it as an error would be hostile.
 */
export async function setSessionPinnedWithClient(
  client: Client,
  id: string,
  pinned: boolean,
): Promise<Result<SessionListItem | null, VexError>> {
  try {
    // `AND deleted_at IS NULL` keeps soft-deleted sessions unreachable from
    // the pin path — a stale star click or hostile renderer call can no
    // longer resurrect a row that delete already classified as terminal
    // hidden. Unknown id and soft-deleted id both collapse to `ok(null)`.
    const updateResult = await client.query<SessionRow>(
      `UPDATE sessions
          SET pinned_at = CASE
                WHEN $2::boolean THEN COALESCE(pinned_at, NOW())
                ELSE NULL
              END
        WHERE id = $1 AND scope = $3 AND deleted_at IS NULL
        RETURNING ${SESSION_ROW_COLUMNS}`,
      [id, pinned, VEX_APP_SESSION_SCOPE],
    );
    const row = updateResult.rows[0];
    if (!row) return ok(null);
    const missionStatus: MissionRunStatus | null =
      normaliseMode(row.mode) === "mission"
        ? await loadMissionStatus(client, id)
        : null;
    return ok(toListItem(row, missionStatus));
  } catch (cause) {
    return dbError("setSessionPinned failed", cause);
  }
}

export async function setSessionPinned(
  id: string,
  pinned: boolean,
): Promise<Result<SessionListItem | null, VexError>> {
  return withClient((client) => setSessionPinnedWithClient(client, id, pinned));
}
