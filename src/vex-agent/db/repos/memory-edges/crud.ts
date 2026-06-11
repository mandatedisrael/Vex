/**
 * memory_edges CRUD — upsert / get / invalidate / supersede / list (S1d). The
 * graph SUBSTRATE only: S8 decides WHEN to assert/retract/supersede a relation;
 * this module is the race-safe HOW.
 *
 * FULL bi-temporal (Q1): an edge is NEVER deleted. "Active / currently believed"
 * = `invalidated_at IS NULL`. Invalidated temporal versions COEXIST with the
 * fresh active edge for the same `(source, target, relation)` — they fall out of
 * the partial unique `uniq_med_active_relation WHERE invalidated_at IS NULL`.
 *
 * Three write primitives with distinct jobs:
 *   - `upsertEdge`     — insert a NEW relation (or no-op return the active edge);
 *                        xmax upsert on the active-relation arbiter.
 *   - `invalidateEdge` — plain retraction (no successor); precondition-guarded.
 *   - `supersedeEdge`  — ATOMIC replace (D9): the active partial-unique forbids a
 *                        second active edge for the same triple, so a naive
 *                        upsert(new)+invalidate(old) is unimplementable — the new
 *                        insert collides with the still-active old. One
 *                        transaction locks the old FOR UPDATE, invalidates it,
 *                        inserts the new active edge, and back-points
 *                        superseded_by_edge_id. The bi-temporal boundary is
 *                        CONTINUOUS (R2): one `replacementValidFrom :=
 *                        COALESCE($newValidFrom, NOW())` is reused for BOTH old
 *                        valid_until and the explicit new valid_from.
 *
 * Embedding contract: the FACT embedding is OPTIONAL, an all-or-none triplet.
 * When present, `factEmbedding.length === embeddingDim` is checked before SQL.
 *
 * Observability: `memLog` (memory/observability/logger.ts), area `edge`. Only
 * allowlisted, structurally-safe meta — NEVER raw fact text.
 */

import type { PoolClient } from "pg";

import {
  executeWith,
  getPool,
  queryOneWith,
  queryWith,
  withTransaction,
  type Executor,
} from "../../client.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import {
  EDGE_COLUMNS,
  mapRow,
  toIsoOrNull,
  vectorLiteral,
  type MemoryEdge,
  type MemoryEdgeRow,
  type MemoryEdgeRowWithInsertFlag,
  type UpsertEdgeInput,
  type UpsertEdgeResult,
} from "./types.js";

/** Run `fn` on the provided tx client, or open a fresh transaction. */
async function inTransaction<T>(
  client: PoolClient | undefined,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  return client ? fn(client) : withTransaction(fn);
}

/**
 * Fail-fast if a fact embedding is present but its length does not match
 * `embeddingDim` (mirrors the candidate / entity precheck so the DB CHECK never
 * has to reject the row). A null embedding is a valid (no-vector) edge.
 */
function assertEdgeEmbeddingCoherent(input: UpsertEdgeInput): void {
  if (input.factEmbedding === null) return;
  if (input.embeddingDim === null || input.factEmbedding.length !== input.embeddingDim) {
    throw new Error(
      `upsertEdge: fact embedding length ${input.factEmbedding.length} does not match embeddingDim ${input.embeddingDim} ` +
        `(relation=${input.relation}). The DB CHECK constraint would reject this.`,
    );
  }
}

// ── Upsert (concurrency-safe by active relation) ─────────────────

/**
 * Upsert a NEW relation, idempotent on the active triple `(source, target,
 * relation)` while `invalidated_at IS NULL`. The partial unique index
 * `uniq_med_active_relation` is the ON CONFLICT arbiter; a no-op
 * `DO UPDATE SET updated_at = memory_edges.updated_at` returns the row on BOTH
 * paths and `(xmax = 0)` distinguishes insert from conflict. To REPLACE an
 * active edge with a new active one for the SAME triple use `supersedeEdge` —
 * this would simply return the still-active old edge.
 */
export async function upsertEdge(
  input: UpsertEdgeInput,
  client?: PoolClient,
): Promise<UpsertEdgeResult> {
  assertEdgeEmbeddingCoherent(input);

  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEdgeRowWithInsertFlag>(
    exec,
    `INSERT INTO memory_edges (
       source_entity_id, target_entity_id, relation, fact,
       fact_embedding, embedding_model, embedding_dim, origin_entry_id, valid_from
     )
     VALUES (
       $1, $2, $3, $4,
       $5::vector, $6, $7, $8, COALESCE($9::timestamptz, NOW())
     )
     ON CONFLICT (source_entity_id, target_entity_id, relation) WHERE invalidated_at IS NULL
     DO UPDATE SET updated_at = memory_edges.updated_at
     RETURNING *, (xmax = 0) AS inserted`,
    [
      input.sourceEntityId,
      input.targetEntityId,
      input.relation,
      input.fact,
      input.factEmbedding === null ? null : vectorLiteral(input.factEmbedding),
      input.embeddingModel,
      input.embeddingDim,
      input.originEntryId,
      toIsoOrNull(input.validFrom),
    ],
  );
  if (!row) {
    throw new Error(`upsertEdge: upsert returned no row (relation=${input.relation}).`);
  }
  const { inserted, ...rest } = row;
  const edge = mapRow(rest);
  memLog("edge", "upserted", {
    edgeId: edge.id,
    relation: edge.relation,
    insertResult: inserted ? "inserted" : "duplicate",
  });
  return { edge, inserted };
}

// ── Get by id ────────────────────────────────────────────────────

export async function getEdgeById(
  id: string,
  client?: PoolClient,
): Promise<MemoryEdge | null> {
  if (!id) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEdgeRow>(
    exec,
    `SELECT ${EDGE_COLUMNS} FROM memory_edges WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

// ── Invalidate (precondition-guarded; no successor) ──────────────

export interface InvalidateEdgePatch {
  /** World-time close; defaults to NOW() at the DB if omitted. */
  validUntil?: Date | null;
  /** Optional explicit successor pointer (med_superseded_implies_invalidated CHECK passes — we also set invalidated_at). */
  supersededByEdgeId?: string | null;
}

export type InvalidateEdgeResult =
  | { ok: true; edge: MemoryEdge }
  | { ok: false; reason: "not_found" | "already_invalidated" };

/**
 * Retract an edge with no successor — set `invalidated_at` (system time) and
 * close `valid_until` (world time). Precondition-guarded single statement: only
 * an edge with `invalidated_at IS NULL` transitions, so re-invalidation is a
 * no-op. A zero-row update is disambiguated by a follow-up existence check.
 */
export async function invalidateEdge(
  id: string,
  patch: InvalidateEdgePatch = {},
  client?: PoolClient,
): Promise<InvalidateEdgeResult> {
  if (!id) return { ok: false, reason: "not_found" };
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryEdgeRow>(
    exec,
    `UPDATE memory_edges
        SET invalidated_at = NOW(),
            valid_until = COALESCE($2::timestamptz, valid_until),
            superseded_by_edge_id = $3,
            updated_at = NOW()
      WHERE id = $1 AND invalidated_at IS NULL
      RETURNING ${EDGE_COLUMNS}`,
    [id, toIsoOrNull(patch.validUntil), patch.supersededByEdgeId ?? null],
  );
  if (row) {
    const edge = mapRow(row);
    memLog("edge", "invalidated", { edgeId: edge.id });
    return { ok: true, edge };
  }
  const existing = await queryOneWith<{ invalidated_at: string | null }>(
    exec,
    "SELECT invalidated_at FROM memory_edges WHERE id = $1",
    [id],
  );
  if (!existing) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "already_invalidated" };
}

// ── Supersede (ATOMIC replace — D9 / R1 / R2) ────────────────────

export type SupersedeEdgeResult =
  | { ok: true; superseded: MemoryEdge; replacement: MemoryEdge }
  | { ok: false; reason: "not_found" | "already_invalidated" };

/**
 * Atomically replace the active edge `oldEdgeId` with a new active edge built
 * from `newInput`, for what is normally the SAME `(source, target, relation)`
 * triple. Required as a substrate primitive (D9) because the active
 * partial-unique forbids a second active edge for the triple — a plain
 * `upsertEdge(new)` would collide with the still-active old edge.
 *
 * One transaction, binding ONE boundary timestamp
 * `replacementValidFrom := COALESCE($newValidFrom, NOW())` reused everywhere:
 *   1. SELECT old FOR UPDATE WHERE id AND invalidated_at IS NULL — precondition
 *      lock; serializes concurrent supersedes (the loser sees it already
 *      invalidated → `already_invalidated`; a missing id → `not_found`).
 *   2. UPDATE old: invalidated_at = NOW(), valid_until = replacementValidFrom.
 *   3. INSERT the new active edge with EXPLICIT valid_from = replacementValidFrom
 *      (NOT the column default) — now allowed, the old left the active index.
 *   4. UPDATE old: superseded_by_edge_id = new.id.
 *
 * The bi-temporal boundary is CONTINUOUS (R2 — Graphiti `old.invalid_at ==
 * new.valid_at`): because `NOW()` is the stable transaction timestamp,
 * `old.valid_until === replacement.valid_from` whether or not a `validFrom` was
 * supplied. If a caller passes a `validFrom` earlier than the old edge's
 * `valid_from`, `med_valid_window` rejects the txn (incoherent timeline,
 * fail-loud).
 */
export async function supersedeEdge(
  oldEdgeId: string,
  newInput: UpsertEdgeInput,
  client?: PoolClient,
): Promise<SupersedeEdgeResult> {
  if (!oldEdgeId) return { ok: false, reason: "not_found" };
  assertEdgeEmbeddingCoherent(newInput);

  return inTransaction(client, async (tx): Promise<SupersedeEdgeResult> => {
    // (1) Lock the old edge if it is still active. FOR UPDATE serializes
    // concurrent supersedes — exactly one transaction proceeds.
    const locked = await tx.query<{ id: string }>(
      `SELECT id FROM memory_edges
        WHERE id = $1 AND invalidated_at IS NULL
        FOR UPDATE`,
      [oldEdgeId],
    );
    if (locked.rows.length === 0) {
      // Disambiguate not_found vs already_invalidated.
      const existing = await tx.query<{ invalidated_at: string | null }>(
        "SELECT invalidated_at FROM memory_edges WHERE id = $1",
        [oldEdgeId],
      );
      if (existing.rows.length === 0) return { ok: false, reason: "not_found" };
      return { ok: false, reason: "already_invalidated" };
    }

    // ONE boundary timestamp, reused for BOTH old.valid_until and new.valid_from
    // (R2 continuous boundary). NOW() is the stable txn timestamp.
    const replacementValidFrom = toIsoOrNull(newInput.validFrom);

    // (2) Invalidate the old edge and close its world-time interval at the
    // boundary — old leaves the active partial index so the insert below is legal.
    const supersededRow = await tx.query<MemoryEdgeRow>(
      `UPDATE memory_edges
          SET invalidated_at = NOW(),
              valid_until = COALESCE($2::timestamptz, NOW()),
              updated_at = NOW()
        WHERE id = $1
        RETURNING ${EDGE_COLUMNS}`,
      [oldEdgeId, replacementValidFrom],
    );
    const oldRow = supersededRow.rows[0];
    if (!oldRow) {
      throw new Error(`supersedeEdge: old edge vanished mid-transaction (id=${oldEdgeId}).`);
    }

    // (3) Insert the new active edge with an EXPLICIT valid_from at the boundary.
    const insertedRow = await tx.query<MemoryEdgeRow>(
      `INSERT INTO memory_edges (
         source_entity_id, target_entity_id, relation, fact,
         fact_embedding, embedding_model, embedding_dim, origin_entry_id, valid_from
       )
       VALUES (
         $1, $2, $3, $4,
         $5::vector, $6, $7, $8, COALESCE($9::timestamptz, NOW())
       )
       RETURNING ${EDGE_COLUMNS}`,
      [
        newInput.sourceEntityId,
        newInput.targetEntityId,
        newInput.relation,
        newInput.fact,
        newInput.factEmbedding === null ? null : vectorLiteral(newInput.factEmbedding),
        newInput.embeddingModel,
        newInput.embeddingDim,
        newInput.originEntryId,
        replacementValidFrom,
      ],
    );
    const newRow = insertedRow.rows[0];
    if (!newRow) {
      throw new Error(`supersedeEdge: replacement insert returned no row (old=${oldEdgeId}).`);
    }

    // (4) Back-point the old edge at its successor.
    const pointedRow = await tx.query<MemoryEdgeRow>(
      `UPDATE memory_edges
          SET superseded_by_edge_id = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING ${EDGE_COLUMNS}`,
      [oldEdgeId, newRow.id],
    );
    const superseded = mapRow(pointedRow.rows[0] ?? oldRow);
    const replacement = mapRow(newRow);

    // Supersession is invalidation-of-old + insert-of-new; emit the two §6
    // write-point events rather than a third event name.
    memLog("edge", "invalidated", { edgeId: superseded.id });
    memLog("edge", "upserted", {
      edgeId: replacement.id,
      relation: replacement.relation,
      insertResult: "inserted",
    });
    return { ok: true, superseded, replacement };
  });
}

// ── Reads (graph-expansion seeds for S3/S8) ──────────────────────

export interface DirectionalEdgeOptions {
  /** When true (default), only active edges (`invalidated_at IS NULL`). */
  activeOnly?: boolean;
}

/**
 * All ACTIVE edges touching `entityId` in EITHER direction — the graph-expansion
 * seed (1-hop neighborhood) for retrieval (S3) / the manager (S8).
 */
export async function listActiveEdgesForEntity(
  entityId: string,
  client?: PoolClient,
): Promise<MemoryEdge[]> {
  if (!entityId) return [];
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryEdgeRow>(
    exec,
    `SELECT ${EDGE_COLUMNS} FROM memory_edges
      WHERE (source_entity_id = $1 OR target_entity_id = $1)
        AND invalidated_at IS NULL
      ORDER BY valid_from DESC, id DESC`,
    [entityId],
  );
  return rows.map(mapRow);
}

/** Outgoing edges from `entityId` (source), active-only by default. */
export async function listEdgesFrom(
  entityId: string,
  options: DirectionalEdgeOptions = {},
  client?: PoolClient,
): Promise<MemoryEdge[]> {
  if (!entityId) return [];
  const activeOnly = options.activeOnly ?? true;
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryEdgeRow>(
    exec,
    `SELECT ${EDGE_COLUMNS} FROM memory_edges
      WHERE source_entity_id = $1
        ${activeOnly ? "AND invalidated_at IS NULL" : ""}
      ORDER BY valid_from DESC, id DESC`,
    [entityId],
  );
  return rows.map(mapRow);
}

/**
 * ACTIVE, valid-time edges touching ANY of a BATCH of entities, in EITHER
 * direction, capped PER ENTITY PER SIDE (S8 expansion step 2). One query:
 * `unnest` over the batch with two LATERAL probes (source side / target side),
 * each riding the matching partial index (`idx_med_source` / `idx_med_target`
 * — both predicated on `invalidated_at IS NULL`). Valid-time = the relation is
 * currently believed AND its world-time window covers now. An edge between two
 * batched entities appears once per touched endpoint — de-duplicated by id here
 * so callers never double-count.
 */
export async function listActiveEdgesForEntities(
  entityIds: readonly string[],
  limitPerSide: number,
  client?: PoolClient,
): Promise<MemoryEdge[]> {
  if (entityIds.length === 0) return [];
  if (!Number.isFinite(limitPerSide) || limitPerSide <= 0) return [];
  const exec: Executor = client ?? getPool();
  // The LATERAL subqueries project exactly EDGE_COLUMNS (never the raw
  // fact_embedding), so the outer `e.*` is the same bounded column set.
  const rows = await queryWith<MemoryEdgeRow>(
    exec,
    `SELECT DISTINCT ON (e.id) e.*
       FROM unnest($1::uuid[]) AS ent(id)
       JOIN LATERAL (
         (SELECT ${EDGE_COLUMNS} FROM memory_edges
           WHERE source_entity_id = ent.id
             AND invalidated_at IS NULL
             AND valid_from <= NOW()
             AND (valid_until IS NULL OR valid_until > NOW())
           ORDER BY valid_from DESC, id DESC
           LIMIT $2)
         UNION ALL
         (SELECT ${EDGE_COLUMNS} FROM memory_edges
           WHERE target_entity_id = ent.id
             AND invalidated_at IS NULL
             AND valid_from <= NOW()
             AND (valid_until IS NULL OR valid_until > NOW())
           ORDER BY valid_from DESC, id DESC
           LIMIT $2)
       ) e ON TRUE
      ORDER BY e.id`,
    [entityIds, Math.floor(limitPerSide)],
  );
  return rows.map(mapRow);
}

/**
 * Bulk system-time retraction of every ACTIVE edge a knowledge entry asserted
 * (S8 / D-SUPERSEDE-WIRING): edges are claims of their ORIGIN lesson — when the
 * lesson stops being current (supersede / reconcile-invalidate), its edges stop
 * being believed. Sets `invalidated_at` only (world-time `valid_until` is left
 * untouched, matching `invalidateEdge`'s no-patch default — we stop asserting
 * the relation, we do not claim the world changed). Idempotent: the
 * `invalidated_at IS NULL` guard makes a re-run a 0-row no-op. Returns the
 * number of edges retracted.
 *
 * D-EDGE-OWNERSHIP (conscious v1 tradeoff): the active-triple arbiter means an
 * edge may be "relied on" by other live lessons that re-asserted it — this bulk
 * retraction still invalidates it. Accepted: edges are a weak associative
 * signal, entry↔entity links survive, and the next promotion asserting the
 * relation re-creates it with a fresh origin.
 */
export async function invalidateEdgesForOrigin(
  entryId: number,
  client?: PoolClient,
): Promise<number> {
  if (!Number.isFinite(entryId) || entryId <= 0) return 0;
  const exec: Executor = client ?? getPool();
  const count = await executeWith(
    exec,
    `UPDATE memory_edges
        SET invalidated_at = NOW(), updated_at = NOW()
      WHERE origin_entry_id = $1 AND invalidated_at IS NULL`,
    [entryId],
  );
  if (count > 0) memLog("edge", "origin_invalidated", { entryId, count });
  return count;
}

/** Incoming edges to `entityId` (target), active-only by default. */
export async function listEdgesTo(
  entityId: string,
  options: DirectionalEdgeOptions = {},
  client?: PoolClient,
): Promise<MemoryEdge[]> {
  if (!entityId) return [];
  const activeOnly = options.activeOnly ?? true;
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryEdgeRow>(
    exec,
    `SELECT ${EDGE_COLUMNS} FROM memory_edges
      WHERE target_entity_id = $1
        ${activeOnly ? "AND invalidated_at IS NULL" : ""}
      ORDER BY valid_from DESC, id DESC`,
    [entityId],
  );
  return rows.map(mapRow);
}
