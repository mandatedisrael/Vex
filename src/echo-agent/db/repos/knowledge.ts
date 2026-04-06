/**
 * Knowledge repo — canonical agent memory with embeddings + tiered TTL.
 *
 * Schema lives in 001_initial.sql (knowledge_entries). Vector ops use pgvector
 * `<=>` cosine distance operator (lower is closer; similarity = 1 - distance).
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
  embedding_model: string;
  embedding_dim: number;
  created_at: string;
  updated_at: string;
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
  embeddingModel: string;
  embeddingDim: number;
  /** Vector as plain number[] of length 768. Serialized to pgvector literal. */
  embedding: number[];
}

export interface RecallFilters {
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

// ── Insert ───────────────────────────────────────────────────────

export async function insertEntry(input: InsertEntryInput): Promise<KnowledgeEntry> {
  const row = await queryOne<KnowledgeRow>(
    `INSERT INTO knowledge_entries (
       kind, title, summary, content_md, tags, source_refs,
       confidence, status, pinned, valid_from, valid_until,
       embedding_model, embedding_dim, embedding
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, 'active', $8, NOW(), $9,
       $10, $11, $12::vector
     )
     RETURNING *`,
    [
      input.kind,
      input.title,
      input.summary,
      input.contentMd,
      input.tags,
      JSON.stringify(input.sourceRefs),
      input.confidence,
      input.pinned,
      input.validUntil ? input.validUntil.toISOString() : null,
      input.embeddingModel,
      input.embeddingDim,
      vectorLiteral(input.embedding),
    ],
  );
  if (!row) throw new Error("knowledge_entries insert returned no row");
  return mapRow(row);
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

// ── Recall (vector search) ───────────────────────────────────────

/**
 * Top-K cosine recall over `knowledge_entries`, with optional kind/expiry filters.
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
  // Always exclude invalidated/archived from recall.
  // include_expired controls whether expired-but-active entries are returned.
  const includeExpired = filters.includeExpired !== false;
  const params: unknown[] = [vectorLiteral(queryEmbedding)];
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
       embedding_model, embedding_dim, created_at, updated_at,
       (embedding <=> $1::vector) AS cosine_distance
     FROM knowledge_entries
     WHERE status = 'active'
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
