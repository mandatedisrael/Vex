/**
 * memory_entities repo — row types, domain types, mappers, helpers (S1d).
 *
 * Normalized entity nodes (the canonical things memories are about). The async
 * memory_manager (S8) extracts/normalizes them from promoted knowledge_entries;
 * this module is the storage substrate only.
 *
 * Embedding contract mirrors `knowledge_entries` / `memory_candidates`: the
 * vector column has NO typmod; per-row `embedding_model` + `embedding_dim` are
 * authoritative (entity resolution filters on them). The raw NAME embedding is
 * write-only — `RETURNING *` returns it at runtime and `mapRow` ignores it
 * (siblings do the same).
 *
 * `vectorLiteral` and `toIsoOrNull` are kept LOCAL (copied, not imported from a
 * sibling repo's internals) to avoid coupling — the same precedent as
 * `memory-candidates/types.ts`.
 *
 * Pure-data module: interfaces + pg-row → domain conversion + small helpers.
 */

import type { MemoryEntityType } from "@vex-agent/memory/schema/memory-entity-enums.js";

export type { MemoryEntityType } from "@vex-agent/memory/schema/memory-entity-enums.js";

// ── Pg row shape (snake_case) ───────────────────────────────────
//
// `embedding` is intentionally omitted: it is write-only and `mapRow` never
// reads it (matches knowledge / memory-candidates). Timestamps are `string` to
// match the sibling repos.
export interface MemoryEntityRow {
  id: string;
  entity_type: string;
  name: string;
  normalized_name: string;
  aliases: string[] | null;
  summary: string;
  attributes: Record<string, unknown> | null;
  embedding_model: string;
  embedding_dim: number;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryEntityRowWithInsertFlag extends MemoryEntityRow {
  inserted: boolean;
}

// ── Domain shape (camelCase) ────────────────────────────────────
export interface MemoryEntity {
  id: string;
  entityType: MemoryEntityType;
  name: string;
  /** Canonical dedup key — lower()+collapsed-whitespace of `name` (normalizeEntityName). */
  normalizedName: string;
  aliases: string[];
  summary: string;
  attributes: Record<string, unknown>;
  embeddingModel: string;
  embeddingDim: number;
  /** World: when the entity became known. */
  validFrom: string;
  /** World: when the entity ceased (NULL = active). */
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Repo INSERT input — the trusted, typed value S8 hands to `upsertEntity`. The
 * dedup key `normalized_name` is NOT a field here: `upsertEntity` derives it
 * internally from `name` via `normalizeEntityName`, so the key is single-source
 * and repo-owned — a caller can never store a `name` that disagrees with its
 * dedup key (a memory-poisoning vector, §6/D2). System / DB-owned columns
 * (`id`, `normalized_name`, `valid_until`, `created_at`, `updated_at`) are NOT here.
 */
export interface UpsertEntityInput {
  entityType: MemoryEntityType;
  name: string;
  aliases: string[];
  summary: string;
  attributes: Record<string, unknown>;
  /** NAME embedding as plain number[]. MUST match embeddingDim (DB CHECK + repo precheck). */
  embedding: number[];
  embeddingModel: string;
  embeddingDim: number;
  validFrom: Date | null;
}

export interface UpsertEntityResult {
  entity: MemoryEntity;
  /** True iff newly inserted; false iff an active row with this identity already existed. */
  inserted: boolean;
}

// ── Mapper ──────────────────────────────────────────────────────

export function mapRow(r: MemoryEntityRow): MemoryEntity {
  return {
    id: r.id,
    entityType: r.entity_type as MemoryEntityType,
    name: r.name,
    normalizedName: r.normalized_name,
    aliases: r.aliases ?? [],
    summary: r.summary,
    attributes: r.attributes ?? {},
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
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
// Mirrors `MemoryEntityRow` exactly and DELIBERATELY excludes `embedding`: reads
// never need the raw vector (resolution does its own vector SELECT in S8), so
// list / get queries stay cheap. Upserts use `RETURNING *` (the xmax pattern)
// and `mapRow` ignores the returned embedding.
export const ENTITY_COLUMNS = `
  id, entity_type, name, normalized_name, aliases, summary, attributes,
  embedding_model, embedding_dim, valid_from, valid_until, created_at, updated_at
`;
