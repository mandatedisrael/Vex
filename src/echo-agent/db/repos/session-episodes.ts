/**
 * Session episodes repo — mid-term conversational memory store.
 *
 * Sits between `sessions.summary` (rolling per-session) and `knowledge_entries`
 * (canonical, cross-session, curated). Episodes are write-once; promotion to
 * canonical knowledge is a separate follow-up (PR4 Fase IV), not in this module.
 *
 * Portability contract (mirrors `knowledge_entries`):
 *   - vector column has NO typmod; per-row `embedding_model` + `embedding_dim`
 *     are authoritative. `recallTopK` MUST filter on both, otherwise pgvector
 *     crashes on mixed-dim `<=>`.
 *   - `embedding.length === embeddingDim` guard runs before SQL so the CHECK
 *     constraint never has to reject the row.
 *   - Dedupe index is partial (`WHERE source_end_message_id IS NOT NULL`), so
 *     callers MUST include the predicate in ON CONFLICT or Postgres won't match
 *     the index. See `src/echo-agent/db/repos/open-positions.ts:54` for prior art.
 *
 * Multilingual contract (PR2, migration 008):
 *   - `summary_text` column (renamed from `summary_en`) carries text in the
 *     session's language (see `sessions.memory_language_code`). Knowledge
 *     entries remain English-only — translation happens at promotion.
 *   - `title` column is an LLM-generated short title (≤ 100 chars, same
 *     language as summary_text). It is NOT part of `episode_hash`, so a retry
 *     producing a different title on the same summary still dedupes cleanly.
 *
 * Transaction coordination (PR2):
 *   `insertEpisodes` accepts an optional `PoolClient`. When provided, it runs
 *   inside the caller's transaction instead of opening its own. The
 *   checkpoint atomic-write flow uses this to bundle episode inserts with
 *   the rolling-summary update, the archive move, and the language-code
 *   persist under one BEGIN/COMMIT.
 */

import type { PoolClient } from "pg";
import { getPool, query, queryOneWith } from "../client.js";
import { vectorLiteral } from "./knowledge/types.js";

// ── Domain types ────────────────────────────────────────────────

export type EpisodeKind =
  | "decision"
  | "fact"
  | "preference"
  | "open_loop"
  | "tool_result_summary"
  | "lesson";

export const EPISODE_KINDS: readonly EpisodeKind[] = [
  "decision",
  "fact",
  "preference",
  "open_loop",
  "tool_result_summary",
  "lesson",
] as const;

export interface SessionEpisode {
  id: number;
  sessionId: string;
  memoryScopeKey: string;
  episodeKind: EpisodeKind;
  /** LLM-generated episode title (≤100 chars), same language as summaryText. May be empty string for legacy rows. */
  title: string;
  /** Episode summary in the session's language (was `summaryEn` pre-PR2). */
  summaryText: string;
  facts: Record<string, unknown>;
  decisions: Record<string, unknown>;
  openLoops: Record<string, unknown>;
  entities: string[];
  toolOutcomes: Record<string, unknown>;
  sourceSurface: string;
  sourceSession: string | null;
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
  episodeHash: string;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: string;
}

export interface NewEpisode {
  sessionId: string;
  memoryScopeKey: string;
  episodeKind: EpisodeKind;
  /** LLM-generated title. Defaults to empty string when caller cannot provide one. */
  title: string;
  /** Summary text in the session's language. */
  summaryText: string;
  facts?: Record<string, unknown>;
  decisions?: Record<string, unknown>;
  openLoops?: Record<string, unknown>;
  entities?: string[];
  toolOutcomes?: Record<string, unknown>;
  sourceSurface?: string;
  sourceSession?: string | null;
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
  episodeHash: string;
  embeddingModel: string;
  embeddingDim: number;
  embedding: number[];
}

export interface RecallFilters {
  memoryScopeKey: string;
  embeddingModel: string;
  embeddingDim: number;
  topK: number;
  /** Minimum cosine similarity in [0, 1]. Rows below are filtered out. */
  minSimilarity?: number;
}

export interface RecallHit {
  episode: SessionEpisode;
  similarity: number;
}

// ── Row types + mappers ─────────────────────────────────────────

interface SessionEpisodeRow {
  id: number;
  session_id: string;
  memory_scope_key: string;
  episode_kind: string;
  title: string;
  summary_text: string;
  facts_jsonb: Record<string, unknown> | null;
  decisions_jsonb: Record<string, unknown> | null;
  open_loops_jsonb: Record<string, unknown> | null;
  entities: string[] | null;
  tool_outcomes_jsonb: Record<string, unknown> | null;
  source_surface: string;
  source_session: string | null;
  source_start_message_id: number | null;
  source_end_message_id: number | null;
  episode_hash: string;
  embedding_model: string;
  embedding_dim: number;
  created_at: string;
}

interface SessionEpisodeRecallRow extends SessionEpisodeRow {
  cosine_distance: number;
}

function mapRow(r: SessionEpisodeRow): SessionEpisode {
  return {
    id: r.id,
    sessionId: r.session_id,
    memoryScopeKey: r.memory_scope_key,
    episodeKind: r.episode_kind as EpisodeKind,
    title: r.title,
    summaryText: r.summary_text,
    facts: r.facts_jsonb ?? {},
    decisions: r.decisions_jsonb ?? {},
    openLoops: r.open_loops_jsonb ?? {},
    entities: r.entities ?? [],
    toolOutcomes: r.tool_outcomes_jsonb ?? {},
    sourceSurface: r.source_surface,
    sourceSession: r.source_session,
    sourceStartMessageId: r.source_start_message_id,
    sourceEndMessageId: r.source_end_message_id,
    episodeHash: r.episode_hash,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    createdAt: r.created_at,
  };
}

// Single source of truth for the column list — keeps INSERT and SELECT
// aligned so a column rename doesn't silently diverge.
const EPISODE_COLUMNS = `
  id, session_id, memory_scope_key, episode_kind, title, summary_text,
  facts_jsonb, decisions_jsonb, open_loops_jsonb, entities, tool_outcomes_jsonb,
  source_surface, source_session,
  source_start_message_id, source_end_message_id,
  episode_hash, embedding_model, embedding_dim, created_at
`;

// ── Insert ──────────────────────────────────────────────────────

/**
 * Batch-insert episodes, optionally as part of the caller's transaction.
 *
 * Returns only the rows that were newly inserted (ON CONFLICT collisions are
 * dropped). The partial unique index predicate is mirrored in ON CONFLICT so
 * Postgres can match it — omitting the WHERE clause silently disables dedupe.
 *
 * Each row's `embedding.length` is validated against `embeddingDim` before any
 * SQL runs so the DB CHECK constraint never has to reject.
 *
 * When `client` is provided (PR2 atomic checkpoint write), the inserts run
 * inside the caller's transaction — no BEGIN/COMMIT here. Otherwise opens
 * its own transaction (legacy call sites).
 */
export async function insertEpisodes(
  rows: readonly NewEpisode[],
  client?: PoolClient,
): Promise<SessionEpisode[]> {
  if (rows.length === 0) return [];

  for (const r of rows) {
    if (r.embedding.length !== r.embeddingDim) {
      throw new Error(
        `insertEpisodes: embedding length ${r.embedding.length} does not match embeddingDim ${r.embeddingDim} ` +
          `(session=${r.sessionId}, hash=${r.episodeHash}). DB CHECK constraint would reject this.`,
      );
    }
  }

  if (client) {
    return runInserts(client, rows);
  }

  const pool = getPool();
  const own = await pool.connect();
  try {
    await own.query("BEGIN");
    const inserted = await runInserts(own, rows);
    await own.query("COMMIT");
    return inserted;
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}

async function runInserts(
  tx: PoolClient,
  rows: readonly NewEpisode[],
): Promise<SessionEpisode[]> {
  const inserted: SessionEpisode[] = [];
  for (const r of rows) {
    const result = await tx.query<SessionEpisodeRow>(
      `INSERT INTO session_episodes (
         session_id, memory_scope_key, episode_kind, title, summary_text,
         facts_jsonb, decisions_jsonb, open_loops_jsonb, entities, tool_outcomes_jsonb,
         source_surface, source_session,
         source_start_message_id, source_end_message_id,
         episode_hash, embedding_model, embedding_dim, embedding
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         COALESCE($11::text, 'echo_agent'), $12,
         $13, $14,
         $15, $16, $17, $18::vector
       )
       ON CONFLICT (session_id, source_end_message_id, episode_hash)
         WHERE source_end_message_id IS NOT NULL
         DO NOTHING
       RETURNING ${EPISODE_COLUMNS}`,
      [
        r.sessionId,
        r.memoryScopeKey,
        r.episodeKind,
        r.title,
        r.summaryText,
        JSON.stringify(r.facts ?? {}),
        JSON.stringify(r.decisions ?? {}),
        JSON.stringify(r.openLoops ?? {}),
        r.entities ?? [],
        JSON.stringify(r.toolOutcomes ?? {}),
        r.sourceSurface ?? null,
        r.sourceSession ?? null,
        r.sourceStartMessageId,
        r.sourceEndMessageId,
        r.episodeHash,
        r.embeddingModel,
        r.embeddingDim,
        vectorLiteral(r.embedding),
      ],
    );
    if (result.rows[0]) inserted.push(mapRow(result.rows[0]));
  }
  return inserted;
}

// ── Recall ──────────────────────────────────────────────────────

/**
 * Top-K cosine recall scoped to (`memory_scope_key`, `embedding_model`,
 * `embedding_dim`). The model+dim filter is mandatory — mixed-dim `<=>` crashes
 * pgvector and cross-model similarity is semantically meaningless.
 *
 * Returns results sorted by similarity DESC, filtered by `minSimilarity` (if
 * provided) after the cosine conversion.
 */
export async function recallTopK(
  queryEmbedding: readonly number[],
  filters: RecallFilters,
): Promise<RecallHit[]> {
  if (filters.topK <= 0) return [];
  if (queryEmbedding.length !== filters.embeddingDim) {
    throw new Error(
      `recallTopK: query embedding length ${queryEmbedding.length} does not match filter dim ${filters.embeddingDim}`,
    );
  }

  const rows = await query<SessionEpisodeRecallRow>(
    `SELECT
       ${EPISODE_COLUMNS},
       (embedding <=> $1::vector) AS cosine_distance
     FROM session_episodes
     WHERE memory_scope_key = $2
       AND embedding_model  = $3
       AND embedding_dim    = $4
     ORDER BY embedding <=> $1::vector
     LIMIT $5`,
    [
      vectorLiteral(queryEmbedding),
      filters.memoryScopeKey,
      filters.embeddingModel,
      filters.embeddingDim,
      filters.topK,
    ],
  );

  const minSim = filters.minSimilarity ?? 0;
  const hits: RecallHit[] = [];
  for (const r of rows) {
    const similarity = clampUnit(1 - r.cosine_distance);
    if (similarity < minSim) continue;
    hits.push({ episode: mapRow(r), similarity });
  }
  return hits;
}

// ── List (debug / tests) ────────────────────────────────────────

export async function listRecentBySession(
  sessionId: string,
  limit = 50,
): Promise<SessionEpisode[]> {
  const rows = await query<SessionEpisodeRow>(
    `SELECT ${EPISODE_COLUMNS}
     FROM session_episodes
     WHERE session_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map(mapRow);
}

export async function getById(id: number): Promise<SessionEpisode | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await queryOneWith<SessionEpisodeRow>(
    getPool(),
    `SELECT ${EPISODE_COLUMNS} FROM session_episodes WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

// ── Promotion support (PR4 Fase IV) ─────────────────────────────

/** Kinds eligible for promotion — decision/preference/lesson always, fact conservatively. */
export const PROMOTABLE_KINDS: readonly EpisodeKind[] = [
  "decision",
  "preference",
  "lesson",
  "fact",
] as const;

/**
 * Episode variant used by the promotion pipeline — carries the raw
 * embedding so `countSimilar` can do cosine math without a separate
 * per-candidate fetch.
 */
export interface PromotionCandidate extends SessionEpisode {
  embedding: number[];
}

/**
 * List episodes that are CANDIDATES for promotion:
 *   - scope-local (same `memory_scope_key`)
 *   - kind in PROMOTABLE_KINDS
 *   - have a `source_end_message_id` (not ad-hoc)
 *   - not already promoted (no row in knowledge_entries with this
 *     source_episode_id — LEFT JOIN + NULL check)
 *
 * Returns `PromotionCandidate[]` (with the raw embedding) so the pipeline
 * can cluster-check near-duplicates via `countSimilar` without a second
 * DB round-trip per candidate.
 *
 * Ordered by `created_at DESC, id DESC` — fresher candidates first.
 */
export async function listPromotable(
  memoryScopeKey: string,
  limit = 50,
): Promise<PromotionCandidate[]> {
  const prefixedCols = EPISODE_COLUMNS
    .split(",")
    .map(c => "e." + c.trim())
    .join(", ");
  // Embedding comes back as a pgvector literal string like "[0.1,0.2,...]".
  // Parse into number[] below.
  const rows = await query<SessionEpisodeRow & { embedding_text: string }>(
    `SELECT ${prefixedCols},
            e.embedding::text AS embedding_text
     FROM session_episodes e
     LEFT JOIN knowledge_entries k ON k.source_episode_id = e.id
     WHERE e.memory_scope_key = $1
       AND e.source_end_message_id IS NOT NULL
       AND e.episode_kind = ANY($2::text[])
       AND k.id IS NULL
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $3`,
    [memoryScopeKey, PROMOTABLE_KINDS as unknown as string[], limit],
  );
  return rows.map(r => ({
    ...mapRow(r),
    embedding: parseVectorLiteral(r.embedding_text),
  }));
}

/**
 * Parse a pgvector string literal (`"[0.1,0.2,...]"`) back into a
 * number[] so the promotion pipeline can feed it to `countSimilar`.
 */
function parseVectorLiteral(literal: string): number[] {
  if (!literal) return [];
  const inner = literal.startsWith("[") && literal.endsWith("]")
    ? literal.slice(1, -1)
    : literal;
  if (inner.length === 0) return [];
  return inner.split(",").map(s => Number(s));
}

/**
 * Count near-duplicates of a candidate episode in the same scope + kind,
 * above a cosine similarity threshold. Excludes the candidate itself.
 * Used by promotion to apply the "N=2 similar episodes" signal — a single
 * one-off assertion shouldn't promote; a repeated observation should.
 *
 * Filters on (`memory_scope_key`, `episode_kind`, `embedding_model`,
 * `embedding_dim`) — mixed-model cosines would be semantic nonsense and
 * mixed-dim would crash pgvector.
 */
export async function countSimilar(
  episodeId: number,
  memoryScopeKey: string,
  episodeKind: EpisodeKind,
  queryEmbedding: readonly number[],
  embeddingModel: string,
  threshold: number,
): Promise<number> {
  if (queryEmbedding.length === 0) return 0;
  const row = await queryOneWith<{ n: string }>(
    getPool(),
    `SELECT count(*)::text AS n
     FROM session_episodes
     WHERE id <> $1
       AND memory_scope_key = $2
       AND episode_kind = $3
       AND embedding_model = $4
       AND embedding_dim = $5
       AND (1 - (embedding <=> $6::vector)) >= $7`,
    [
      episodeId,
      memoryScopeKey,
      episodeKind,
      embeddingModel,
      queryEmbedding.length,
      vectorLiteral(queryEmbedding),
      threshold,
    ],
  );
  return row ? parseInt(row.n, 10) : 0;
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
