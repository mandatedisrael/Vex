/**
 * Sessions repo — session lifecycle, compaction, scope.
 *
 * Compaction model:
 *   - `setRollingSummary` updates only the summary text.
 *   - `archivePrefix` moves a bounded prefix of messages into `messages_archive`
 *     (partial compact) and sets the new live `message_count`. `token_count`
 *     is NOT reset here — it's overwritten by the next turn's prompt size in
 *     `turn.ts::updateTokenCount`.
 *   - `forkToolMessageToArchive` is the giant-tool fallback: it COPIES a single
 *     live row into `messages_archive` (same id, full payload) and overwrites
 *     the live row's `content` with a short placeholder. Used when a bloated
 *     tool output in the tail is the sole source of context pressure.
 *
 * Transaction coordination (PR2):
 *   `setRollingSummary` and `archivePrefix` accept an optional `PoolClient`.
 *   When provided, they run inside the caller's transaction instead of
 *   opening their own. `executeCompactNow` (Track 1) uses this to atomically
 *   apply the whole write phase (summary + generation bump + compact_jobs
 *   enqueue + archive) under a single BEGIN/COMMIT — a crash rolls back the
 *   entire set together.
 */

import type { PoolClient } from "pg";
import {
  executeWith,
  getPool,
  query,
  queryOne,
  queryOneWith,
  type Executor,
} from "../client.js";

export {
  archivePrefix,
  archiveSuffix,
  forkToolMessageToArchive,
} from "./sessions-archive.js";

interface SessionRow {
  id: string;
  scope: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  compacted: boolean;
  message_count: number;
  token_count: number;
  checkpoint_generation: number;
  /**
   * Session-level mode discriminator. `mapRow` normalises unexpected values
   * to `"agent"`.
   */
  mode?: string | null;
  /** Session-scoped approval policy: `restricted` (default) or `full`. */
  permission?: string | null;
  /** Snapshot of user-supplied goal at session creation; null for `agent` rows. */
  initial_goal?: string | null;
}

/**
 * Known values for `sessions.mode`. `"agent"` is a one-shot conversational
 * session (post-M12 rename from "chat"). `"mission"` is goal-driven and
 * runs in a loop with agent-self-scheduled wake via `loop_defer`. Immutable
 * after session creation.
 */
export type SessionMode = "agent" | "mission";

/**
 * Session-scoped approval policy. `"restricted"` → every mutating tool
 * requires user approval. `"full"` → mutating tools auto-execute. Immutable
 * after session creation.
 */
export type SessionPermission = "restricted" | "full";

export interface Session {
  id: string;
  scope: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  compacted: boolean;
  messageCount: number;
  tokenCount: number;
  /**
   * Monotonic counter bumped once per successful checkpoint (see
   * `runCheckpointWriteTx`). Stamped on every session_memories row written
   * during that checkpoint so recall can surface recency as `gen:N`. Starts
   * at 0 for a freshly-created session; the first checkpoint lands rows at
   * generation 1.
   */
  checkpointGeneration: number;
  /**
   * Session-level mode. `"agent"` is one-shot conversational; `"mission"`
   * runs in a loop with agent self-scheduled wake. Immutable.
   */
  mode: SessionMode;
  /** Approval policy. Immutable. */
  permission: SessionPermission;
  /**
   * Snapshot of user intent at session creation. The negotiated/refined
   * mission contract goal lives on `missions.goal` and may differ from
   * this snapshot. `null` for `mode='agent'` sessions.
   */
  initialGoal: string | null;
}

function mapRow(r: SessionRow): Session {
  return {
    id: r.id,
    scope: r.scope,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    summary: r.summary,
    compacted: r.compacted,
    messageCount: r.message_count,
    tokenCount: r.token_count,
    checkpointGeneration: r.checkpoint_generation,
    mode: r.mode === "mission" ? "mission" : "agent",
    permission: r.permission === "full" ? "full" : "restricted",
    initialGoal: r.initial_goal ?? null,
  };
}

export interface CreateSessionOptions {
  /** Mode is immutable per session. Defaults to `"agent"`. */
  mode?: SessionMode;
  /** Permission is immutable per session. Defaults to `"restricted"`. */
  permission?: SessionPermission;
  /**
   * Optional snapshot of the first mission goal. Mission sessions can be
   * created without it; GUI chat sets it on the first user turn.
   * Ignored for `mode === "agent"`.
   */
  initialGoal?: string | null;
  /**
   * Optional Executor — when provided, the insert runs inside the caller's
   * transaction. Mission session creation uses this to atomically insert
   * the `sessions` row + `missions` draft row.
   */
  executor?: Executor;
}

/**
 * Create a session row. `ON CONFLICT DO NOTHING` keeps the first-writer-wins
 * semantics existing transports depend on. Mission rows may start without
 * `initialGoal`; setup/chat flows can fill it later.
 */
export async function createSession(
  id: string,
  options: CreateSessionOptions = {},
): Promise<void> {
  const mode: SessionMode = options.mode ?? "agent";
  const permission: SessionPermission = options.permission ?? "restricted";
  const initialGoal: string | null = mode === "mission" ? (options.initialGoal ?? null) : null;
  const executor: Executor = options.executor ?? getPool();
  await executeWith(
    executor,
    "INSERT INTO sessions (id, mode, permission, initial_goal) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
    [id, mode, permission, initialGoal],
  );
}

/**
 * Mark a session as ended. Idempotent — safe to call multiple times on a
 * session that has already been ended (only the first call writes a value).
 *
 * Used by the production MCP server (`src/mcp/sessions.ts`) on transport
 * disconnect, so the `sessions.ended_at` column reflects MCP connection
 * lifecycle. Vex Agent's chat / mission flows do not call this — their
 * sessions stay open until compaction.
 */
export async function endSession(id: string): Promise<void> {
  await executeWith(
    getPool(),
    "UPDATE sessions SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL",
    [id],
  );
}

export async function getSession(id: string): Promise<Session | null> {
  const row = await queryOne<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
  return row ? mapRow(row) : null;
}

export async function setScope(id: string, scope: string): Promise<void> {
  await executeWith(getPool(), "UPDATE sessions SET scope = $1 WHERE id = $2", [scope, id]);
}

/** SET token count — latest prompt size for checkpoint pressure evaluation. Not cumulative. */
export async function updateTokenCount(id: string, tokenCount: number): Promise<void> {
  await executeWith(
    getPool(),
    "UPDATE sessions SET token_count = $2 WHERE id = $1",
    [id, tokenCount],
  );
}

/**
 * Persist the rolling session summary. Does NOT touch `token_count` or
 * `message_count`; those are partial-archive concerns and live on
 * `archivePrefix`.
 *
 * When `client` is provided, this runs inside the caller's transaction.
 * `executeCompactNow` uses this to group summary + generation bump +
 * compact_jobs enqueue + archive under a single atomic write.
 */
export async function setRollingSummary(
  id: string,
  summary: string,
  client?: PoolClient,
): Promise<void> {
  const exec: Executor = client ?? getPool();
  await executeWith(exec, "UPDATE sessions SET summary = $2 WHERE id = $1", [id, summary]);
}

export async function listSessions(scope?: string, limit = 50): Promise<Session[]> {
  const rows = scope
    ? await query<SessionRow>(
        "SELECT * FROM sessions WHERE scope = $1 ORDER BY started_at DESC LIMIT $2",
        [scope, limit],
      )
    : await query<SessionRow>(
        "SELECT * FROM sessions ORDER BY started_at DESC LIMIT $1",
        [limit],
      );
  return rows.map(mapRow);
}
