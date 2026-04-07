/**
 * Knowledge repo — canonical agent memory with embeddings + tiered TTL.
 *
 * Schema lives in 001_initial.sql (knowledge_entries). Vector ops use pgvector
 * `<=>` cosine distance operator (lower is closer; similarity = 1 - distance).
 *
 * Portability contract:
 * - The vector column has NO typmod, so the type accepts any dim. Per-row
 *   `embedding_dim` and `embedding_model` are authoritative.
 * - `recallTopK` MUST filter by `embedding_model` AND `embedding_dim` — mixed
 *   dims would crash on `<=>`.
 * - `content_hash` is the UNIQUE idempotency key. `insertEntry` returns
 *   `{ entry, inserted }` so callers can distinguish a new write from a
 *   no-op duplicate. Metadata is NEVER silently merged on conflict — the
 *   existing row is returned untouched.
 *
 * No business logic here — pure CRUD + a parameterized vector search.
 * Ranking heuristics live in src/echo-agent/knowledge/ranking.ts.
 */

import { query, queryOne, execute } from "../client.js";
import type { KnowledgeStatus, UpdatableKnowledgeStatus } from "@echo-agent/knowledge/policy.js";
import type { RecallCandidate } from "@echo-agent/knowledge/ranking.js";

// ── Row + domain types ──────────────────────────────────────────

interface KnowledgeRow {
  id: number;
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string[] | null;
  source_refs: Record<string, unknown> | null;
  confidence: number | null;
  status: string;
  pinned: boolean;
  valid_from: string;
  valid_until: string | null;
  content_hash: string;
  embedding_model: string;
  embedding_dim: number;
  created_at: string;
  updated_at: string;
}

interface KnowledgeRowWithInsertFlag extends KnowledgeRow {
  inserted: boolean;
}

interface KnowledgeRecallRow extends KnowledgeRow {
  /** pgvector returns cosine distance via `<=>`; we expose similarity = 1 - distance. */
  cosine_distance: number;
}

export interface KnowledgeEntry {
  id: number;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  tags: string[];
  sourceRefs: Record<string, unknown>;
  confidence: number | null;
  status: KnowledgeStatus;
  pinned: boolean;
  validFrom: string;
  validUntil: string | null;
  contentHash: string;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveKnowledgeListItem {
  id: number;
  kind: string;
  title: string;
  summary: string;
  pinned: boolean;
  validUntil: string | null;
  updatedAt: string;
}

export interface KnownKind {
  kind: string;
  count: number;
}

export interface InsertEntryInput {
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  tags: string[];
  sourceRefs: Record<string, unknown>;
  confidence: number | null;
  pinned: boolean;
  validUntil: Date | null;
  contentHash: string;
  embeddingModel: string;
  embeddingDim: number;
  /** Vector as plain number[]. Must match embeddingDim. Serialized to pgvector literal. */
  embedding: number[];
  // ── Optional audit fields (used by knowledge-import to preserve roundtrip).
  // knowledge_write does NOT pass these — defaults `'active'` / NOW() apply.
  status?: KnowledgeStatus;
  validFrom?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InsertEntryResult {
  entry: KnowledgeEntry;
  /** True iff the row was newly inserted; false iff it already existed (content_hash collision). */
  inserted: boolean;
}

export interface RecallFilters {
  /** Required — current embedding model identifier. Recall ONLY returns rows produced by this model. */
  embeddingModel: string;
  /** Required — current embedding dim. Recall ONLY returns rows with matching dim (mixed-dim crash protection). */
  embeddingDim: number;
  /** Optional kind filter (free-form, no enum). */
  kind?: string;
  /** If true, include entries past their TTL. Default: true (TTL ≠ existence). */
  includeExpired?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────

function mapRow(r: KnowledgeRow): KnowledgeEntry {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    tags: r.tags ?? [],
    sourceRefs: r.source_refs ?? {},
    confidence: r.confidence,
    status: r.status as KnowledgeStatus,
    pinned: r.pinned,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    contentHash: r.content_hash,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapRowToCandidate(r: KnowledgeRecallRow): RecallCandidate {
  // pgvector cosine distance is in [0, 2]; for normalized vectors it's in [0, 2] too
  // but TEI/embedding models normalize, so distance ∈ [0, 2]. Similarity = 1 - distance/2
  // is one convention; another is similarity = 1 - distance for unit-norm L2-distance.
  // pgvector docs use `1 - (embedding <=> query)` for similarity, treating distance as
  // cosine distance ∈ [0, 2]. We follow that.
  const similarity = clampUnit(1 - r.cosine_distance);
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    similarity,
    confidence: r.confidence,
    status: r.status as KnowledgeStatus,
    pinned: r.pinned,
    validUntil: r.valid_until ? new Date(r.valid_until) : null,
    validFrom: new Date(r.valid_from),
    updatedAt: new Date(r.updated_at),
    sourceRefs: r.source_refs ?? {},
    tags: r.tags ?? [],
  };
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Serialize a number[] to a pgvector literal: `[0.1,0.2,...]`.
 *
 * pgvector accepts text-format vectors via `$1::vector` cast. We do this in TS
 * so we don't need a special pg type adapter.
 */
function vectorLiteral(v: readonly number[]): string {
  // Use minimal precision sufficient for embedding vectors. Float32 is what TEI returns.
  return "[" + v.join(",") + "]";
}

function toIsoOrNull(d: Date | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ── Insert (idempotent upsert by content_hash) ───────────────────

/**
 * Insert a knowledge entry, idempotent on `content_hash`.
 *
 * - If no row with this `content_hash` exists, INSERT it and return
 *   `{ entry, inserted: true }`.
 * - If a row with this `content_hash` already exists, return
 *   `{ entry: <existing row>, inserted: false }` — the existing row is
 *   NOT modified. Metadata is intentionally immutable on conflict; callers
 *   that want to change tags/pinned/etc. must use a separate update tool.
 *
 * Optional audit fields (`status`, `validFrom`, `createdAt`, `updatedAt`) let
 * the import script preserve roundtrip exactness. knowledge_write does not
 * pass them, so defaults (`'active'`, `NOW()`) apply.
 *
 * Implementation note: a CTE (rather than the xmax trick) is used to detect
 * insert vs. existing. ON CONFLICT DO NOTHING + RETURNING returns rows only
 * for inserts; the second branch SELECTs the existing row.
 */
export async function insertEntry(input: InsertEntryInput): Promise<InsertEntryResult> {
  if (input.embedding.length !== input.embeddingDim) {
    throw new Error(
      `insertEntry: embedding length ${input.embedding.length} does not match embeddingDim ${input.embeddingDim} ` +
        `(content_hash=${input.contentHash}). The DB CHECK constraint would reject this.`,
    );
  }

  const row = await queryOne<KnowledgeRowWithInsertFlag>(
    `WITH ins AS (
       INSERT INTO knowledge_entries (
         kind, title, summary, content_md, tags, source_refs,
         confidence, status, pinned, valid_from, valid_until,
         content_hash, embedding_model, embedding_dim, embedding,
         created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, COALESCE($8::text, 'active'), $9, COALESCE($10::timestamptz, NOW()), $11,
         $12, $13, $14, $15::vector,
         COALESCE($16::timestamptz, NOW()), COALESCE($17::timestamptz, NOW())
       )
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING *
     )
     SELECT *, true AS inserted FROM ins
     UNION ALL
     SELECT k.*, false AS inserted FROM knowledge_entries k
       WHERE k.content_hash = $12 AND NOT EXISTS (SELECT 1 FROM ins)`,
    [
      input.kind,
      input.title,
      input.summary,
      input.contentMd,
      input.tags,
      JSON.stringify(input.sourceRefs),
      input.confidence,
      input.status ?? null,
      input.pinned,
      toIsoOrNull(input.validFrom),
      input.validUntil ? input.validUntil.toISOString() : null,
      input.contentHash,
      input.embeddingModel,
      input.embeddingDim,
      vectorLiteral(input.embedding),
      toIsoOrNull(input.createdAt),
      toIsoOrNull(input.updatedAt),
    ],
  );
  if (!row) throw new Error("knowledge_entries upsert returned no row");
  const { inserted, ...rest } = row;
  return { entry: mapRow(rest as KnowledgeRow), inserted };
}

// ── Get by ID ────────────────────────────────────────────────────

export async function getById(id: number): Promise<KnowledgeEntry | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await queryOne<KnowledgeRow>(
    "SELECT * FROM knowledge_entries WHERE id = $1",
    [id],
  );
  return row ? mapRow(row) : null;
}

// ── Find by content hash ─────────────────────────────────────────

export async function findByContentHash(hash: string): Promise<KnowledgeEntry | null> {
  if (!hash) return null;
  const row = await queryOne<KnowledgeRow>(
    "SELECT * FROM knowledge_entries WHERE content_hash = $1",
    [hash],
  );
  return row ? mapRow(row) : null;
}

// ── Update status ────────────────────────────────────────────────

export async function updateStatus(
  id: number,
  status: UpdatableKnowledgeStatus,
): Promise<boolean> {
  if (!Number.isFinite(id) || id <= 0) return false;
  const rowCount = await execute(
    "UPDATE knowledge_entries SET status = $1, updated_at = NOW() WHERE id = $2",
    [status, id],
  );
  return rowCount === 1;
}

// ── Update embedding (re-embed in place) ─────────────────────────

/**
 * Replace a row's embedding (and audit columns) with a freshly-computed one.
 * Used by `knowledge-reembed` script when the model changes but the dim stays.
 */
export async function updateEmbedding(
  id: number,
  model: string,
  dim: number,
  vector: readonly number[],
): Promise<boolean> {
  if (!Number.isFinite(id) || id <= 0) return false;
  if (vector.length !== dim) {
    throw new Error(
      `updateEmbedding: vector length ${vector.length} does not match dim ${dim} (id=${id}). ` +
        `The DB CHECK constraint would reject this.`,
    );
  }
  const rowCount = await execute(
    `UPDATE knowledge_entries
     SET embedding = $1::vector,
         embedding_model = $2,
         embedding_dim = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [vectorLiteral(vector), model, dim, id],
  );
  return rowCount === 1;
}

// ── Recall (vector search) ───────────────────────────────────────

/**
 * Top-K cosine recall over `knowledge_entries`, with MANDATORY filter by
 * `embedding_model` and `embedding_dim` plus optional kind/expiry filters.
 *
 * The model+dim filter is mandatory (not optional) because the column type
 * has no typmod — running `<=>` against rows produced by a different-dim
 * model crashes pgvector. The filter is also semantic: comparing similarities
 * across different model spaces is meaningless.
 *
 * Fetches `k * 2` raw candidates from SQL, returns them as ranking inputs.
 * The caller (handler) reruns these through `rerank()` from knowledge/ranking.ts
 * before splitting into inline + overflow.
 */
export async function recallTopK(
  queryEmbedding: readonly number[],
  filters: RecallFilters,
  k: number,
): Promise<RecallCandidate[]> {
  if (k <= 0) return [];
  if (queryEmbedding.length !== filters.embeddingDim) {
    throw new Error(
      `recallTopK: query embedding length ${queryEmbedding.length} does not match filter dim ${filters.embeddingDim}`,
    );
  }

  // Always exclude invalidated/archived from recall.
  // include_expired controls whether expired-but-active entries are returned.
  const includeExpired = filters.includeExpired !== false;
  const params: unknown[] = [
    vectorLiteral(queryEmbedding),
    filters.embeddingModel,
    filters.embeddingDim,
  ];
  let whereExtra = "";

  if (filters.kind) {
    params.push(filters.kind);
    whereExtra += ` AND kind = $${params.length}`;
  }
  if (!includeExpired) {
    whereExtra += " AND (pinned = TRUE OR valid_until IS NULL OR valid_until > now())";
  }

  params.push(k * 2);
  const limitParam = `$${params.length}`;

  const rows = await query<KnowledgeRecallRow>(
    `SELECT
       id, kind, title, summary, content_md, tags, source_refs,
       confidence, status, pinned, valid_from, valid_until,
       content_hash, embedding_model, embedding_dim, created_at, updated_at,
       (embedding <=> $1::vector) AS cosine_distance
     FROM knowledge_entries
     WHERE status = 'active'
       AND embedding_model = $2
       AND embedding_dim = $3
       ${whereExtra}
     ORDER BY embedding <=> $1::vector
     LIMIT ${limitParam}`,
    params,
  );

  return rows.map(mapRowToCandidate);
}

// ── Active Knowledge (hot context fetch) ─────────────────────────

export interface ListActiveOptions {
  limit: number;
}

export async function listActiveForHotContext(
  opts: ListActiveOptions,
): Promise<ActiveKnowledgeListItem[]> {
  const rows = await query<{
    id: number;
    kind: string;
    title: string;
    summary: string;
    pinned: boolean;
    valid_until: string | null;
    updated_at: string;
  }>(
    `SELECT id, kind, title, summary, pinned, valid_until, updated_at
     FROM knowledge_entries
     WHERE status = 'active'
       AND (pinned = TRUE OR valid_until > now())
     ORDER BY pinned DESC, updated_at DESC
     LIMIT $1`,
    [opts.limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    pinned: r.pinned,
    validUntil: r.valid_until,
    updatedAt: r.updated_at,
  }));
}

// ── Known kinds (for prompt) ─────────────────────────────────────

export interface ListKnownKindsOptions {
  limit: number;
}

export async function listKnownKinds(opts: ListKnownKindsOptions): Promise<KnownKind[]> {
  const rows = await query<{ kind: string; n: string }>(
    `SELECT kind, count(*) AS n
     FROM knowledge_entries
     WHERE status = 'active'
     GROUP BY kind
     ORDER BY n DESC
     LIMIT $1`,
    [opts.limit],
  );
  return rows.map((r) => ({ kind: r.kind, count: parseInt(r.n, 10) }));
}

// ── Bulk read for export ─────────────────────────────────────────

/**
 * Stream every row in `knowledge_entries` for export.
 *
 * Paginated by id (`WHERE id > $cursor ORDER BY id LIMIT $batch`) so memory
 * stays bounded regardless of corpus size. The embedding column is NOT
 * fetched — exports never carry vectors (re-embed happens on import).
 */
export async function* streamAllForExport(
  batchSize = 100,
): AsyncIterable<KnowledgeEntry> {
  let cursor = 0;
  // ESLint: intentional infinite loop; the page-size guard breaks it.
  while (true) {
    const rows = await query<KnowledgeRow>(
      `SELECT
         id, kind, title, summary, content_md, tags, source_refs,
         confidence, status, pinned, valid_from, valid_until,
         content_hash, embedding_model, embedding_dim, created_at, updated_at
       FROM knowledge_entries
       WHERE id > $1
       ORDER BY id ASC
       LIMIT $2`,
      [cursor, batchSize],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      yield mapRow(row);
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) break;
  }
}

// ── Bulk read for re-embed ───────────────────────────────────────

export interface ReembedRow {
  id: number;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
}

/**
 * Stream rows that need re-embedding.
 *
 * If `includeMatching` is false (default), only rows whose `embedding_model`
 * does NOT match `currentModel` are streamed — re-running the script after
 * a successful pass is a no-op. If `--force` is used at the script level,
 * pass `includeMatching: true` to re-embed everything.
 */
export async function* streamRowsForReembed(
  currentModel: string,
  options: { includeMatching?: boolean; batchSize?: number } = {},
): AsyncIterable<ReembedRow> {
  const includeMatching = options.includeMatching ?? false;
  const batchSize = options.batchSize ?? 50;
  const whereModel = includeMatching ? "" : "AND embedding_model <> $2";
  const limitParam = includeMatching ? "$2" : "$3";
  let cursor = 0;
  while (true) {
    const params: unknown[] = includeMatching
      ? [cursor, batchSize]
      : [cursor, currentModel, batchSize];
    const rows = await query<{
      id: number;
      kind: string;
      title: string;
      summary: string;
      content_md: string;
    }>(
      `SELECT id, kind, title, summary, content_md
       FROM knowledge_entries
       WHERE id > $1
         ${whereModel}
       ORDER BY id ASC
       LIMIT ${limitParam}`,
      params,
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      yield {
        id: r.id,
        kind: r.kind,
        title: r.title,
        summary: r.summary,
        contentMd: r.content_md,
      };
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) break;
  }
}

// ── Reembed safety pre-checks ────────────────────────────────────

/**
 * Count rows whose `embedding_dim` differs from `currentDim`. Used as a hard
 * pre-check by `knowledge-reembed`: any non-zero result means the operator
 * must use the export-wipe-import flow instead, because mixed-dim recall
 * would crash pgvector.
 */
export async function findRowsWithDimNotMatching(currentDim: number): Promise<number> {
  const row = await queryOne<{ n: string }>(
    "SELECT count(*) AS n FROM knowledge_entries WHERE embedding_dim <> $1",
    [currentDim],
  );
  return row ? parseInt(row.n, 10) : 0;
}

/**
 * Cheap check on the singleton `runtime_state` row. Used as a soft pre-check
 * by `knowledge-reembed` against the most obvious race with the loop engine.
 *
 * NOTE: This is NOT a full write lock. MCP / internal tools / subagents / CLI
 * can still write to knowledge_entries while `active = FALSE`. The script
 * help text and README must explicitly tell operators to stop the FULL stack
 * of writers before running reembed.
 */
export async function isRuntimeActive(): Promise<boolean> {
  const row = await queryOne<{ active: boolean }>(
    "SELECT active FROM runtime_state WHERE id = 1",
  );
  return row?.active ?? false;
}
