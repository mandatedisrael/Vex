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
import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";
import {
  CANDIDATE_COLUMNS,
  mapRecallRow,
  mapRow,
  parseVectorLiteral,
  toIsoOrNull,
  vectorLiteral,
  type CandidateStatus,
  type InsertCandidateInput,
  type InsertCandidateResult,
  type MemoryCandidate,
  type MemoryCandidateRecall,
  type MemoryCandidateRecallRow,
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

// ── Get embedding (write-only column; S4 promote reuse) ──────────

/**
 * The stored embedding of a candidate, or null if the candidate does not exist.
 *
 * The `embedding` column is WRITE-ONLY in the normal read path: `mapRow` ignores
 * it and `CANDIDATE_COLUMNS` deliberately omits it (siblings do the same — recall
 * runs its own vector SELECT). The S4 deterministic stage (D5/D6/D7 similarity)
 * and `promote()` need the raw vector — promote REUSES it (with `embeddingModel`
 * / `embeddingDim`) so the long-term entry is byte-identical to the candidate
 * (the embedding was computed AFTER redaction in S2; the redacted text is stable,
 * so re-embedding would be wasteful AND risk drift). The vector literal `[a,b,…]`
 * is parsed back into a `number[]`.
 */
export async function getCandidateEmbedding(
  id: string,
  client?: PoolClient,
): Promise<{ embedding: number[]; embeddingModel: string; embeddingDim: number } | null> {
  if (!id) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<{
    embedding: string;
    embedding_model: string;
    embedding_dim: number;
  }>(
    exec,
    `SELECT embedding::text AS embedding, embedding_model, embedding_dim
       FROM memory_candidates WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    embedding: parseVectorLiteral(row.embedding),
    embeddingModel: row.embedding_model,
    embeddingDim: row.embedding_dim,
  };
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

// ── Find by promoted knowledge id (S7 — the live outcome record) ─

/**
 * The PROMOTED candidate behind a knowledge entry — the entry's LIVE outcome
 * record (S5 doctrine: the candidate row keeps carrying the ledger-resolved
 * outcome after promotion; S7 reconcile re-derives + bumps it there). Returns
 * null when no promoted candidate points at the entry (e.g. an imported /
 * legacy lesson) — reconcile then no-ops. `ORDER BY updated_at DESC LIMIT 1`
 * picks the newest should multiple promoted rows ever share the target.
 */
export async function findCandidateByPromotedKnowledgeId(
  knowledgeId: number,
  client?: PoolClient,
): Promise<MemoryCandidate | null> {
  if (!Number.isFinite(knowledgeId) || knowledgeId <= 0) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryCandidateRow>(
    exec,
    `SELECT ${CANDIDATE_COLUMNS}
       FROM memory_candidates
      WHERE status = 'promoted' AND promoted_knowledge_id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [knowledgeId],
  );
  return row ? mapRow(row) : null;
}

// ── Wake mapping (S7 D-MAP — ledger anchors → active entries) ────

/**
 * One containment probe of the wake query: a single FIX-1 anchor key matched
 * against `evidence_refs` elements by JSONB containment (`@>`). Exactly one of
 * the fields is set per probe (the caller builds one probe per distinct key).
 */
export interface WakeAnchorProbe {
  executionId?: number;
  instrumentKey?: string;
  positionKey?: string;
}

/** A wake target: an ACTIVE knowledge entry + its current outcome_version. */
export interface WakeTarget {
  entryId: number;
  outcomeVersion: number;
}

/**
 * D-MAP (S7): map ledger wake keys to the ACTIVE knowledge entries whose
 * promoted candidates anchor them. ONE query: promoted candidates whose
 * `evidence_refs` contains ANY probe (`@>` OR-chain — BitmapOr on
 * `idx_mc_evidence_refs`), joined to their ACTIVE entries. The read-only JOIN
 * to knowledge_entries is intentional (recoverStaleRunning cross-table
 * precedent): the (entry, current outcome_version) pair is the reconcile job
 * key and must come from one consistent read. DISTINCT — many candidates /
 * probes may hit the same entry, but one wake enqueues one job per entry.
 */
export async function findPromotedWakeTargets(
  probes: readonly WakeAnchorProbe[],
  client?: PoolClient,
): Promise<WakeTarget[]> {
  if (probes.length === 0) return [];
  const exec: Executor = client ?? getPool();
  const clauses = probes.map((_, i) => `mc.evidence_refs @> $${i + 1}::jsonb`);
  const params = probes.map((probe) => jsonb([probe]));
  const rows = await queryWith<{ entry_id: number; outcome_version: number }>(
    exec,
    `SELECT DISTINCT ke.id AS entry_id, ke.outcome_version
       FROM memory_candidates mc
       JOIN knowledge_entries ke ON ke.id = mc.promoted_knowledge_id
      WHERE mc.status = 'promoted'
        AND mc.promoted_knowledge_id IS NOT NULL
        AND ke.status = 'active'
        AND (${clauses.join(" OR ")})`,
    params,
  );
  return rows.map((r) => ({ entryId: r.entry_id, outcomeVersion: r.outcome_version }));
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

// ── Outcome write (S5 — ledger-grounded outcome + as-of boundary) ─

/**
 * Result of `updateCandidateOutcome`. Mirrors `updateCandidateStatus`: the
 * write only applies while the candidate is still `pending` (the optimistic
 * precondition), so it can never overwrite a candidate another worker already
 * terminalized. `ok` on the write; `precondition_failed` when the row is no
 * longer pending; `not_found` when the row is gone.
 */
export type UpdateCandidateOutcomeResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "precondition_failed"; currentStatus: CandidateStatus };

/**
 * Persist the S5 ledger-resolved outcome + the as-of decision boundary on a
 * candidate (S5 §8 step 1). Runs inside S4's `applyDecisionAtomically` tx BEFORE
 * promote — the owner-check there already locks the item+job `FOR UPDATE OF i,j`,
 * so this write is consistent with the decision. Guarded on `status='pending'`
 * (same precondition as `updateCandidateStatus`): a candidate that raced to a
 * terminal state is NOT mutated. The outcome is a Zod-validated
 * `MemoryOutcomeSummary` (validated by the caller); `availableAtDecisionTime`
 * may be null when the boundary is undeterminable (point-in-time degrades, never
 * rejects).
 */
export async function updateCandidateOutcome(
  id: string,
  outcome: MemoryOutcomeSummary,
  availableAtDecisionTime: Date | null,
  client?: PoolClient,
): Promise<UpdateCandidateOutcomeResult> {
  if (!id) return { ok: false, reason: "not_found" };

  const exec: Executor = client ?? getPool();
  const updated = await queryOneWith<{ id: string }>(
    exec,
    `UPDATE memory_candidates
       SET outcome = $2::jsonb,
           available_at_decision_time = $3::timestamptz,
           updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING id`,
    [id, jsonb(outcome), toIsoOrNull(availableAtDecisionTime)],
  );

  if (updated) {
    memLog("candidate", "outcome_resolved", {
      candidateId: id,
      outcomeStatus: outcome.status,
      lessonSignal: outcome.lessonSignal,
      evidenceQuality: outcome.evidenceQuality,
      pointInTimeChecked: outcome.pointInTimeChecked ? "true" : "false",
      ...(outcome.productType ? { productType: outcome.productType } : {}),
      outcomeVersion: outcome.outcomeVersion,
    });
    return { ok: true };
  }

  // Zero rows — disambiguate not_found vs precondition_failed (mirrors status setter).
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

// ── Reconciled outcome write (S7 — the promoted candidate is the live record) ─

/**
 * Persist a RE-DERIVED outcome on a PROMOTED candidate (S7 §4.5). The S5 setter
 * (`updateCandidateOutcome`) guards `status='pending'` — correct at
 * consolidation, structurally wrong for reconcile, which by definition touches
 * a candidate that already promoted. This setter guards
 * `status='promoted' AND promoted_knowledge_id=$entry` instead: only the live
 * outcome record of THAT entry can be rewritten, never a pending/terminal row
 * and never a candidate re-pointed at another entry. Runs inside the reconcile
 * tx (the entry row is already FOR UPDATE-locked); the caller passes a
 * Zod-validated `MemoryOutcomeSummary` carrying `outcomeVersion: v+1` +
 * `outcomeLastChangedAt`.
 */
export async function updateReconciledCandidateOutcome(
  id: string,
  knowledgeId: number,
  outcome: MemoryOutcomeSummary,
  client?: PoolClient,
): Promise<UpdateCandidateOutcomeResult> {
  if (!id) return { ok: false, reason: "not_found" };

  const exec: Executor = client ?? getPool();
  const updated = await queryOneWith<{ id: string }>(
    exec,
    `UPDATE memory_candidates
       SET outcome = $3::jsonb,
           updated_at = NOW()
     WHERE id = $1 AND status = 'promoted' AND promoted_knowledge_id = $2
     RETURNING id`,
    [id, knowledgeId, jsonb(outcome)],
  );

  if (updated) {
    memLog("candidate", "outcome_reconciled", {
      candidateId: id,
      promotedKnowledgeId: knowledgeId,
      outcomeStatus: outcome.status,
      lessonSignal: outcome.lessonSignal,
      evidenceQuality: outcome.evidenceQuality,
      outcomeVersion: outcome.outcomeVersion,
    });
    return { ok: true };
  }

  // Zero rows — disambiguate not_found vs precondition_failed (mirrors the S5 setter).
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

// ── Dual-trace vector recall (S3) ────────────────────────────────

/**
 * Filters for `recallCandidatesTopK`. The model/dim pair is MANDATORY — the
 * vector column has no typmod, so running `<=>` across a different-dim model
 * crashes pgvector, and comparing similarities across model spaces is
 * meaningless (mirrors the knowledge recall contract).
 */
export interface CandidateRecallFilters {
  /** Required — current embedding model identifier. Recall ONLY returns rows produced by this model. */
  embeddingModel: string;
  /** Required — current embedding dim. Recall ONLY returns matching-dim rows (mixed-dim crash protection). */
  embeddingDim: number;
}

/**
 * Top-K cosine recall over fresh `memory_candidates` for the dual-trace read
 * path (S3, §2-step-4). Predicate: `status IN ('pending','retained')` AND
 * `retrieval_visibility='not_consolidated'` AND non-expired
 * (`retrieval_until IS NULL OR retrieval_until > now()`) AND a matching
 * `embedding_model` / `embedding_dim`. `retained` is a S4 dual-trace state — a
 * generalization the judge held back at recurrence n<2 (D-REC): it stays
 * RECALLABLE (a "premature holding pen" that is not lost) while a single-anchor
 * fact never promotes as a generalization. Suppressed, expired, and the OTHER
 * terminal states (promoted/rejected/superseded/merged/expired) are EXCLUDED.
 * Ordered by cosine `<=>`; fetches `k * 2` raw rows (same headroom as the
 * knowledge recall) so the caller can rerank + cap. No migration — uses
 * `idx_mc_embedding_match`.
 */
export async function recallCandidatesTopK(
  queryEmbedding: readonly number[],
  filters: CandidateRecallFilters,
  k: number,
  client?: PoolClient,
): Promise<MemoryCandidateRecall[]> {
  if (!Number.isFinite(k) || k <= 0) return [];
  if (queryEmbedding.length !== filters.embeddingDim) {
    throw new Error(
      `recallCandidatesTopK: query embedding length ${queryEmbedding.length} does not match filter dim ${filters.embeddingDim}`,
    );
  }

  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryCandidateRecallRow>(
    exec,
    `SELECT
       id, kind, title, summary, content_md, tags, evidence_refs, source,
       retrieval_until,
       (embedding <=> $1::vector) AS cosine_distance
     FROM memory_candidates
     WHERE status IN ('pending', 'retained')
       AND retrieval_visibility = 'not_consolidated'
       AND (retrieval_until IS NULL OR retrieval_until > now())
       AND embedding_model = $2
       AND embedding_dim = $3
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [vectorLiteral(queryEmbedding), filters.embeddingModel, filters.embeddingDim, Math.floor(k) * 2],
  );

  return rows.map(mapRecallRow);
}
