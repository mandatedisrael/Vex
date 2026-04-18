/**
 * Knowledge repo — CRUD core (insert, fetch, status update).
 *
 * Portability contract (also enforced in recall.ts):
 * - The vector column has NO typmod, so the type accepts any dim. Per-row
 *   `embedding_dim` and `embedding_model` are authoritative.
 * - `content_hash` is the UNIQUE idempotency key. `insertEntry` returns
 *   `{ entry, inserted }` so callers can distinguish a new write from a
 *   no-op duplicate. Metadata is NEVER silently merged on conflict — the
 *   existing row is returned untouched.
 *
 * Transaction coordination (PR4 Fase I.b):
 * - `insertEntry` accepts an optional `PoolClient`. When provided, the
 *   INSERT runs inside the caller's transaction instead of on the shared
 *   pool. `withLeaseSharedLock` (PR4 Fase II) uses this to run the write
 *   under the maintenance-lease SHARE lock so it coordinates cleanly with
 *   the reembed FOR UPDATE gate.
 * - Backward compatible: callers that don't pass a client keep the
 *   pre-PR4 behaviour (pool-backed single-query insert).
 */

import type { PoolClient } from "pg";
import {
  execute,
  getPool,
  queryOne,
  queryOneWith,
  type Executor,
} from "../../client.js";
import type { UpdatableKnowledgeStatus, KnowledgeStatus } from "@echo-agent/knowledge/policy.js";
import {
  type InsertEntryInput,
  type InsertEntryResult,
  type KnowledgeEntry,
  type KnowledgeEntryWithLineage,
  type KnowledgeRow,
  type KnowledgeRowWithInsertFlag,
  type UpdateStatusResult,
  mapRow,
  toIsoOrNull,
  vectorLiteral,
} from "./types.js";

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
export async function insertEntry(
  input: InsertEntryInput,
  client?: PoolClient,
): Promise<InsertEntryResult> {
  if (input.embedding.length !== input.embeddingDim) {
    throw new Error(
      `insertEntry: embedding length ${input.embedding.length} does not match embeddingDim ${input.embeddingDim} ` +
        `(content_hash=${input.contentHash}). The DB CHECK constraint would reject this.`,
    );
  }

  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<KnowledgeRowWithInsertFlag>(
    exec,
    `WITH ins AS (
       INSERT INTO knowledge_entries (
         kind, title, summary, content_md, tags, source_refs,
         confidence, status, pinned, valid_from, valid_until,
         content_hash, embedding_model, embedding_dim, embedding,
         source_surface, source_session,
         supersedes_id, status_reason, change_summary, what_failed,
         source_episode_id, source_episode_hash, promotion_version,
         created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, COALESCE($8::text, 'active'), $9, COALESCE($10::timestamptz, NOW()), $11,
         $12, $13, $14, $15::vector,
         COALESCE($16::text, 'echo_agent'), $17,
         $18, $19, $20, $21,
         $22, $23, COALESCE($24::int, 1),
         COALESCE($25::timestamptz, NOW()), COALESCE($26::timestamptz, NOW())
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
      input.sourceSurface ?? null,
      input.sourceSession ?? null,
      input.supersedesId ?? null,
      input.statusReason ?? null,
      input.changeSummary ?? null,
      input.whatFailed ?? null,
      input.sourceEpisodeId ?? null,
      input.sourceEpisodeHash ?? null,
      input.promotionVersion ?? null,
      toIsoOrNull(input.createdAt),
      toIsoOrNull(input.updatedAt),
    ],
  );
  if (!row) throw new Error("knowledge_entries upsert returned no row");
  const { inserted, ...rest } = row;
  return { entry: mapRow(rest as KnowledgeRow), inserted };
}

// ── Get by ID ────────────────────────────────────────────────────

/**
 * Fetch an entry by id together with the reverse lineage link (`supersededBy`).
 *
 * The reverse link is resolved via a LEFT JOIN on the partial unique index
 * `idx_ke_supersedes_id` — one extra indexed lookup, single round-trip. Returns
 * `supersededBy: null` when no successor exists (i.e. this row is current or
 * terminal — `active`, `invalidated`, `archived`, or a leaf of a superseded chain).
 */
export async function getById(id: number): Promise<KnowledgeEntryWithLineage | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await queryOne<KnowledgeRow & { superseded_by: number | null }>(
    `SELECT k.*, succ.id AS superseded_by
     FROM knowledge_entries k
     LEFT JOIN knowledge_entries succ ON succ.supersedes_id = k.id
     WHERE k.id = $1`,
    [id],
  );
  if (!row) return null;
  const { superseded_by, ...baseRow } = row;
  return { ...mapRow(baseRow as KnowledgeRow), supersededBy: superseded_by };
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

/**
 * Update an entry's status to `invalidated` or `archived` and optionally persist
 * a human-readable `reason` to `status_reason`. Guarded on `status = 'active'`
 * so that superseded / invalidated / archived rows cannot be re-stamped.
 *
 * Passing `reason = undefined` (the default) leaves the existing `status_reason`
 * untouched — callers that omit reason do NOT wipe a previously-stored reason.
 * Pass an explicit `null` to clear it.
 *
 * On zero-rows-affected, performs a single follow-up SELECT to distinguish
 * "entry does not exist" from "entry exists but is no longer active". Callers
 * (the tool handler) map this to user-facing failure messages.
 */
export async function updateStatus(
  id: number,
  status: UpdatableKnowledgeStatus,
  reason?: string | null,
): Promise<UpdateStatusResult> {
  if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: "not_found" };

  const rowCount = reason === undefined
    ? await execute(
        "UPDATE knowledge_entries SET status = $1, updated_at = NOW() WHERE id = $2 AND status = 'active'",
        [status, id],
      )
    : await execute(
        "UPDATE knowledge_entries SET status = $1, status_reason = $2, updated_at = NOW() WHERE id = $3 AND status = 'active'",
        [status, reason, id],
      );
  if (rowCount === 1) return { ok: true };

  // Disambiguate: either the row doesn't exist, or it exists with a non-active
  // status. One extra indexed lookup by primary key.
  const row = await queryOne<{ status: string }>(
    "SELECT status FROM knowledge_entries WHERE id = $1",
    [id],
  );
  if (!row) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "not_active", currentStatus: row.status as KnowledgeStatus };
}
