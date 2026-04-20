/**
 * Sessions repo — session lifecycle, compaction, scope, memory language.
 *
 * Compaction model (post-session-episodes rollout):
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
 * Transaction coordination (PR2, post-migration 008):
 *   `setRollingSummary`, `setMemoryLanguageCode`, and `archivePrefix` accept
 *   an optional `PoolClient`. When provided, they run inside the caller's
 *   transaction instead of opening their own. `executeCheckpoint` uses this
 *   to atomically apply the whole write phase (language_code + summary +
 *   episodes + archive) under a single BEGIN/COMMIT — a crash rolls back the
 *   entire set together.
 *
 * Memory language contract (PR2, migration 008):
 *   `sessions.memory_language_code` holds a per-session language marker set
 *   once by the first checkpoint. Values are 2-3 lowercase letters, optional
 *   "-REGION" suffix (e.g. "en", "pl", "fr", "zh", "vi", "pt-BR"), or the
 *   literal "und" for mixed/unclear. Validation is at the code boundary
 *   (`setMemoryLanguageCode`) — no DB CHECK so adding a language later does
 *   not require a migration.
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

interface SessionRow {
  id: string;
  scope: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  compacted: boolean;
  message_count: number;
  token_count: number;
  memory_scope_key: string | null;
  memory_language_code: string | null;
  checkpoint_generation: number;
  /**
   * PR-10 (wake roadmap) adds `sessions.kind TEXT DEFAULT 'chat'`. The type
   * field is declared now so PR-7 (wake executor + ingress router) can read
   * `session.kind` without an `as unknown as` cast. Until PR-10's migration
   * lands, the column does not exist — `mapRow` tolerates the missing key
   * and falls back to `"chat"`.
   */
  kind?: string | null;
}

/**
 * Known values for `sessions.kind`. `"chat"` is the default; `"full_autonomous"`
 * becomes a real runtime surface in PR-10 (the standalone full-autonomous
 * runner) but the type is declared now so PR-7's wake executor + ingress
 * router stay cast-free.
 */
export type SessionKind = "chat" | "full_autonomous";

export interface Session {
  id: string;
  scope: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  compacted: boolean;
  messageCount: number;
  tokenCount: number;
  memoryScopeKey: string | null;
  memoryLanguageCode: string | null;
  /**
   * Monotonic counter bumped once per successful checkpoint (see
   * `runCheckpointWriteTx`). Stamped on every episode written in that
   * checkpoint's batch so recall can surface recency as `gen:N`. Starts at 0
   * for a freshly-created session; the first checkpoint lands episodes at
   * generation 1.
   */
  checkpointGeneration: number;
  /**
   * Session-level runtime discriminator. `"chat"` by default; `"full_autonomous"`
   * activates the standalone full-autonomous routing path (PR-10). The column
   * itself is added by PR-10's migration — today every row resolves to `"chat"`
   * because `mapRow` defaults unknown values there.
   */
  kind: SessionKind;
}

/**
 * Acceptable shape for `sessions.memory_language_code`:
 *   - 2-3 lowercase letters, optional "-REGION" suffix (e.g. "en", "pl",
 *     "fr", "zh", "vi", "pt-BR"),
 *   - or the literal "und" for mixed/unclear.
 *
 * Validation lives at the code boundary (this file's
 * {@link setMemoryLanguageCode}); `knowledge_entries` and `session_episodes`
 * do not own this schema. Adding a language later does not require a DB
 * migration — just new prompt cases in `extract.ts` / `merge.ts`.
 */
export const LANG_CODE_RE = /^([a-z]{2,3}(-[A-Z]{2})?|und)$/;

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
    memoryScopeKey: r.memory_scope_key,
    memoryLanguageCode: r.memory_language_code,
    checkpointGeneration: r.checkpoint_generation,
    kind: r.kind === "full_autonomous" ? "full_autonomous" : "chat",
  };
}

export async function createSession(id: string): Promise<void> {
  await executeWith(
    getPool(),
    "INSERT INTO sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
    [id],
  );
}

/**
 * Mark a session as ended. Idempotent — safe to call multiple times on a
 * session that has already been ended (only the first call writes a value).
 *
 * Used by the production MCP server (`src/mcp/sessions.ts`) on transport
 * disconnect, so the `sessions.ended_at` column reflects MCP connection
 * lifecycle. Echo Agent's chat / mission flows do not call this — their
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

/**
 * Set the semantic memory scope key used by `session_episodes` recall.
 *
 * Separate from `scope` (which is coarse: `chat` / `mcp` / `subagent`). The
 * scope key is the identity that episodic recall groups on — typically the
 * session id itself (isolated default for subagents post-PR3), but subagents
 * spawned with `scope_strategy: "shared"` inherit the parent's scope so
 * their checkpoints contribute to the parent's memory.
 */
export async function setMemoryScopeKey(id: string, memoryScopeKey: string): Promise<void> {
  await executeWith(
    getPool(),
    "UPDATE sessions SET memory_scope_key = $2 WHERE id = $1",
    [id, memoryScopeKey],
  );
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
 * `executeCheckpoint` uses this to group summary + episodes + archive under
 * a single atomic write.
 */
export async function setRollingSummary(
  id: string,
  summary: string,
  client?: PoolClient,
): Promise<void> {
  const exec: Executor = client ?? getPool();
  await executeWith(exec, "UPDATE sessions SET summary = $2 WHERE id = $1", [id, summary]);
}

/**
 * Read the per-session memory language marker.
 *
 * Returns null when the session has not yet been checkpointed — the first
 * checkpoint infers and persists a value via {@link setMemoryLanguageCode}.
 */
export async function getMemoryLanguageCode(id: string): Promise<string | null> {
  const row = await queryOneWith<{ memory_language_code: string | null }>(
    getPool(),
    "SELECT memory_language_code FROM sessions WHERE id = $1",
    [id],
  );
  return row?.memory_language_code ?? null;
}

/**
 * Persist the per-session memory language marker.
 *
 * Validates `code` against {@link LANG_CODE_RE} and throws on invalid input
 * — callers should never pass raw untrusted values here. The intent is that
 * the LLM's `session_language_inferred` field is the only source of truth,
 * and it is validated at this boundary.
 *
 * The UPDATE is guarded by `WHERE memory_language_code IS NULL` so a session
 * that already has a persisted value is not silently overwritten by a later
 * checkpoint — this honours the v5 invariant "raz ustawiony kod zostaje do
 * końca sesji". Callers that need to intentionally change the value must
 * first NULL it out (deferred UX; not supported via this function in v1).
 *
 * When `client` is provided, runs inside the caller's transaction.
 */
export async function setMemoryLanguageCode(
  id: string,
  code: string,
  client?: PoolClient,
): Promise<void> {
  if (!LANG_CODE_RE.test(code)) {
    throw new Error(
      `setMemoryLanguageCode: invalid code "${code}" — expected ^([a-z]{2,3}(-[A-Z]{2})?|und)$`,
    );
  }
  const exec: Executor = client ?? getPool();
  await executeWith(
    exec,
    "UPDATE sessions SET memory_language_code = $2 WHERE id = $1 AND memory_language_code IS NULL",
    [id, code],
  );
}

/**
 * Partial archive — move messages with `id <= cutoffMessageId` into
 * `messages_archive` and set the live `message_count` to `remainingCount`
 * (i.e. the tail length that stays).
 *
 * When called without `client`, opens its own transaction (standalone call
 * sites — e.g. forced compaction). When called WITH `client`, it runs as
 * part of the caller's existing transaction (the PR2 atomic checkpoint
 * write phase). Either way the combined "delete from messages + insert
 * into messages_archive + update sessions.message_count" stays atomic.
 *
 * Column parity between `messages` and `messages_archive` is required by
 * migration 002; this helper relies on that invariant.
 */
export async function archivePrefix(
  sessionId: string,
  cutoffMessageId: number,
  remainingCount: number,
  client?: PoolClient,
): Promise<void> {
  if (client) {
    await runArchivePrefixStatements(client, sessionId, cutoffMessageId, remainingCount);
    return;
  }
  const pool = getPool();
  const own = await pool.connect();
  try {
    await own.query("BEGIN");
    await runArchivePrefixStatements(own, sessionId, cutoffMessageId, remainingCount);
    await own.query("COMMIT");
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}

async function runArchivePrefixStatements(
  tx: PoolClient,
  sessionId: string,
  cutoffMessageId: number,
  remainingCount: number,
): Promise<void> {
  // ON CONFLICT (id) DO NOTHING handles the giant-tool fork/copy case:
  // forkToolMessageToArchive already copied the pre-placeholder payload into
  // messages_archive under the same id, so when the (now placeholder) row
  // later ages into a normal prefix and gets moved here, we must NOT collide
  // with the already-archived full payload. Dropping the placeholder insert
  // is correct — archive already holds the canonical content.
  await tx.query(
    `WITH moved AS (
       DELETE FROM messages
       WHERE session_id = $1 AND id <= $2
       RETURNING *
     )
     INSERT INTO messages_archive SELECT * FROM moved
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, cutoffMessageId],
  );
  await tx.query(
    "UPDATE sessions SET message_count = $2 WHERE id = $1",
    [sessionId, remainingCount],
  );
}

/**
 * Giant-tool fallback — COPY (not MOVE) a single live message into the archive
 * and replace the live row's `content` with a short placeholder.
 *
 * The live row keeps its `id` and `tool_call_id` so `assistant.tool_calls` ↔
 * `role:'tool'` pairing survives. The archive row carries the full payload
 * under the same `id`, so a future chunked-read tool can resolve the pointer
 * and `archivePrefix` can later drop the placeholder row without colliding
 * (both sides use `ON CONFLICT (id) DO NOTHING` to stay idempotent).
 */
export async function forkToolMessageToArchive(
  messageId: number,
  placeholderContent: string,
  client?: PoolClient,
): Promise<void> {
  if (client) {
    await runForkToolStatements(client, messageId, placeholderContent);
    return;
  }
  const pool = getPool();
  const own = await pool.connect();
  try {
    await own.query("BEGIN");
    await runForkToolStatements(own, messageId, placeholderContent);
    await own.query("COMMIT");
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}

async function runForkToolStatements(
  tx: PoolClient,
  messageId: number,
  placeholderContent: string,
): Promise<void> {
  // ON CONFLICT (id) DO NOTHING makes this retry-safe: if a crash between
  // the archive insert and the live UPDATE retries the whole fork, we'd
  // otherwise trip the unique index `LIKE INCLUDING INDEXES` copied from
  // `messages.id`'s PK.
  await tx.query(
    `INSERT INTO messages_archive SELECT * FROM messages WHERE id = $1
     ON CONFLICT (id) DO NOTHING`,
    [messageId],
  );
  await tx.query(
    "UPDATE messages SET content = $2 WHERE id = $1",
    [messageId, placeholderContent],
  );
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
