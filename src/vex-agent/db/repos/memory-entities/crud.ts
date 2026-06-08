/**
 * memory_entities CRUD — upsert / get / find / alias-merge / invalidate / list
 * (S1d). The graph SUBSTRATE only: the async memory_manager (S8) decides WHEN to
 * assert/invalidate entities; this module is the race-safe HOW.
 *
 * Embedding contract (mirrors memory_candidates): the vector column has NO
 * typmod; per-row `embedding_dim` / `embedding_model` are authoritative.
 * `embedding.length === embeddingDim` is checked before SQL so the CHECK
 * constraint never has to reject the row.
 *
 * Dedup: AT MOST ONE active entity per `(entity_type, normalized_name)` (partial
 * unique `uniq_me_active_identity WHERE valid_until IS NULL`). `upsertEntity` is
 * a concurrency-safe xmax upsert keyed on that arbiter. Invalidated rows fall out
 * of the partial predicate, so re-asserting an invalidated identity inserts a NEW
 * active row (a fresh version) rather than conflicting.
 *
 * Observability: `memLog` (memory/observability/logger.ts), area `entity`. Only
 * allowlisted, structurally-safe meta — NEVER raw name / summary / alias text.
 */

import type { PoolClient } from "pg";

import { getPool, queryOneWith, queryWith, type Executor } from "../../client.js";
import { jsonb } from "../../params.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import { normalizeEntityName } from "@vex-agent/memory/schema/memory-entity.js";
import {
  ENTITY_COLUMNS,
  mapRow,
  toIsoOrNull,
  vectorLiteral,
  type MemoryEntity,
  type MemoryEntityRow,
  type MemoryEntityRowWithInsertFlag,
  type MemoryEntityType,
  type UpsertEntityInput,
  type UpsertEntityResult,
} from "./types.js";

// ── Upsert (concurrency-safe by active identity) ─────────────────

/**
 * Upsert an entity, idempotent on the active identity `(entity_type,
 * normalized_name)` while `valid_until IS NULL`. The partial unique index
 * `uniq_me_active_identity` is the ON CONFLICT arbiter, and a no-op
 * `DO UPDATE SET updated_at = memory_entities.updated_at` reliably returns the
 * row on BOTH paths; `(xmax = 0)` distinguishes a fresh insert (`inserted=true`)
 * from a conflict-merged row (`inserted=false`) — the memory_candidates
 * precedent. Re-asserting an INVALIDATED identity (valid_until set) does NOT
 * conflict (it left the partial predicate) and inserts a new active version.
 */
export async function upsertEntity(
  input: UpsertEntityInput,
  client?: PoolClient,
): Promise<UpsertEntityResult> {
  if (input.embedding.length !== input.embeddingDim) {
    throw new Error(
      `upsertEntity: embedding length ${input.embedding.length} does not match embeddingDim ${input.embeddingDim} ` +
        `(entity_type=${input.entityType}). The DB CHECK constraint would reject this.`,
    );
  }

  // Derive the dedup key here — the ONLY place it is produced — so a caller can
  // never store a name that disagrees with its normalized_name (§6/D2).
  const normalizedName = normalizeEntityName(input.name);

  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEntityRowWithInsertFlag>(
    exec,
    `INSERT INTO memory_entities (
       entity_type, name, normalized_name, aliases, summary, attributes,
       embedding, embedding_model, embedding_dim, valid_from
     )
     VALUES (
       $1, $2, $3, $4, $5, $6::jsonb,
       $7::vector, $8, $9, COALESCE($10::timestamptz, NOW())
     )
     ON CONFLICT (entity_type, normalized_name) WHERE valid_until IS NULL
     DO UPDATE SET updated_at = memory_entities.updated_at
     RETURNING *, (xmax = 0) AS inserted`,
    [
      input.entityType,
      input.name,
      normalizedName,
      input.aliases,
      input.summary,
      jsonb(input.attributes),
      vectorLiteral(input.embedding),
      input.embeddingModel,
      input.embeddingDim,
      toIsoOrNull(input.validFrom),
    ],
  );
  if (!row) {
    throw new Error(
      `upsertEntity: upsert returned no row (entity_type=${input.entityType}).`,
    );
  }
  const { inserted, ...rest } = row;
  const entity = mapRow(rest);

  memLog("entity", "upserted", {
    entityId: entity.id,
    entityType: entity.entityType,
    embeddingModel: entity.embeddingModel,
    embeddingDim: entity.embeddingDim,
    insertResult: inserted ? "inserted" : "duplicate",
  });

  return { entity, inserted };
}

// ── Get by id ────────────────────────────────────────────────────

export async function getEntityById(
  id: string,
  client?: PoolClient,
): Promise<MemoryEntity | null> {
  if (!id) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEntityRow>(
    exec,
    `SELECT ${ENTITY_COLUMNS} FROM memory_entities WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

// ── Find the active row for an identity ──────────────────────────

/**
 * The single active entity for `(entityType, normalizedName)`, or null. Reads
 * through `uniq_me_active_identity` — at most one row can match.
 */
export async function findActiveEntity(
  entityType: MemoryEntityType,
  normalizedName: string,
  client?: PoolClient,
): Promise<MemoryEntity | null> {
  if (!normalizedName) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEntityRow>(
    exec,
    `SELECT ${ENTITY_COLUMNS} FROM memory_entities
      WHERE entity_type = $1 AND normalized_name = $2 AND valid_until IS NULL`,
    [entityType, normalizedName],
  );
  return row ? mapRow(row) : null;
}

// ── Alias merge (active only) ────────────────────────────────────

/**
 * Merge `newAliases` into an ACTIVE entity's alias set, de-duplicated. The
 * `array(SELECT DISTINCT unnest(aliases || $2::text[]))` form keeps existing
 * order-independence and drops duplicates. Only mutates while `valid_until IS
 * NULL`; returns the updated entity, or null when the id is missing/invalidated.
 * An empty `newAliases` is a no-op that still returns the current active row.
 */
export async function addEntityAliases(
  id: string,
  newAliases: string[],
  client?: PoolClient,
): Promise<MemoryEntity | null> {
  if (!id) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEntityRow>(
    exec,
    `UPDATE memory_entities
        SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || $2::text[])),
            updated_at = NOW()
      WHERE id = $1 AND valid_until IS NULL
      RETURNING ${ENTITY_COLUMNS}`,
    [id, newAliases],
  );
  if (!row) return null;
  const entity = mapRow(row);
  memLog("entity", "aliased", { entityId: entity.id, count: newAliases.length });
  return entity;
}

// ── Invalidate (precondition-guarded) ────────────────────────────

export type InvalidateEntityResult =
  | { ok: true; entity: MemoryEntity }
  | { ok: false; reason: "not_found" | "already_invalidated" };

/**
 * Close an entity's world-time interval (`valid_until`) — bi-temporal
 * invalidation, the row is NEVER deleted. Precondition-guarded: only an ACTIVE
 * row (`valid_until IS NULL`) transitions, so re-invalidation is a no-op. A
 * zero-row update is disambiguated by a follow-up existence check.
 */
export async function invalidateEntity(
  id: string,
  validUntil: Date | null,
  client?: PoolClient,
): Promise<InvalidateEntityResult> {
  if (!id) return { ok: false, reason: "not_found" };
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEntityRow>(
    exec,
    `UPDATE memory_entities
        SET valid_until = COALESCE($2::timestamptz, NOW()), updated_at = NOW()
      WHERE id = $1 AND valid_until IS NULL
      RETURNING ${ENTITY_COLUMNS}`,
    [id, toIsoOrNull(validUntil)],
  );
  if (row) {
    const entity = mapRow(row);
    memLog("entity", "invalidated", { entityId: entity.id });
    return { ok: true, entity };
  }
  // Zero rows — disambiguate not_found vs already_invalidated.
  const existing = await queryOneWith<{ valid_until: string | null }>(
    exec,
    "SELECT valid_until FROM memory_entities WHERE id = $1",
    [id],
  );
  if (!existing) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "already_invalidated" };
}

// ── List (inspection / S8 seed) ──────────────────────────────────

export interface ListEntitiesOptions {
  entityType?: MemoryEntityType;
  /** When true (default), only active rows (`valid_until IS NULL`) are returned. */
  activeOnly?: boolean;
  /** Max rows; a non-positive / non-finite limit returns []. */
  limit?: number;
}

/**
 * List entities, newest `created_at` first, optionally filtered by type and
 * active state. `limit` defaults to 100; a non-positive / non-finite limit → [].
 */
export async function listEntities(
  options: ListEntitiesOptions = {},
  client?: PoolClient,
): Promise<MemoryEntity[]> {
  const limit = options.limit ?? 100;
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const activeOnly = options.activeOnly ?? true;
  const exec: Executor = client ?? getPool();

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.entityType !== undefined) {
    params.push(options.entityType);
    conditions.push(`entity_type = $${params.length}`);
  }
  if (activeOnly) conditions.push("valid_until IS NULL");
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.floor(limit));

  const rows = await queryWith<MemoryEntityRow>(
    exec,
    `SELECT ${ENTITY_COLUMNS} FROM memory_entities
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapRow);
}
