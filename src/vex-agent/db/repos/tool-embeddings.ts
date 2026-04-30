/**
 * tool_embeddings repo — dense-primary tool discovery.
 *
 * Schema in `010_tool_embeddings.sql`. Companion of `knowledge` repo:
 * - same audit columns (`embedding_model`, `embedding_dim`) — recall MUST
 *   filter by `(embedding_model, embedding_dim)` so audit drift between
 *   write and read paths surfaces as zero recall, not silent miss.
 * - same `content_hash` idempotency contract — `upsert` is a no-op when
 *   the row already exists with the same hash.
 *
 * `searchByVector` runs an exact cosine scan with the audit filter applied
 * before the ORDER BY. There is no ANN index on `tool_embeddings.embedding`
 * by design — the typmod-free vector column lets us swap dim later without
 * a destructive migration; brute-force scan is cheap through ~10k rows.
 */

import {
  execute,
  queryOne,
  query,
} from "../client.js";
import { vectorLiteral } from "./knowledge/types.js";

// ── Types ────────────────────────────────────────────────────────

export interface ToolEmbeddingRow {
  toolId: string;
  namespace: string;
  contentHash: string;
  embeddingModel: string;
  embeddingDim: number;
  refreshedAt: Date;
}

export interface ToolEmbeddingUpsert {
  toolId: string;
  namespace: string;
  contentHash: string;
  embeddingModel: string;
  embeddingDim: number;
  embedding: readonly number[];
}

export interface ToolEmbeddingSearchHit {
  toolId: string;
  namespace: string;
  /** Cosine distance from query (`<=>`) — lower is better; range [0, 2]. */
  distance: number;
  /** Cosine similarity in [-1, 1], computed as `1 - distance`. */
  similarity: number;
}

interface ToolEmbeddingDbRow {
  tool_id: string;
  namespace: string;
  content_hash: string;
  embedding_model: string;
  embedding_dim: number;
  refreshed_at: Date;
}

interface ToolEmbeddingSearchDbRow {
  tool_id: string;
  namespace: string;
  distance: number;
}

// ── Existence / dedupe ───────────────────────────────────────────

/**
 * Look up an existing row by `content_hash`. Used by reembed to short-circuit
 * unchanged tools — if the hash matches the stored row, we skip the embedding
 * call entirely.
 */
export async function findExistingByHash(
  contentHash: string,
): Promise<ToolEmbeddingRow | null> {
  const row = await queryOne<ToolEmbeddingDbRow>(
    `SELECT tool_id, namespace, content_hash, embedding_model, embedding_dim, refreshed_at
     FROM tool_embeddings
     WHERE content_hash = $1`,
    [contentHash],
  );
  return row ? mapRow(row) : null;
}

// ── Upsert ───────────────────────────────────────────────────────

/**
 * Upsert a tool embedding by `tool_id`. Replaces the entire row on conflict
 * — `content_hash` should differ if the source text changed, but we always
 * overwrite to keep the per-tool row authoritative.
 */
export async function upsertToolEmbedding(input: ToolEmbeddingUpsert): Promise<void> {
  await execute(
    `INSERT INTO tool_embeddings (
       tool_id, namespace, content_hash,
       embedding_model, embedding_dim,
       embedding, refreshed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::vector, NOW())
     ON CONFLICT (tool_id) DO UPDATE SET
       namespace        = EXCLUDED.namespace,
       content_hash     = EXCLUDED.content_hash,
       embedding_model  = EXCLUDED.embedding_model,
       embedding_dim    = EXCLUDED.embedding_dim,
       embedding        = EXCLUDED.embedding,
       refreshed_at     = NOW()`,
    [
      input.toolId,
      input.namespace,
      input.contentHash,
      input.embeddingModel,
      input.embeddingDim,
      vectorLiteral(input.embedding),
    ],
  );
}

// ── Search ───────────────────────────────────────────────────────

export interface ToolEmbeddingSearchOptions {
  k: number;
  embeddingModel: string;
  embeddingDim: number;
  /** Optional namespace filter (single namespace allowlist). */
  namespace?: string;
}

/**
 * Cosine-similarity search over `tool_embeddings`. Returns top-`k` hits by
 * cosine distance (`<=>`), filtered by audit columns.
 *
 * The audit filter is non-negotiable: a row written under one embedding model
 * must not match a query embedded under another (different vector spaces).
 * We accept the small write-side cost (one extra column comparison) to avoid
 * silent recall drift across model swaps.
 */
export async function searchByVector(
  embedding: readonly number[],
  options: ToolEmbeddingSearchOptions,
): Promise<ToolEmbeddingSearchHit[]> {
  const params: unknown[] = [
    vectorLiteral(embedding),
    options.embeddingModel,
    options.embeddingDim,
    options.k,
  ];
  let namespaceClause = "";
  if (options.namespace !== undefined && options.namespace.trim().length > 0) {
    params.push(options.namespace);
    namespaceClause = `AND namespace = $${params.length}`;
  }

  const rows = await query<ToolEmbeddingSearchDbRow>(
    `SELECT
       tool_id,
       namespace,
       embedding <=> $1::vector AS distance
     FROM tool_embeddings
     WHERE embedding_model = $2
       AND embedding_dim   = $3
       ${namespaceClause}
     ORDER BY embedding <=> $1::vector ASC
     LIMIT $4`,
    params,
  );

  return rows.map((r) => ({
    toolId: r.tool_id,
    namespace: r.namespace,
    distance: r.distance,
    similarity: 1 - r.distance,
  }));
}

// ── Bookkeeping ──────────────────────────────────────────────────

/** Total row count — used by reembed/healthcheck reporting. */
export async function countToolEmbeddings(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM tool_embeddings`,
    [],
  );
  return row ? Number(row.count) : 0;
}

/**
 * Row count filtered by (embedding_model, embedding_dim).
 *
 * Used by the health check to detect model/dim mismatch: a non-zero total
 * but zero count for the current config means the table was populated under
 * a different model or dim and needs a fresh `pnpm tool-reembed` run.
 */
export async function countByModelDim(model: string, dim: number): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM tool_embeddings
     WHERE embedding_model = $1
       AND embedding_dim   = $2`,
    [model, dim],
  );
  return row ? Number(row.count) : 0;
}

/** Delete every row — only used by tests. */
export async function deleteAllToolEmbeddings(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `WITH deleted AS (DELETE FROM tool_embeddings RETURNING tool_id)
     SELECT COUNT(*)::text AS count FROM deleted`,
    [],
  );
  return row ? Number(row.count) : 0;
}

// ── Mapping ──────────────────────────────────────────────────────

function mapRow(row: ToolEmbeddingDbRow): ToolEmbeddingRow {
  return {
    toolId: row.tool_id,
    namespace: row.namespace,
    contentHash: row.content_hash,
    embeddingModel: row.embedding_model,
    embeddingDim: row.embedding_dim,
    refreshedAt: row.refreshed_at,
  };
}
