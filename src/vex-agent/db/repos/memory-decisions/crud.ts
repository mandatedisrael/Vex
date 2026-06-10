/**
 * memory_decisions CRUD — append-only decision audit + idempotent recordDecision.
 *
 * recordDecision (S1c spec §5):
 *   - Append-only INSERT; the repo computes `decision_hash` (MF5) from the
 *     semantic payload.
 *   - Idempotent on `uniq_md_candidate_version` (candidate decisions) or
 *     `uniq_md_reconcile` (reconcile decisions) via the xmax upsert (a no-op
 *     `DO UPDATE` returns the existing row; `xmax = 0` distinguishes a fresh
 *     insert from a conflict — memory-candidates precedent).
 *   - On conflict: return the existing row with `inserted=false` ONLY when its
 *     stored `decision_hash` equals the recomputed one; a DIFFERENT hash for the
 *     same version is an `idempotency_conflict` (never a silent duplicate).
 *
 * The append-only log is durable: the identity refs (candidate_id /
 * reconcile_entry_id / job_id) are non-FK anchors (R2-MF1), so a candidate /
 * session cascade-delete never removes a decision row.
 */

import type { PoolClient } from "pg";

import {
  getPool,
  queryOneWith,
  queryWith,
  withTransaction,
  type Executor,
} from "../../client.js";
import { jsonb } from "../../params.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import type { EvidenceRefs } from "@vex-agent/memory/schema/memory-candidate.js";
import {
  recordDecisionInputSchema,
  type ParsedDecisionInput,
  type RecordDecisionInput,
} from "@vex-agent/memory/schema/memory-decision.js";
import { computeDecisionHash } from "./decision-hash.js";
import {
  DECISION_COLUMNS,
  mapRow,
  type MemoryDecision,
  type MemoryDecisionRow,
  type MemoryDecisionRowWithInsertFlag,
  type MemoryDecisionType,
} from "./types.js";

export type RecordDecisionResult =
  | { ok: true; decision: MemoryDecision; inserted: boolean }
  | { ok: false; reason: "idempotency_conflict"; existing: MemoryDecision }
  | { ok: false; reason: "anchor_incoherent" };

/** Run `fn` on the provided tx client, or open a fresh transaction. */
async function inTransaction<T>(
  client: PoolClient | undefined,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  return client ? fn(client) : withTransaction(fn);
}

/**
 * Write-time anchor coherence (the identity refs are non-FK anchors, R2-MF1, so
 * the repo owns referential validity). A candidate decision is legitimate only
 * if the deciding job is `running` and ACTIVELY holds the candidate (a
 * reserved|processing memory_job_items row for (jobId, candidateId)); a reconcile
 * decision only if `jobId` IS the matching `running` reconcile job for
 * (reconcileEntryId, outcomeVersion).
 *
 * The rows it relies on are `FOR UPDATE`-LOCKED so a concurrent
 * `recoverStaleRunning` cannot release the item / reset the job between this
 * check and the upsert (the check + insert run in the same recordDecision txn).
 * Returns true iff coherent. (S4 hardening: the worker may additionally
 * owner-check `locked_by` before calling — out of scope for the substrate.)
 */
async function anchorsCoherent(
  tx: PoolClient,
  input: ParsedDecisionInput,
): Promise<boolean> {
  if (input.decisionType === "reconcile") {
    // S7: a reconcile decision is stamped with the outcome_version it PRODUCED
    // (v+1 — matching the post-bump entry + candidate audit surfaces), while the
    // deciding job is keyed by the version it CONSUMED (v) — hence the `- 1`.
    const res = await tx.query(
      `SELECT 1 FROM memory_jobs
        WHERE id = $1 AND job_kind = 'reconcile' AND status = 'running'
          AND reconcile_entry_id = $2 AND reconcile_outcome_version = $3 - 1
        FOR UPDATE`,
      [input.jobId, input.reconcileEntryId, input.outcomeVersion],
    );
    return res.rows.length === 1;
  }
  const res = await tx.query(
    `SELECT 1
       FROM memory_job_items i
       JOIN memory_jobs j ON j.id = i.job_id
      WHERE i.job_id = $1 AND i.candidate_id = $2
        AND i.item_status IN ('reserved', 'processing')
        AND j.status = 'running'
      FOR UPDATE OF i, j`,
    [input.jobId, input.candidateId],
  );
  return res.rows.length === 1;
}

/** Fully-resolved row values for the decision upsert (one shape for both anchors). */
interface DecisionInsertValues {
  candidateId: string | null;
  reconcileEntryId: number | null;
  jobId: number;
  decisionVersion: number;
  decisionType: string;
  decisionHash: string;
  rejectReason: string | null;
  promotedKnowledgeId: number | null;
  supersedesKnowledgeId: number | null;
  mergeTargetKnowledgeId: number | null;
  outcomeVersion: number | null;
  evidenceRefs: EvidenceRefs;
  inferenceProvider: string | null;
  inferenceModel: string | null;
  costUsd: number | null;
  decidedBy: string;
}

async function upsertDecision(
  exec: Executor,
  vals: DecisionInsertValues,
  conflictTarget: string,
): Promise<MemoryDecisionRowWithInsertFlag | null> {
  return queryOneWith<MemoryDecisionRowWithInsertFlag>(
    exec,
    `INSERT INTO memory_decisions (
       candidate_id, reconcile_entry_id, job_id,
       decision_version, decision_type, decision_hash, reject_reason,
       promoted_knowledge_id, supersedes_knowledge_id, merge_target_knowledge_id,
       outcome_version, evidence_refs,
       inference_provider, inference_model, cost_usd, decided_by
     )
     VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9, $10,
       $11, $12::jsonb,
       $13, $14, $15, $16
     )
     ON CONFLICT ${conflictTarget}
     DO UPDATE SET created_at = memory_decisions.created_at
     RETURNING ${DECISION_COLUMNS}, (xmax = 0) AS inserted`,
    [
      vals.candidateId,
      vals.reconcileEntryId,
      vals.jobId,
      vals.decisionVersion,
      vals.decisionType,
      vals.decisionHash,
      vals.rejectReason,
      vals.promotedKnowledgeId,
      vals.supersedesKnowledgeId,
      vals.mergeTargetKnowledgeId,
      vals.outcomeVersion,
      jsonb(vals.evidenceRefs),
      vals.inferenceProvider,
      vals.inferenceModel,
      vals.costUsd,
      vals.decidedBy,
    ],
  );
}

/**
 * Append a decision. Idempotent per anchor+version; computes decision_hash. See
 * the module header for the conflict / idempotency_conflict semantics.
 */
export async function recordDecision(
  rawInput: RecordDecisionInput,
  client?: PoolClient,
): Promise<RecordDecisionResult> {
  // Validate the discriminated XOR + apply defaults at this internal write
  // boundary (defense-in-depth for the ONE decision write path; idempotent if
  // the manager already validated). A malformed shape throws (programmer error).
  const input = recordDecisionInputSchema.parse(rawInput);

  const promotedKnowledgeId = input.promotedKnowledgeId ?? null;
  const supersedesKnowledgeId = input.supersedesKnowledgeId ?? null;
  const mergeTargetKnowledgeId = input.mergeTargetKnowledgeId ?? null;
  const evidenceRefs = input.evidenceRefs;
  const inferenceProvider = input.inferenceProvider ?? null;
  const inferenceModel = input.inferenceModel ?? null;
  const costUsd = input.costUsd ?? null;

  let vals: DecisionInsertValues;
  let conflictTarget: string;

  if (input.decisionType === "reconcile") {
    const decisionHash = computeDecisionHash({
      anchorKind: "reconcile",
      anchorId: String(input.reconcileEntryId),
      version: input.outcomeVersion,
      decisionType: input.decisionType,
      promotedKnowledgeId,
      supersedesKnowledgeId,
      mergeTargetKnowledgeId,
      rejectReason: null,
      evidenceRefs,
    });
    vals = {
      candidateId: null,
      reconcileEntryId: input.reconcileEntryId,
      jobId: input.jobId,
      decisionVersion: input.decisionVersion,
      decisionType: input.decisionType,
      decisionHash,
      rejectReason: null,
      promotedKnowledgeId,
      supersedesKnowledgeId,
      mergeTargetKnowledgeId,
      outcomeVersion: input.outcomeVersion,
      evidenceRefs,
      inferenceProvider,
      inferenceModel,
      costUsd,
      decidedBy: input.decidedBy,
    };
    conflictTarget = "(reconcile_entry_id, outcome_version) WHERE reconcile_entry_id IS NOT NULL";
  } else {
    const rejectReason =
      input.decisionType === "reject" || input.decisionType === "expire"
        ? input.rejectReason
        : null;
    const decisionHash = computeDecisionHash({
      anchorKind: "candidate",
      anchorId: input.candidateId,
      version: input.decisionVersion,
      decisionType: input.decisionType,
      promotedKnowledgeId,
      supersedesKnowledgeId,
      mergeTargetKnowledgeId,
      rejectReason,
      evidenceRefs,
    });
    vals = {
      candidateId: input.candidateId,
      reconcileEntryId: null,
      jobId: input.jobId,
      decisionVersion: input.decisionVersion,
      decisionType: input.decisionType,
      decisionHash,
      rejectReason,
      promotedKnowledgeId,
      supersedesKnowledgeId,
      mergeTargetKnowledgeId,
      outcomeVersion: null,
      evidenceRefs,
      inferenceProvider,
      inferenceModel,
      costUsd,
      decidedBy: input.decidedBy,
    };
    conflictTarget = "(candidate_id, decision_version) WHERE candidate_id IS NOT NULL";
  }

  // FG-3: the check + insert run in ONE transaction so they are atomic.
  return inTransaction(client, async (tx): Promise<RecordDecisionResult> => {
    // R2-MF1: the identity anchors are non-FK, so the repo owns referential
    // validity. A candidate decision is legitimate only if the deciding job
    // ACTIVELY holds the candidate; a reconcile decision only if `jobId` IS the
    // matching reconcile job. An incoherent anchor (programmer error) is refused.
    if (!(await anchorsCoherent(tx, input))) {
      return { ok: false, reason: "anchor_incoherent" };
    }

    const row = await upsertDecision(tx, vals, conflictTarget);
    if (!row) {
      throw new Error(
        `recordDecision: upsert returned no row (type=${vals.decisionType}, job=${vals.jobId})`,
      );
    }
    const { inserted, ...rest } = row;
    const decision = mapRow(rest);

    const baseMeta = {
      jobId: vals.jobId,
      decision: vals.decisionType,
      ...(vals.candidateId !== null ? { candidateId: vals.candidateId } : {}),
      ...(vals.rejectReason !== null ? { rejectReason: vals.rejectReason } : {}),
    };

    if (inserted) {
      memLog("decision", "recorded", { ...baseMeta, insertResult: "inserted" });
      return { ok: true, decision, inserted: true };
    }

    // Conflict: the existing row was returned. Compare the stored hash to ours.
    if (decision.decisionHash === vals.decisionHash) {
      memLog("decision", "recorded", { ...baseMeta, insertResult: "duplicate" });
      return { ok: true, decision, inserted: false };
    }
    memLog.warn("decision", "idempotency_conflict", baseMeta);
    return { ok: false, reason: "idempotency_conflict", existing: decision };
  });
}

// ── Reads ────────────────────────────────────────────────────────

/** Full decision history for a candidate, newest version first. */
export async function getDecisionsForCandidate(
  candidateId: string,
  client?: PoolClient,
): Promise<MemoryDecision[]> {
  if (!candidateId) return [];
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryDecisionRow>(
    exec,
    `SELECT ${DECISION_COLUMNS} FROM memory_decisions
      WHERE candidate_id = $1
      ORDER BY decision_version DESC`,
    [candidateId],
  );
  return rows.map(mapRow);
}

/** The most recent decision for a candidate (highest decision_version), or null. */
export async function getLatestDecision(
  candidateId: string,
  client?: PoolClient,
): Promise<MemoryDecision | null> {
  if (!candidateId) return null;
  const exec: Executor = client ?? getPool();
  const row = await queryOneWith<MemoryDecisionRow>(
    exec,
    `SELECT ${DECISION_COLUMNS} FROM memory_decisions
      WHERE candidate_id = $1
      ORDER BY decision_version DESC
      LIMIT 1`,
    [candidateId],
  );
  return row ? mapRow(row) : null;
}

/** Reconcile decision history for a knowledge entry, newest outcome_version first. */
export async function getDecisionsForReconcile(
  entryId: number,
  client?: PoolClient,
): Promise<MemoryDecision[]> {
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryDecisionRow>(
    exec,
    `SELECT ${DECISION_COLUMNS} FROM memory_decisions
      WHERE reconcile_entry_id = $1
      ORDER BY outcome_version DESC`,
    [entryId],
  );
  return rows.map(mapRow);
}

/**
 * List decisions of a given type, newest first (§4 "decisions by type" metric).
 * `limit` is required; a non-positive / non-finite limit → [].
 */
export async function listDecisionsByType(
  type: MemoryDecisionType,
  limit: number,
  client?: PoolClient,
): Promise<MemoryDecision[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MemoryDecisionRow>(
    exec,
    `SELECT ${DECISION_COLUMNS} FROM memory_decisions
      WHERE decision_type = $1
      ORDER BY decided_at DESC, id DESC
      LIMIT $2`,
    [type, Math.floor(limit)],
  );
  return rows.map(mapRow);
}
