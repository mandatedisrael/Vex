/**
 * memory_candidates repo — CRUD core (insert, fetch, status transition, list).
 *
 * The agent PROPOSES candidates here (S2); the async memory_manager (S4) DECIDES
 * the terminal state. This module is the storage substrate only.
 *
 * Portability / embedding contract (mirrors knowledge / session-memories):
 * - The vector column has NO typmod; per-row `embedding_dim` / `embedding_model`
 *   are authoritative. `embedding.length === embeddingDim` is checked before SQL
 *   so the CHECK constraint never has to reject the row.
 * - `content_hash` is the dedupe key. `insertCandidate` is a concurrency-safe
 *   upsert keyed on the partial unique index `uniq_mc_pending_hash` (one live
 *   pending candidate per hash) and returns `{ candidate, inserted }`.
 *
 * Observability: `memLog` (memory/observability/logger.ts) is wired here — this
 * repo is the first real consumer of the S0 logger primitive. Only allowlisted,
 * structurally-safe meta is logged; NEVER raw title/summary/content/secrets.
 */

import type { PoolClient } from "pg";

import { getPool, queryOneWith, queryWith, type Executor } from "../../client.js";
import { jsonb } from "../../params.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import {
  CANDIDATE_COLUMNS,
  mapRow,
  toIsoOrNull,
  vectorLiteral,
  type CandidateStatus,
  type InsertCandidateInput,
  type InsertCandidateResult,
  type MemoryCandidate,
  type MemoryCandidateRow,
  type MemoryCandidateRowWithInsertFlag,
} from "./types.js";

// ── Insert (concurrency-safe upsert by content_hash) ─────────────

/**
 * Insert a candidate, idempotent on `content_hash` while it is `pending`.
 *
 * MF1 — concurrency-safe upsert (NOT a racy `DO NOTHING + CTE UNION`): the
 * partial unique index `uniq_mc_pending_hash` is the ON CONFLICT arbiter, and a
 * no-op `DO UPDATE SET updated_at = memory_candidates.updated_at` reliably
 * returns the row on BOTH the insert and the conflict path. Postgres'
 * `(xmax = 0)` system-column signal distinguishes a fresh insert
 * (`inserted = true`) from a conflict-merged row (`inserted = false`) without a
 * fallback SELECT race. Proven in `session-memories/create.ts` (audit P2.2).
 *
 * Note: the partial index only covers `pending` rows, so this dedupes against a
 * live pending candidate. Full loop-prevention against already
 * promoted/rejected hashes is an S2 application check (out of scope here).
 */
export async function insertCandidate(
  input: InsertCandidateInput,
  client?: PoolClient,
): Promise<InsertCandidateResult> {
  if (input.embedding.length !== input.embeddingDim) {
    throw new Error(
      `insertCandidate: embedding length ${input.embedding.length} does not match embeddingDim ${input.embeddingDim} ` +
        `(content_hash=${input.contentHash}). The DB CHECK constraint would reject this.`,
    );
  }

  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryCandidateRowWithInsertFlag>(
    exec,
    `INSERT INTO memory_candidates (
       session_id, proposed_by, kind, title, summary, content_md,
       entities, tags, source_refs, evidence_refs,
       source, confidence, importance,
       sensitivity, evidence_strength, retrieval_visibility,
       retrieval_until, retain_until,
       embedding, embedding_model, embedding_dim, content_hash,
       event_time, observed_at, available_at_decision_time
     )
     VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9::jsonb, $10::jsonb,
       $11, $12, $13,
       $14, $15, $16,
       $17::timestamptz, $18::timestamptz,
       $19::vector, $20, $21, $22,
       $23::timestamptz, $24::timestamptz, $25::timestamptz
     )
     ON CONFLICT (content_hash) WHERE status = 'pending'
     DO UPDATE SET updated_at = memory_candidates.updated_at
     RETURNING *, (xmax = 0) AS inserted`,
    [
      input.sessionId,
      input.proposedBy,
      input.kind,
      input.title,
      input.summary,
      input.contentMd,
      input.entities,
      input.tags,
      jsonb(input.sourceRefs),
      jsonb(input.evidenceRefs),
      input.source,
      input.confidence,
      input.importance,
      input.sensitivity,
      input.evidenceStrength,
      input.retrievalVisibility,
      toIsoOrNull(input.retrievalUntil),
      toIsoOrNull(input.retainUntil),
      vectorLiteral(input.embedding),
      input.embeddingModel,
      input.embeddingDim,
      input.contentHash,
      toIsoOrNull(input.eventTime),
      toIsoOrNull(input.observedAt),
      toIsoOrNull(input.availableAtDecisionTime),
    ],
  );
  if (!row) {
    throw new Error(
      `insertCandidate: upsert returned no row (content_hash=${input.contentHash}).`,
    );
  }
  const { inserted, ...rest } = row;
  const candidate = mapRow(rest);

  memLog("candidate", "inserted", {
    candidateId: candidate.id,
    sessionId: candidate.sessionId,
    kind: candidate.kind,
    status: candidate.status,
    embeddingModel: candidate.embeddingModel,
    embeddingDim: candidate.embeddingDim,
    count: input.evidenceRefs.length,
    insertResult: inserted ? "inserted" : "duplicate",
  });

  return { candidate, inserted };
}

// ── Get by id ────────────────────────────────────────────────────

export async function getCandidateById(
  id: string,
  client?: PoolClient,
): Promise<MemoryCandidate | null> {
  if (!id) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryCandidateRow>(
    exec,
    `SELECT ${CANDIDATE_COLUMNS} FROM memory_candidates WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

// ── Find latest by content hash (loop-prevention beyond pending) ─

/**
 * Most recent candidate row for `contentHash`, in ANY status, or null.
 *
 * The S2 suggest boundary uses this for loop-prevention BEYOND the live pending
 * row: the partial unique index `uniq_mc_pending_hash` only dedupes against a
 * `pending` candidate, so a hash that already reached a TERMINAL status
 * (promoted / rejected / superseded / merged / expired / retained) would
 * otherwise be re-staged on every suggest. The boundary checks
 * `status !== 'pending'` on this result to short-circuit a terminal duplicate;
 * a `pending` match is left to `insertCandidate`'s upsert. `ORDER BY recorded_at
 * DESC LIMIT 1` returns the newest row when multiple share the hash across
 * lifecycles.
 */
export async function findLatestCandidateByContentHash(
  contentHash: string,
  client?: PoolClient,
): Promise<MemoryCandidate | null> {
  if (!contentHash) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryCandidateRow>(
    exec,
    `SELECT ${CANDIDATE_COLUMNS}
       FROM memory_candidates
      WHERE content_hash = $1
      ORDER BY recorded_at DESC
      LIMIT 1`,
    [contentHash],
  );
  return row ? mapRow(row) : null;
}

// ── Status transition (precondition-checked) ─────────────────────

/**
 * Patch payload for a candidate status transition. `expectedFromStatus` is the
 * optimistic-concurrency precondition — the transition only applies if the row
 * is currently in that status, so two managers cannot both terminalize the same
 * candidate. `promotedKnowledgeId` is REQUIRED when (and only when) transitioning
 * to `promoted`; it records the `knowledge_entries.id` the candidate became.
 */
export interface UpdateCandidateStatusPatch {
  expectedFromStatus: CandidateStatus;
  promotedKnowledgeId?: number;
}

export type UpdateCandidateStatusResult =
  | { ok: true; candidate: MemoryCandidate }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "precondition_failed"; currentStatus: CandidateStatus };

/**
 * Transition a candidate's status, guarded on `expectedFromStatus`. Sets
 * `promoted_knowledge_id` when `toStatus === 'promoted'` and always bumps
 * `updated_at`. Returns the updated domain row on success; on a zero-row update
 * a single follow-up SELECT disambiguates `not_found` from `precondition_failed`
 * (the row exists but is no longer in `expectedFromStatus`).
 */
export async function updateCandidateStatus(
  id: string,
  toStatus: CandidateStatus,
  patch: UpdateCandidateStatusPatch,
  client?: PoolClient,
): Promise<UpdateCandidateStatusResult> {
  if (!id) return { ok: false, reason: "not_found" };
  if (toStatus === "promoted" && patch.promotedKnowledgeId === undefined) {
    throw new Error(
      "updateCandidateStatus: promotedKnowledgeId is required when toStatus='promoted'.",
    );
  }

  const exec: Executor = client ?? getPool();
  const row =
    toStatus === "promoted"
      ? await queryOneWith<MemoryCandidateRow>(
          exec,
          `UPDATE memory_candidates
             SET status = $2, promoted_knowledge_id = $4, updated_at = NOW()
           WHERE id = $1 AND status = $3
           RETURNING ${CANDIDATE_COLUMNS}`,
          [id, toStatus, patch.expectedFromStatus, patch.promotedKnowledgeId],
        )
      : await queryOneWith<MemoryCandidateRow>(
          exec,
          `UPDATE memory_candidates
             SET status = $2, updated_at = NOW()
           WHERE id = $1 AND status = $3
           RETURNING ${CANDIDATE_COLUMNS}`,
          [id, toStatus, patch.expectedFromStatus],
        );

  if (row) {
    const candidate = mapRow(row);
    memLog("candidate", "status_changed", {
      candidateId: candidate.id,
      statusFrom: patch.expectedFromStatus,
      statusTo: toStatus,
      ...(patch.promotedKnowledgeId !== undefined
        ? { promotedKnowledgeId: patch.promotedKnowledgeId }
        : {}),
    });
    return { ok: true, candidate };
  }

  // Zero rows updated — disambiguate not_found vs precondition_failed.
  const current = await queryOneWith<{ status: string }>(
    exec,
    "SELECT status FROM memory_candidates WHERE id = $1",
    [id],
  );
  if (!current) return { ok: false, reason: "not_found" };
  return {
    ok: false,
    reason: "precondition_failed",
    currentStatus: current.status as CandidateStatus,
  };
}

// ── List by status (worker polling seed + inspection) ────────────

/**
 * List candidates in a given status, oldest `recorded_at` first (FIFO — the
 * order the worker should consume). Uses `idx_mc_status_recorded`. `limit` is
 * required; a non-positive / non-finite limit returns an empty list.
 */
export async function listCandidatesByStatus(
  status: CandidateStatus,
  limit: number,
  client?: PoolClient,
): Promise<MemoryCandidate[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryCandidateRow>(
    exec,
    `SELECT ${CANDIDATE_COLUMNS}
       FROM memory_candidates
      WHERE status = $1
      ORDER BY recorded_at ASC
      LIMIT $2`,
    [status, Math.floor(limit)],
  );
  return rows.map(mapRow);
}
