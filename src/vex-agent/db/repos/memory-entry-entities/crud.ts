/**
 * memory_entry_entities CRUD — link a knowledge_entry to an entity + reverse
 * lookups (S1d). The graph SUBSTRATE only; S8 decides which entities an entry
 * mentions.
 *
 * `linkEntryEntity` is an idempotent xmax upsert on the composite PK
 * `(entry_id, entity_id)`. On conflict it takes the GREATEST of the stored and
 * supplied `mention_count` (R1): the caller supplies the count, and a duplicate
 * S8 extraction / retry therefore can NEVER drift it (an increment-on-conflict
 * was non-idempotent). `(xmax = 0)` distinguishes a fresh insert from a conflict.
 *
 * Observability: `memLog` (memory/observability/logger.ts), area `entry_entity`.
 * Only allowlisted, structurally-safe meta.
 */

import type { PoolClient } from "pg";

import { getPool, queryOneWith, queryWith, type Executor } from "../../client.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import {
  ENTRY_ENTITY_COLUMNS,
  mapRow,
  type LinkEntryEntityResult,
  type MemoryEntryEntity,
  type MemoryEntryEntityRow,
  type MemoryEntryEntityRowWithInsertFlag,
} from "./types.js";

// ── Link (idempotent xmax upsert; conflict takes MAX mention_count) ──

/**
 * Link `entryId` ↔ `entityId`, idempotent on the composite PK. `mentionCount`
 * (default 1) is the caller-supplied count; on conflict the stored value becomes
 * `GREATEST(stored, supplied)` (R1 — retries never drift it). Returns the link
 * row and whether it was freshly inserted.
 */
export async function linkEntryEntity(
  entryId: number,
  entityId: string,
  mentionCount = 1,
  client?: PoolClient,
): Promise<LinkEntryEntityResult> {
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEntryEntityRowWithInsertFlag>(
    exec,
    `INSERT INTO memory_entry_entities (entry_id, entity_id, mention_count)
     VALUES ($1, $2, $3)
     ON CONFLICT (entry_id, entity_id)
     DO UPDATE SET mention_count = GREATEST(memory_entry_entities.mention_count, EXCLUDED.mention_count)
     RETURNING ${ENTRY_ENTITY_COLUMNS}, (xmax = 0) AS inserted`,
    [entryId, entityId, mentionCount],
  );
  if (!row) {
    throw new Error(
      `linkEntryEntity: upsert returned no row (entry=${entryId}, entity=${entityId}).`,
    );
  }
  const { inserted, ...rest } = row;
  const link = mapRow(rest);
  memLog("entry_entity", "linked", {
    entryId: link.entryId,
    entityId: link.entityId,
    insertResult: inserted ? "inserted" : "duplicate",
  });
  return { link, inserted };
}

// ── Reverse lookups ──────────────────────────────────────────────

/** Entities mentioned by `entryId`, highest mention_count first. */
export async function listEntitiesForEntry(
  entryId: number,
  client?: PoolClient,
): Promise<MemoryEntryEntity[]> {
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryEntryEntityRow>(
    exec,
    `SELECT ${ENTRY_ENTITY_COLUMNS} FROM memory_entry_entities
      WHERE entry_id = $1
      ORDER BY mention_count DESC, created_at ASC`,
    [entryId],
  );
  return rows.map(mapRow);
}

/** Entries that mention `entityId`, highest mention_count first (uses idx_mee_entity). */
export async function listEntriesForEntity(
  entityId: string,
  client?: PoolClient,
): Promise<MemoryEntryEntity[]> {
  if (!entityId) return [];
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryEntryEntityRow>(
    exec,
    `SELECT ${ENTRY_ENTITY_COLUMNS} FROM memory_entry_entities
      WHERE entity_id = $1
      ORDER BY mention_count DESC, created_at ASC`,
    [entityId],
  );
  return rows.map(mapRow);
}

// ── Batch lookups (S8 graph expansion — zero N+1) ────────────────

/** One `(entry, entity)` link pair from a batch lookup. */
export interface EntryEntityLink {
  /** knowledge_entries.id (SERIAL). */
  entryId: number;
  /** memory_entities.id (UUID). */
  entityId: string;
}

/**
 * All `(entry, entity)` link pairs for a BATCH of entries (S8 expansion step 1:
 * seed entries → their entities). One `= ANY($1)` query — never per-entry. No
 * active-state filter here: links are historical records; the expansion applies
 * its activity filters on entities (edges) and entries (`listEntryIdsForEntities`).
 */
export async function listEntityIdsForEntries(
  entryIds: readonly number[],
  client?: PoolClient,
): Promise<EntryEntityLink[]> {
  if (entryIds.length === 0) return [];
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<{ entry_id: number; entity_id: string }>(
    exec,
    `SELECT entry_id, entity_id FROM memory_entry_entities
      WHERE entry_id = ANY($1::int[])
      ORDER BY entry_id ASC, mention_count DESC, created_at ASC`,
    [entryIds],
  );
  return rows.map((r) => ({ entryId: r.entry_id, entityId: r.entity_id }));
}

/** One neighbor-entry reference from a batch lookup (carries the via-entity name). */
export interface EntityEntryRef {
  /** knowledge_entries.id (SERIAL) — guaranteed `status='active'` by the JOIN. */
  entryId: number;
  /** memory_entities.id (UUID) the entry was reached through. */
  entityId: string;
  /**
   * Display name of that entity — the `via_graph(entity)` marker source. Joined
   * here so the expansion needs no extra per-entity name lookup (zero N+1).
   */
  entityName: string;
}

/**
 * ACTIVE entries mentioning any of a BATCH of entities (S8 expansion step 3:
 * neighbor entities → their lessons). JOINs `knowledge_entries` on
 * `status='active'` so superseded/invalidated lessons never surface through the
 * graph (links themselves survive supersede as historical records — this filter
 * is what keeps them harmless). `limit` bounds pathological fan-out; a
 * non-positive / non-finite limit returns [].
 */
export async function listEntryIdsForEntities(
  entityIds: readonly string[],
  limit: number,
  client?: PoolClient,
): Promise<EntityEntryRef[]> {
  if (entityIds.length === 0) return [];
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<{ entry_id: number; entity_id: string; entity_name: string }>(
    exec,
    `SELECT mee.entry_id, mee.entity_id, me.name AS entity_name
       FROM memory_entry_entities mee
       JOIN knowledge_entries ke ON ke.id = mee.entry_id AND ke.status = 'active'
       JOIN memory_entities me ON me.id = mee.entity_id
      WHERE mee.entity_id = ANY($1::uuid[])
      ORDER BY mee.mention_count DESC, mee.created_at ASC
      LIMIT $2`,
    [entityIds, Math.floor(limit)],
  );
  return rows.map((r) => ({
    entryId: r.entry_id,
    entityId: r.entity_id,
    entityName: r.entity_name,
  }));
}
