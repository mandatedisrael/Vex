/**
 * Judge-decision benchmark — PRE-REGISTERED INDEPENDENT ORACLE.
 * TEST-ONLY pure data. The load-bearing ANTI-CIRCULARITY artifact.
 *
 * For every benchmark corpus item this records the EXPECTED correct JUDGE
 * decision — the verdict, the provenance tier ceiling, the supersede target, and
 * the 5-axis rubric BANDS — reasoned from PRODUCT INTENT alone. It imports NO
 * policy module and NO decision logic: the verdict/reason unions below are
 * HAND-RE-TYPED LOCAL literals, so a schema edit can never silently retune an
 * expectation. The ONLY corpus coupling is the id LIST + the agent-facing text
 * accessor — never the corpus author's intent, predecessor text, or kind/verdict
 * semantics baked into ids (the ids are opaque by construction).
 *
 * ── DISJOINT AUTHORSHIP (the firewall) ───────────────────────────────────────
 * The 134 predictions are authored by THREE DISJOINT agent clusters, each in
 * its own `_judge-oracle-{a,b,c}.ts` file, reasoning ONLY from the agent-facing
 * text (`judgeItemFacing`) — never the corpus cluster files, predecessor text,
 * author intent, or the `stratum` runner hint. The `stratum` is now structurally
 * absent from `judgeItemFacing()` (it CORRELATES with the expected verdict, so
 * exposing it was a circularity leak); the runner reads it off the corpus item
 * directly, never via the oracle-facing accessor:
 *   • ORACLE_A — M001–M045 (45 rows; `OracleRow[]`, each row carries its id);
 *   • ORACLE_B — M046–M090 (45 rows; keyed `Record<id, prediction>`);
 *   • ORACLE_C — M091–M134 (44 rows; ordered `JudgeOraclePrediction[]`, the row
 *     order IS the id contract — bound to ids by position from `M091`).
 * This module CONCATENATES them (append-only by opaque id range) into the single
 * `JUDGE_ORACLE.predictions` record. The Wave-0 stub rows are gone; this file now
 * owns only the shared types, the merge, and the module-load coverage assert. A
 * pipeline-vs-oracle disagreement is a REAL signal, triaged by a human as
 * `memory_bug` vs `oracle_error`.
 *
 * ── BANDS, NOT EXACT INTS (live-LLM jitter → SOFT) ───────────────────────────
 * Rubric expectations are encoded as inclusive `[lo, hi]` BANDS per axis, never
 * exact scores, because the live judge jitters. The scorer measures WHICH axis
 * the judge mis-scores against the band; a single out-of-band axis is a metric,
 * not a red.
 *
 * ── TIER vs CLAMP (design §97; never false-green) ────────────────────────────
 * `expectedTierCeiling` is authored from the EVIDENCE STORY (none→hypothesis …
 * strong→observed; user_confirmed exempt). The benchmark scores the CLAMP-applied
 * tier (clamped ≤ ceiling) as HARD and the JUDGE-RAW tier vs this band as SOFT —
 * scoring the clamped tier as "judge calibration" would read ~100% by
 * construction. This oracle owns the EXPECTATION; the scorer owns the split.
 *
 * Pure module: typed const data + a module-load coverage assert. No DB, no
 * embeddings, no I/O, no `as any`, no policy imports.
 */

import { JUDGE_CORPUS_IDS } from "./_judge-corpus.js";
import { ORACLE_A } from "./_judge-oracle-a.js";
import { ORACLE_B } from "./_judge-oracle-b.js";
import { ORACLE_C } from "./_judge-oracle-c.js";

// ════════════════════════════════════════════════════════════════════════════
//  VOCABULARY — HAND-RE-TYPED LOCAL literal unions (imports zero policy/schema).
//  These MIRROR the judge verdict labels + reject-reason values, but are
//  re-declared here ON PURPOSE so the oracle owns its own copy: a production
//  enum edit cannot silently change an expectation.
// ════════════════════════════════════════════════════════════════════════════

/** The five judge verdicts (mirrors JUDGE_VERDICTS — re-typed, not imported). */
export type OracleVerdict =
  | "promote"
  | "supersede"
  | "retain"
  | "reject"
  | "expire";

/** Reject/expire reason (mirrors memory_decision reject_reason — re-typed). */
export type OracleRejectReason =
  | "secret_or_live_state"
  | "low_confidence"
  | "duplicate"
  | "insufficient_evidence"
  | "superseded_by_existing"
  | "expired_ttl"
  | "policy";

/**
 * The MAX provenance tier the item's EVIDENCE justifies, reasoned from what the
 * item carries (NOT from any clamp matrix): `none` = no durable evidence;
 * `weak` = a single fresh observation / unproven n=1; `moderate` = a durable
 * fact or a recurrence-met generalization; `strong` = closed-trade realized-PnL
 * or an explicit user affirmation.
 */
export type OracleTierCeiling = "none" | "weak" | "moderate" | "strong";

/** An inclusive 1–5 rubric band `[lo, hi]` — SOFT (the judge jitters). */
export interface RubricBand {
  readonly lo: number;
  readonly hi: number;
}

/** The 5-axis rubric expectation, each axis a band (never an exact int). */
export interface OracleRubricBands {
  readonly grounding: RubricBand;
  readonly durability: RubricBand;
  readonly novelty: RubricBand;
  readonly generalizability: RubricBand;
  readonly processNotOutcome: RubricBand;
}

/**
 * A tracked known-gap marker. The EXPECTATION is always the correct behavior;
 * this flags where the CURRENT pipeline is known to fall short (e.g. `F7`
 * semantic supersede target selection) so the scorer records "tracked gap"
 * instead of a surprise red.
 */
export interface OracleKnownGap {
  readonly code: "F7";
  readonly note: string;
}

/** The pre-registered expectation for ONE corpus item. */
export interface JudgeOraclePrediction {
  /** The verdict a CORRECT judge SHOULD reach for this item. */
  readonly expectedVerdict: OracleVerdict;
  /** The max provenance tier the evidence justifies (clamp HARD input). */
  readonly expectedTierCeiling: OracleTierCeiling;
  /** Reject/expire reason, when the expected verdict is reject or expire. */
  readonly expectedRejectReason?: OracleRejectReason;
  /**
   * For a supersede expectation: whether a predecessor SHOULD be retired. The
   * concrete target id is intentionally NOT pinned here at Wave 0 (the corpus
   * predecessor is seeded at run time); Wave 3 wires target selection as
   * SOFT/`knownGap:F7`. Present so the type is stable.
   */
  readonly expectsSupersede?: boolean;
  /** The 5-axis rubric BANDS (SOFT — measured per axis). */
  readonly rubric: OracleRubricBands;
  /** A tracked known gap, when the current pipeline is expected to fall short. */
  readonly knownGap?: OracleKnownGap;
  /** Prose rationale for the human adjudicator (design discipline). */
  readonly rationale: string;
}

/** The whole oracle — one prediction per corpus id. */
export interface JudgeOracle {
  readonly predictions: Readonly<Record<string, JudgeOraclePrediction>>;
}

// ════════════════════════════════════════════════════════════════════════════
//  MERGE — three disjoint cluster files into one id-keyed predictions record.
//
//  The clusters export three DIFFERENT shapes by author choice; this module is
//  the single seam that normalizes them and binds each prediction to its opaque
//  corpus id. The shapes:
//    • ORACLE_A: `OracleRow[]` — each row carries its own `id`.
//    • ORACLE_B: `Record<id, JudgeOraclePrediction>` — already id-keyed.
//    • ORACLE_C: `JudgeOraclePrediction[]` — NO id; the ROW ORDER is the id
//      contract, bound here to ids `M091…M134` by position.
//  A double-bind (two rows claiming the same id) is rejected loudly so a cluster
//  overlap can never silently drop an expectation. Final 1:1 coverage against the
//  corpus id list is enforced by `assertOracleCoverage()` below.
// ════════════════════════════════════════════════════════════════════════════

/** First opaque id of ORACLE_C — its rows are bound to ids by position. */
const ORACLE_C_ID_BASE = 91;

/** Format an `M\d{3}` opaque id from a 1-based sequence number. */
function oracleId(seq: number): string {
  return `M${String(seq).padStart(3, "0")}`;
}

/** Bind one prediction to an id; throw on a double-bind (cluster overlap). */
function bindPrediction(
  into: Record<string, JudgeOraclePrediction>,
  id: string,
  pred: JudgeOraclePrediction,
): void {
  if (Object.prototype.hasOwnProperty.call(into, id)) {
    throw new Error(`_judge-oracle: duplicate prediction for id "${id}" across clusters`);
  }
  into[id] = pred;
}

/** Assemble the merged predictions record from the three disjoint clusters. */
function assembleOraclePredictions(): Record<string, JudgeOraclePrediction> {
  const predictions: Record<string, JudgeOraclePrediction> = {};

  // ORACLE_A — id carried on each row; strip it to the bare prediction shape.
  for (const { id, ...prediction } of ORACLE_A) {
    bindPrediction(predictions, id, prediction);
  }

  // ORACLE_B — already keyed by opaque id.
  for (const [id, prediction] of Object.entries(ORACLE_B)) {
    bindPrediction(predictions, id, prediction);
  }

  // ORACLE_C — id-less, ordered; bind by position from `ORACLE_C_ID_BASE`.
  ORACLE_C.forEach((prediction, index) => {
    bindPrediction(predictions, oracleId(ORACLE_C_ID_BASE + index), prediction);
  });

  return predictions;
}

export const JUDGE_ORACLE: JudgeOracle = {
  predictions: assembleOraclePredictions(),
};

// ── Module-load coverage / non-circularity asserts ──

/**
 * Coverage: EXACTLY one oracle row per corpus id (no missing, no orphan). Imports
 * ONLY the corpus id LIST (`JUDGE_CORPUS_IDS`) — never the corpus items, their
 * intent, or any decision logic — so the firewall is enforced in code.
 */
function assertOracleCoverage(): void {
  const corpusIds = new Set(JUDGE_CORPUS_IDS);
  const oracleIds = new Set(Object.keys(JUDGE_ORACLE.predictions));

  for (const id of corpusIds) {
    if (!oracleIds.has(id)) {
      throw new Error(`_judge-oracle: corpus id "${id}" has no oracle row`);
    }
  }
  for (const id of oracleIds) {
    if (!corpusIds.has(id)) {
      throw new Error(`_judge-oracle: oracle row "${id}" has no corpus item (orphan)`);
    }
  }

  // Band sanity: every axis band is a valid 1–5 inclusive range lo ≤ hi.
  for (const [id, pred] of Object.entries(JUDGE_ORACLE.predictions)) {
    for (const [axis, b] of Object.entries(pred.rubric)) {
      if (b.lo < 1 || b.hi > 5 || b.lo > b.hi) {
        throw new Error(`_judge-oracle: ${id}.${axis} band [${b.lo},${b.hi}] out of 1..5 / inverted`);
      }
    }
    // reject/expire MUST carry a reason; promote/supersede/retain MUST NOT.
    const needsReason = pred.expectedVerdict === "reject" || pred.expectedVerdict === "expire";
    if (needsReason && pred.expectedRejectReason === undefined) {
      throw new Error(`_judge-oracle: ${id} expects ${pred.expectedVerdict} but has no expectedRejectReason`);
    }
    if (!needsReason && pred.expectedRejectReason !== undefined) {
      throw new Error(`_judge-oracle: ${id} expects ${pred.expectedVerdict} but carries an expectedRejectReason`);
    }
  }
}

assertOracleCoverage();
