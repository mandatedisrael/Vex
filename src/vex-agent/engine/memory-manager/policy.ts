/**
 * memory_manager worker policy — named constants for the async curator (S4).
 *
 * No DB, no embeddings, no I/O — plain unit-testable constants. The lifecycle
 * cadence constants (heartbeat / stale / max-attempts / per-call timeout / retry
 * backoff) REUSE the compact-jobs worker values where the semantics match (one
 * durable claim/heartbeat/retry discipline across the two memory workers); the
 * memory-specific knobs (batch limit, maintenance sweep cadence, deterministic-
 * stage thresholds, probation activation, recurrence gate) are defined here.
 */

import {
  TRACK2_RETRY_BACKOFF_BASE_MS,
  TRACK2_TIMEOUT_MS,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_MAX_ATTEMPTS,
  WORKER_STALE_THRESHOLD_MS,
} from "@vex-agent/engine/compact-jobs/policy.js";

// ── Reused worker lifecycle constants (compact-jobs precedent) ──────

export {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_STALE_THRESHOLD_MS,
  WORKER_MAX_ATTEMPTS,
};

/** Per-judge-LLM-call timeout (mirrors Track 2's chunker timeout). */
export const JUDGE_TIMEOUT_MS = TRACK2_TIMEOUT_MS;

/** Initial retry backoff (× attempt_count for an exponential schedule). */
export const MEMORY_RETRY_BACKOFF_BASE_MS = TRACK2_RETRY_BACKOFF_BASE_MS;

// ── Poll / sweep cadence ────────────────────────────────────────────

/** Worker poll interval — how often the executor claims the next due job. */
export const MEMORY_WORKER_POLL_INTERVAL_MS = 5_000;

/**
 * Maintenance cron-tick cadence (genesis §953/§967 ≈ 3h). On each tick the
 * executor enqueues a consolidate job IFF pending candidates exist without an
 * active job — the periodic fallback to the event-driven `enqueueConsolidateJob`
 * from `long_memory_suggest` (S2).
 */
export const MAINTENANCE_SWEEP_INTERVAL_MS = 3 * 60 * 60_000; // 3h

/** Candidates reserved + decided per consolidate job (one batch). */
export const CONSOLIDATE_BATCH_LIMIT = 16;

// ── Deterministic-stage cosines (D5/D6/D7) ──────────────────────────

/**
 * Near-duplicate threshold (Fork D). A candidate whose max cosine vs an active
 * knowledge entry is ≥ this AND that does NOT differ on a number/date/qualifier
 * (Graphiti guardrail) is a duplicate.
 */
export const NEAR_DUP_COSINE = 0.93;

/**
 * Conflict-flag threshold (D6). A candidate at cosine ≥ this vs an ACTIVE entry
 * of the same kind/entity, carrying a CONTRADICTING number, is flagged for the
 * judge (supersede vs reject).
 */
export const CONFLICT_COSINE = 0.85;

/**
 * Recurrence-cluster threshold (D7). Rows within this cosine of the candidate
 * form its recurrence cluster; distinct execution anchors across the cluster are
 * the recurrence count.
 */
export const RECURRENCE_CLUSTER_COSINE = 0.9;

// ── Deterministic-stage scalar gates ────────────────────────────────

/** Mundane gate (D8): importance ≤ this AND weak/none evidence → retain. */
export const MUNDANE_IMPORTANCE_MAX = 2;

/** Low-confidence floor (D9): confidence below this is low-confidence. */
export const LOW_CONFIDENCE_FLOOR = 0.3;

/** Live-state re-scan reject threshold (D1) — matches the suggest boundary. */
export const LIVE_STATE_RESCAN_REJECT_FRACTION = 0.3;

/**
 * Recurrence promote gate (D-REC, Fork B = ≥2). A GENERALIZED lesson
 * (strategy/risk family) promotes only at recurrence ≥ this; at n=1 it retains
 * (a recallable hypothesis, never lost). A single anchored fact is never
 * promoted AS a generalization.
 */
export const RECURRENCE_PROMOTE_MIN = 2;

// ── Promotion influence ─────────────────────────────────────────────

/**
 * Activation strength a freshly-promoted (probationary) lesson starts at. < 1 so
 * a probationary lesson is de-weighted vs an established one in S3 reranking;
 * maturation (probationary → established, raising activation) is S6.
 */
export const PROBATION_ACTIVATION = 0.5;
