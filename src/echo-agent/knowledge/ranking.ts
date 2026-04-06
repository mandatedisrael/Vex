/**
 * Knowledge recall reranker — pure TS, no DB, no embeddings.
 *
 * Re-orders SQL candidates by combined score:
 *   score = similarity + recencyBoost + confidenceBoost + pinnedBoost
 *
 * Notable absence: NO `kindWeight`. The agent defines its own kinds organically
 * and the code does not pretend to know which kinds matter more. Ranking is
 * purely based on signal we actually own (vector distance, freshness, agent's
 * own confidence rating, pinned flag).
 */

import { clampRecallK, isKnowledgeStatus, type KnowledgeStatus } from "./policy.js";

export interface RecallCandidate {
  id: number;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  /** Cosine similarity in [0, 1]. Higher is better. */
  similarity: number;
  /** Agent-assigned 0..1 (optional). */
  confidence: number | null;
  status: KnowledgeStatus;
  pinned: boolean;
  validUntil: Date | null;
  validFrom: Date;
  updatedAt: Date;
  sourceRefs: Record<string, unknown>;
  tags: string[];
}

export interface RerankOptions {
  /** Now reference for recency boost (defaults to `new Date()`). */
  now?: Date;
  /** Final cap on returned results (clamped to RECALL_MAX_K). */
  k?: number;
  /** If false, drop candidates with status != active. Default true (active only). */
  activeOnly?: boolean;
}

// ── Tunable boost weights ────────────────────────────────────────
// These are constants in source, not env-config. They are signal weights, not knobs.

/** Maximum recency boost added (entry just updated). */
const RECENCY_BOOST_MAX = 0.15;

/** Half-life for recency decay (after this many days, boost halves). */
const RECENCY_HALF_LIFE_DAYS = 7;

/** Maximum confidence boost (when confidence == 1.0). Linear with confidence. */
const CONFIDENCE_BOOST_MAX = 0.10;

/** Flat boost added when entry has pinned=true. */
const PINNED_BOOST = 0.20;

// ── Public API ───────────────────────────────────────────────────

export interface RankedRecallResult extends RecallCandidate {
  /** Final combined score used for ordering. */
  score: number;
}

/**
 * Rerank candidates by combined score, filter by status, head k.
 *
 * Stable sort: candidates with equal score keep input order. This is important
 * for determinism in tests — SQL `ORDER BY embedding <=> $1 LIMIT k*2` is the
 * deterministic source.
 */
export function rerank(
  candidates: readonly RecallCandidate[],
  opts: RerankOptions = {},
): RankedRecallResult[] {
  const now = opts.now ?? new Date();
  const activeOnly = opts.activeOnly !== false;
  const k = clampRecallK(opts.k);

  const filtered = activeOnly
    ? candidates.filter((c) => c.status === "active")
    : candidates.filter((c) => isKnowledgeStatus(c.status));

  const scored: RankedRecallResult[] = filtered.map((c) => ({
    ...c,
    score: computeScore(c, now),
  }));

  // Stable sort by score DESC, ties keep input order
  scored.sort((a, b) => {
    if (b.score === a.score) return 0;
    return b.score - a.score;
  });

  return scored.slice(0, k);
}

// ── Internals ────────────────────────────────────────────────────

function computeScore(c: RecallCandidate, now: Date): number {
  const similarity = clamp01(c.similarity);
  const recency = recencyBoost(c.updatedAt, now);
  const confidence = c.confidence !== null ? clamp01(c.confidence) * CONFIDENCE_BOOST_MAX : 0;
  const pinned = c.pinned ? PINNED_BOOST : 0;
  return similarity + recency + confidence + pinned;
}

function recencyBoost(updatedAt: Date, now: Date): number {
  const ageMs = Math.max(0, now.getTime() - updatedAt.getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  // exp decay: boost = MAX * 0.5^(ageDays / halfLife)
  const decay = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
  return RECENCY_BOOST_MAX * decay;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
