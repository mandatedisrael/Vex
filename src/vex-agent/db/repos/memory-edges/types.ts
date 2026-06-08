/**
 * memory_edges repo — row types, domain types, mappers, helpers (S1d).
 *
 * Directed entity→entity relations, FULL bi-temporal (Q1): world-time
 * (`valid_from`/`valid_until`) + system-time (`invalidated_at`) + an explicit
 * `superseded_by_edge_id` pointer. An edge is NEVER deleted — invalidation sets
 * timestamps. "Currently believed" = `invalidated_at IS NULL`.
 *
 * Embedding contract: the FACT embedding is OPTIONAL and an all-or-none triplet
 * (`fact_embedding` / `embedding_model` / `embedding_dim`), guarded by
 * `med_embedding_triplet`. The raw vector is write-only — `mapRow` ignores it.
 * `vectorLiteral` / `toIsoOrNull` are kept LOCAL (sibling precedent).
 *
 * Pure-data module: interfaces + pg-row → domain conversion + small helpers.
 */

import type { MemoryEdgeRelation } from "@vex-agent/memory/schema/memory-edge-enums.js";

export type { MemoryEdgeRelation } from "@vex-agent/memory/schema/memory-edge-enums.js";

// ── Pg row shape (snake_case) ───────────────────────────────────
//
// `fact_embedding` is intentionally omitted: it is write-only and `mapRow` never
// reads it (matches knowledge / memory-candidates). Timestamps are `string`.
export interface MemoryEdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation: string;
  fact: string;
  embedding_model: string | null;
  embedding_dim: number | null;
  origin_entry_id: number | null;
  valid_from: string;
  valid_until: string | null;
  invalidated_at: string | null;
  superseded_by_edge_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryEdgeRowWithInsertFlag extends MemoryEdgeRow {
  inserted: boolean;
}

// ── Domain shape (camelCase) ────────────────────────────────────
export interface MemoryEdge {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relation: MemoryEdgeRelation;
  fact: string;
  /** Set iff the edge carries a FACT embedding (all-or-none triplet). */
  embeddingModel: string | null;
  embeddingDim: number | null;
  /** knowledge_entries.id that first asserted this edge (provenance; SET NULL on delete). */
  originEntryId: number | null;
  /** World: relation became true. */
  validFrom: string;
  /** World: relation stopped being true (NULL = open). */
  validUntil: string | null;
  /** System: when WE retracted/superseded it (NULL = currently believed). */
  invalidatedAt: string | null;
  /** Explicit successor pointer set by supersedeEdge (SET NULL if the successor is deleted). */
  supersededByEdgeId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Repo INSERT input — the trusted, typed value S8 hands to `upsertEdge` /
 * `supersedeEdge`. Validated upstream by `edgeInputSchema` (source≠target +
 * all-or-none fact triplet). `factEmbedding` / `embeddingModel` / `embeddingDim`
 * are all present or all null. System / DB-owned columns
 * (`id`, `valid_until`, `invalidated_at`, `superseded_by_edge_id`, timestamps)
 * are NOT here — except `validFrom`, which the producer may pin.
 */
export interface UpsertEdgeInput {
  sourceEntityId: string;
  targetEntityId: string;
  relation: MemoryEdgeRelation;
  fact: string;
  /** FACT embedding as plain number[], or null. MUST match embeddingDim when present. */
  factEmbedding: number[] | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
  originEntryId: number | null;
  validFrom: Date | null;
}

export interface UpsertEdgeResult {
  edge: MemoryEdge;
  /** True iff newly inserted; false iff an active edge for this triple already existed. */
  inserted: boolean;
}

// ── Mapper ──────────────────────────────────────────────────────

export function mapRow(r: MemoryEdgeRow): MemoryEdge {
  return {
    id: r.id,
    sourceEntityId: r.source_entity_id,
    targetEntityId: r.target_entity_id,
    relation: r.relation as MemoryEdgeRelation,
    fact: r.fact,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    originEntryId: r.origin_entry_id,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    invalidatedAt: r.invalidated_at,
    supersededByEdgeId: r.superseded_by_edge_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Local serialization helpers (kept local to avoid cyclic imports) ──

/** Serialize a number[] to a pgvector literal `[a,b,c]`, cast via `$N::vector`. */
export function vectorLiteral(v: readonly number[]): string {
  return "[" + v.join(",") + "]";
}

/** Convert an optional Date to an ISO string (or null) for a timestamptz param. */
export function toIsoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ── Column list (single source of truth for reads) ──────────────
//
// Mirrors `MemoryEdgeRow` exactly and DELIBERATELY excludes `fact_embedding`:
// reads never need the raw vector (recall does its own vector SELECT in S3/S8).
// Upserts use `RETURNING *` and `mapRow` ignores the returned embedding.
export const EDGE_COLUMNS = `
  id, source_entity_id, target_entity_id, relation, fact,
  embedding_model, embedding_dim, origin_entry_id,
  valid_from, valid_until, invalidated_at, superseded_by_edge_id,
  created_at, updated_at
`;
