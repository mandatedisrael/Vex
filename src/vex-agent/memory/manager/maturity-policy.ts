/**
 * Maturity FSM + activation-decay policy (S6a) — pure decisions, no DB / I/O.
 * Tested as plain unit tests. The SINGLE module that owns every maturity/decay
 * tunable (s6-plan §1 D-CONST: "tune empirically, do not freeze").
 *
 * Three concerns live here, all deterministic:
 *   - `decayedActivation(...)` — time-decay of `activation_strength` as an
 *     exponential half-life of days since last reinforcement. Reuses the
 *     half-life shape already in `knowledge/ranking.ts` (`0.5^(days/half_life)`),
 *     floored at `DECAY_FLOOR > 0` (decay = influence erosion, NEVER deletion;
 *     genesis §956 / D-DECAY). `policy === 'none'` is a no-op (pinned/legacy).
 *   - `reinforcedActivation(...)` / `nextStateOnReinforce(...)` — the recurrence
 *     reinforcement step (activation bump capped at 1.0) and the FSM advance
 *     (probationary → established → reinforced; decayed → established
 *     reactivation; R1#7 / §5).
 *   - `nextStateOnDecay(...)` — the decay FSM edge (any tier → decayed once
 *     activation falls below `DECAY_TO_DECAYED_THRESHOLD`).
 *   - `activationFactor(...)` — the BOUNDED rerank multiplier that lets activation
 *     influence recall rank WITHOUT breaking the S3 "confirmed > candidate"
 *     invariant (§7 / D-RERANK). It maps activation ∈ [0,1] → [MIN_FACTOR, 1.0].
 *
 * Unit of time is DAYS everywhere (matching the existing reranker; never mix with
 * hours). `outcome_aware` decay IS plain time decay here BY DESIGN
 * (D-OUTCOME-AWARE, S7): the outcome is an EVENT applied at reconcile time
 * (reconcile-policy.ts consequence map — reinforce/quench/invalidate), not a
 * continuous decay modulation; BETWEEN reconciles an outcome_aware entry simply
 * time-decays.
 *
 * S6b adds the REGIME layer, still pure:
 *   - `effectiveRegime(...)` — the dwell rule (F3): the latest TWO snapshots must
 *     agree per axis before a regime takes effect; disagreement → `unknown`
 *     (neutral). All staleness/gap guards are here, fail-closed to null.
 *   - `regimeMatchKind(...)` — does a lesson's closed-vocab tag set match,
 *     mismatch, or stay neutral against the effective regime (F4: `low`
 *     confidence → ALWAYS neutral).
 *   - `regimeHalfLifeDays(...)` — half-life modulation (match decays slower,
 *     mismatch faster) within HARD factor bounds (import-time assert): never
 *     zero-decay, never deletion-like erosion (DECAY_FLOOR stays untouched).
 * Regime data is advisory-only (OD-1): it modulates decay/reactivation and —
 * indirectly via activation — recall rank. Never sizing/approval/execution.
 */

import type { DecayPolicy, MaturityState } from "@vex-agent/memory/schema/long-memory-enums.js";
import type { RegimeSnapshot } from "@vex-agent/db/repos/regime-snapshots.js";
import {
  minRegimeConfidence,
  regimeTagSchema,
  tagAxis,
  type RegimeConfidence,
  type RegimeTrendLabel,
  type RegimeVolLabel,
} from "@vex-agent/memory/schema/regime-enums.js";

// ── Tunable constants (D-CONST: tune empirically, do not freeze) ────

/**
 * Half-life (in DAYS) of `activation_strength` under time decay. After this many
 * days since last reinforcement, activation halves (paper t_half ≈ 29d).
 * tune empirically, do not freeze.
 */
export const ACTIVATION_HALF_LIFE_DAYS = 30;

/**
 * Activation floor under decay. Decay NEVER erodes below this and NEVER deletes a
 * row (genesis §956 hard invariant). > 0 so a decayed lesson can still be recalled
 * and later reactivated (paper "silent" ≈ 0.03). tune empirically, do not freeze.
 */
export const DECAY_FLOOR = 0.03;

/**
 * Activation gained per recurrence reinforcement (2nd confirmation at
 * consolidation), capped at 1.0. tune empirically, do not freeze.
 */
export const REINFORCE_STEP = 0.25;

/**
 * Activation at/below which a decaying entry drops to the `decayed` maturity tier.
 * Above the floor so a `decayed` entry still has activation > 0 (recallable,
 * reactivatable). tune empirically, do not freeze.
 */
export const DECAY_TO_DECAYED_THRESHOLD = 0.2;

/**
 * Activation a `decayed` entry is reset to on recurrence reactivation
 * (decayed → established). High enough to lift it back above
 * `DECAY_TO_DECAYED_THRESHOLD` (a fresh confirmation resurrects the lesson).
 * tune empirically, do not freeze.
 */
export const REACTIVATION_ACTIVATION = 0.6;

/**
 * Lower bound of the rerank activation multiplier (§7 / D-RERANK). activation
 * ∈ [0,1] maps to `activationFactor` ∈ [MIN_FACTOR, 1.0]. The PROVEN bound: the
 * worst case is the weakest knowledge tier (inferred/hypothesis at tierWeight
 * 0.7) at activation 0; the S3 "confirmed > candidate" invariant needs
 * `0.7 × MIN_FACTOR ≥ CANDIDATE_DUAL_TRACE_WEIGHT (0.6)` ⇒ `MIN_FACTOR ≥ 0.857143`.
 * `0.88` keeps a margin (0.7 × 0.88 = 0.616 ≥ 0.6). tune empirically, do not
 * freeze — but NEVER below the proven 0.857 bound (the runtime assert below
 * enforces it).
 */
export const ACTIVATION_MIN_FACTOR = 0.88;

/**
 * The proven lower bound on `ACTIVATION_MIN_FACTOR` (§7): below this the worst-
 * tier knowledge entry at activation 0 could fall under a max-similarity
 * candidate, breaking the "confirmed > candidate" invariant. The runtime assert
 * fails loud if a future edit drops `ACTIVATION_MIN_FACTOR` under it.
 */
export const ACTIVATION_MIN_FACTOR_PROVEN_BOUND = 0.857;

// ── Regime tunables (S6b; D-CONST: tune empirically, do not freeze) ──

/**
 * Maximum age (DAYS) of the newest snapshot for a regime to be "effective". An
 * older snapshot means the worker is down or the source accounts are unlinked —
 * decay degrades to pure time decay (fail-closed). tune empirically, do not
 * freeze.
 */
export const REGIME_SNAPSHOT_MAX_AGE_DAYS = 3;

/**
 * Maximum gap (HOURS) between the dwell pair's two snapshots. A week-old
 * snapshot does NOT "confirm" today's reading — the two-day dwell (F3) needs
 * two genuinely consecutive days. The LOWER bound on the gap comes from the
 * worker's 20h cadence gate (it never writes two snapshots < 20h apart), so a
 * valid pair is always two distinct days, also after an offline period. tune
 * empirically, do not freeze.
 */
export const REGIME_DWELL_MAX_GAP_HOURS = 48;

/**
 * Half-life multiplier when a lesson's regime tags MATCH the effective regime:
 * the lesson is in season, so it erodes SLOWER (30d → 60d at the default
 * half-life). tune empirically, do not freeze — but NEVER outside
 * [REGIME_MATCH_FACTOR_MIN, REGIME_MATCH_FACTOR_MAX] (import-time assert).
 */
export const REGIME_MATCH_HALF_LIFE_FACTOR = 2.0;

/**
 * Half-life multiplier when a lesson's regime tags MISMATCH the effective
 * regime: the lesson is out of season, so it erodes FASTER (30d → 15d). tune
 * empirically, do not freeze — but NEVER outside
 * [REGIME_MISMATCH_FACTOR_MIN, REGIME_MISMATCH_FACTOR_MAX] (import-time assert).
 */
export const REGIME_MISMATCH_HALF_LIFE_FACTOR = 0.5;

/**
 * Hard bounds on the regime half-life factors (F4 — the regime's influence is
 * CAPPED, whatever future tuning does):
 *   - mismatch ∈ [0.25, 1]: at most 4× faster erosion, never an effective
 *     delete (DECAY_FLOOR is untouched by the factor) and never a SLOWDOWN.
 *   - match ∈ [1, 4]: at most 4× slower erosion, never zero-decay (a finite
 *     factor can never freeze the exponential) and never a SPEED-UP.
 * A future edit outside these bounds fails loud at import (assert below).
 */
export const REGIME_MISMATCH_FACTOR_MIN = 0.25;
export const REGIME_MISMATCH_FACTOR_MAX = 1;
export const REGIME_MATCH_FACTOR_MIN = 1;
export const REGIME_MATCH_FACTOR_MAX = 4;

// Runtime assertion of the §7 bound (mirrors the existing invariant-assert in
// long-memory-retrieval-policy.ts). A future edit that lowers MIN_FACTOR below
// the proven 0.857 bound would silently let a fresh candidate outrank a confirmed
// knowledge entry — fail loud at import instead.
if (ACTIVATION_MIN_FACTOR < ACTIVATION_MIN_FACTOR_PROVEN_BOUND) {
  throw new Error(
    `maturity-policy: ACTIVATION_MIN_FACTOR (${ACTIVATION_MIN_FACTOR}) is below the proven bound ${ACTIVATION_MIN_FACTOR_PROVEN_BOUND} — the "confirmed > candidate" rerank invariant would break`,
  );
}

// Import-time asserts of the F4 regime-factor bounds (mirrors the MIN_FACTOR
// assert above). Outside them a future tuning edit could make regime mismatch
// behave like deletion or regime match like zero-decay — fail loud instead.
if (
  REGIME_MISMATCH_HALF_LIFE_FACTOR < REGIME_MISMATCH_FACTOR_MIN ||
  REGIME_MISMATCH_HALF_LIFE_FACTOR > REGIME_MISMATCH_FACTOR_MAX
) {
  throw new Error(
    `maturity-policy: REGIME_MISMATCH_HALF_LIFE_FACTOR (${REGIME_MISMATCH_HALF_LIFE_FACTOR}) is outside the hard bounds [${REGIME_MISMATCH_FACTOR_MIN}, ${REGIME_MISMATCH_FACTOR_MAX}] — regime mismatch must erode faster but never deletion-fast`,
  );
}
if (
  REGIME_MATCH_HALF_LIFE_FACTOR < REGIME_MATCH_FACTOR_MIN ||
  REGIME_MATCH_HALF_LIFE_FACTOR > REGIME_MATCH_FACTOR_MAX
) {
  throw new Error(
    `maturity-policy: REGIME_MATCH_HALF_LIFE_FACTOR (${REGIME_MATCH_HALF_LIFE_FACTOR}) is outside the hard bounds [${REGIME_MATCH_FACTOR_MIN}, ${REGIME_MATCH_FACTOR_MAX}] — regime match must erode slower but never zero-decay`,
  );
}

// ── helpers ──────────────────────────────────────────────────────

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ── Decay (time, exponential half-life) ──────────────────────────

/**
 * Time-decayed activation. `policy === 'none'` is a no-op (pinned/legacy/frozen).
 * Otherwise `max(DECAY_FLOOR, activation × 0.5^(daysSinceReinforced / halfLifeDays))`.
 *
 * `halfLifeDays` defaults to `ACTIVATION_HALF_LIFE_DAYS`, so existing callers
 * keep the S6a behavior bit-for-bit; the S6b regime path passes
 * `regimeHalfLifeDays(matchKind)` to modulate erosion speed. A non-positive /
 * non-finite half-life falls back to the default (defensive — production values
 * are guarded by the import-time factor asserts). `outcome_aware` behaves as
 * plain time decay BETWEEN reconciles (D-OUTCOME-AWARE — the outcome is an
 * event applied by S7's reconcile, not a decay modulation).
 * `daysSinceReinforced < 0` (clock skew) is clamped
 * to 0 (no decay, never an increase). Activation is clamped to [0,1] on input.
 */
export function decayedActivation(
  activation: number,
  daysSinceReinforced: number,
  policy: DecayPolicy,
  halfLifeDays: number = ACTIVATION_HALF_LIFE_DAYS,
): number {
  const current = clampUnit(activation);
  if (policy === "none") return current;
  const days = Number.isFinite(daysSinceReinforced) ? Math.max(0, daysSinceReinforced) : 0;
  const halfLife =
    Number.isFinite(halfLifeDays) && halfLifeDays > 0 ? halfLifeDays : ACTIVATION_HALF_LIFE_DAYS;
  const decayed = current * Math.pow(0.5, days / halfLife);
  return Math.max(DECAY_FLOOR, decayed);
}

/**
 * The maturity tier AFTER a decay step. Once activation falls at/below
 * `DECAY_TO_DECAYED_THRESHOLD` the entry moves to `decayed` (from ANY non-decayed
 * tier). Above the threshold the tier is unchanged — decay erodes influence
 * gradually before tipping the FSM. An already-`decayed` entry stays `decayed`.
 */
export function nextStateOnDecay(
  current: MaturityState,
  decayedActivationValue: number,
): MaturityState {
  if (current === "decayed") return "decayed";
  if (decayedActivationValue <= DECAY_TO_DECAYED_THRESHOLD) return "decayed";
  return current;
}

// ── Reinforcement (recurrence, 2nd confirmation) ─────────────────

/**
 * Activation AFTER a recurrence reinforcement. A `decayed` entry is RESET to
 * `REACTIVATION_ACTIVATION` (resurrection — it must clear the decayed threshold,
 * not merely inch up from the floor; §5 / R1#7). Any other tier gets a
 * `REINFORCE_STEP` bump, capped at 1.0.
 */
export function reinforcedActivation(activation: number, current: MaturityState): number {
  if (current === "decayed") return REACTIVATION_ACTIVATION;
  return clampUnit(clampUnit(activation) + REINFORCE_STEP);
}

/**
 * The maturity tier AFTER a recurrence reinforcement (§5 FSM):
 *   probationary → established   (2nd confirmation matures the lesson)
 *   established   → reinforced    (a further confirmation)
 *   reinforced    → reinforced    (top tier; reinforcement bumps activation only)
 *   decayed       → established    (reactivation — decayed is never a dead end)
 */
export function nextStateOnReinforce(current: MaturityState): MaturityState {
  switch (current) {
    case "probationary":
      return "established";
    case "established":
      return "reinforced";
    case "reinforced":
      return "reinforced";
    case "decayed":
      return "established";
    default: {
      const _exhaustive: never = current;
      return _exhaustive;
    }
  }
}

/**
 * The audit `event` for a reinforcement, derived from the from→to tier move:
 *   - decayed source                → `reactivated`
 *   - tier advanced (prob→est, est→reinf) → `matured`
 *   - tier unchanged (reinf→reinf)  → `reinforced`
 */
export function reinforceEventFor(from: MaturityState, to: MaturityState): "matured" | "reinforced" | "reactivated" {
  if (from === "decayed") return "reactivated";
  if (from !== to) return "matured";
  return "reinforced";
}

// ── Rerank activation factor (§7 / D-RERANK) ─────────────────────

/**
 * BOUNDED rerank multiplier. Maps activation ∈ [0,1] → [ACTIVATION_MIN_FACTOR,
 * 1.0] LINEARLY: `MIN_FACTOR + (1 − MIN_FACTOR) × activation`. Applied AFTER the
 * source-tier weight in `scoreKnowledge`, it lets a higher-activation lesson rank
 * above a freshly-decayed one at equal base score WITHOUT ever dropping a
 * confirmed knowledge entry below a candidate (the MIN_FACTOR bound guarantees it
 * — see `ACTIVATION_MIN_FACTOR`). NOT a naive `× activation` (which at activation
 * 0.5 would break the invariant). Activation is clamped to [0,1].
 */
export function activationFactor(activation: number): number {
  const a = clampUnit(activation);
  return ACTIVATION_MIN_FACTOR + (1 - ACTIVATION_MIN_FACTOR) * a;
}

// ── Days-since helper ────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole-and-fractional days between `reference` (last_reinforced_at /
 * first_promoted_at) and `now`. A null reference (never reinforced, never
 * promoted) yields `0` (no decay — conservative; the sweep only touches promoted
 * rows in practice). Negative deltas (clock skew) clamp to 0.
 */
export function daysSince(reference: Date | null, now: Date): number {
  if (reference === null) return 0;
  const ms = now.getTime() - reference.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / MS_PER_DAY;
}

// ── Effective regime (S6b — dwell F3, pure) ──────────────────────

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * The dwell-confirmed regime view one decay sweep runs against. Built ONCE per
 * sweep from the latest two snapshots; `null` whenever any guard fails
 * (fail-closed → pure time decay). `snapshotId` is the LATEST snapshot's id,
 * carried into `knowledge_maturity_events.trigger_refs` for the audit trail.
 */
export type EffectiveRegime = {
  readonly trend: RegimeTrendLabel; // 'bull' | 'bear' | 'range' | 'unknown'
  readonly vol: RegimeVolLabel; // 'high' | 'low' | 'unknown'
  readonly confidence: RegimeConfidence; // 'low' | 'medium' | 'high'
  readonly snapshotId: number; // regime_snapshots.id of the latest (trigger_refs)
};

/**
 * Resolve the effective regime from the latest two snapshots (F3 dwell rule).
 * Every guard fails CLOSED to `null` (= no regime influence, pure time decay):
 *   - fewer than 2 snapshots (first day of operation — no effect, by design);
 *   - the newest snapshot older than `REGIME_SNAPSHOT_MAX_AGE_DAYS` (worker
 *     down / accounts unlinked → degrade);
 *   - the pair more than `REGIME_DWELL_MAX_GAP_HOURS` apart (a stale snapshot
 *     does not "confirm" today's);
 *   - an unparseable timestamp (corrupt row).
 * Per axis: equal values → effective; different → `'unknown'` (neutral) —
 * disagreement automatically removes that axis's influence (dwell + fail-closed
 * in one move).
 *
 * `confidence = min(confA, confB)` — INTENT: both days must INDEPENDENTLY
 * sustain the level (two-day corroboration, not clipping). `[low, high]` →
 * `low` → zero influence; reactivation requires `high` in BOTH snapshots of
 * the pair.
 */
export function effectiveRegime(
  latestTwo: readonly RegimeSnapshot[],
  now: Date,
): EffectiveRegime | null {
  if (latestTwo.length < 2) return null;

  // The repo returns newest-first; re-order defensively so a mis-ordered caller
  // can never make a stale snapshot pass the freshness guard as "latest".
  const pair = [...latestTwo]
    .slice(0, 2)
    .map((s) => ({ snapshot: s, ms: Date.parse(s.createdAt) }));
  if (pair.some((p) => !Number.isFinite(p.ms))) return null; // corrupt timestamp → fail closed
  pair.sort((a, b) => b.ms - a.ms);
  const latest = pair[0]!;
  const previous = pair[1]!;

  const ageDays = (now.getTime() - latest.ms) / MS_PER_DAY;
  if (ageDays > REGIME_SNAPSHOT_MAX_AGE_DAYS) return null;

  const gapHours = (latest.ms - previous.ms) / MS_PER_HOUR;
  if (gapHours > REGIME_DWELL_MAX_GAP_HOURS) return null;

  return {
    trend:
      latest.snapshot.trendLabel === previous.snapshot.trendLabel
        ? latest.snapshot.trendLabel
        : "unknown",
    vol:
      latest.snapshot.volLabel === previous.snapshot.volLabel
        ? latest.snapshot.volLabel
        : "unknown",
    confidence: minRegimeConfidence(latest.snapshot.confidence, previous.snapshot.confidence),
    snapshotId: latest.snapshot.id,
  };
}

// ── Regime match kind + half-life modulation (S6b, pure) ─────────

export type RegimeMatchKind = "match" | "mismatch" | "neutral";

/**
 * How a lesson's regime tags relate to the effective regime. CONSERVATIVE
 * aggregation:
 *   - `effective.confidence === 'low'` → ALWAYS `neutral` (F4: low confidence
 *     is recorded but exerts zero influence);
 *   - per tag (via `tagAxis`): an `unknown` snapshot axis makes the tag neutral
 *     (that axis is unconfirmed); otherwise the tag matches or mismatches its
 *     axis value;
 *   - an out-of-vocab tag (pre-F2 legacy row) is skipped — neutral, fail-closed;
 *   - ≥1 match and 0 mismatches → `match`; ≥1 mismatch and 0 matches →
 *     `mismatch`; mixed or empty → `neutral` (a partially-right lesson is not
 *     punished, a partially-wrong one is not rewarded).
 */
export function regimeMatchKind(
  tags: readonly string[],
  effective: EffectiveRegime,
): RegimeMatchKind {
  if (effective.confidence === "low") return "neutral";

  let matches = 0;
  let mismatches = 0;
  for (const raw of tags) {
    const parsed = regimeTagSchema.safeParse(raw);
    if (!parsed.success) continue; // out-of-vocab legacy tag → neutral
    const { axis, value } = tagAxis(parsed.data);
    const axisValue = axis === "trend" ? effective.trend : effective.vol;
    if (axisValue === "unknown") continue; // unconfirmed axis → no influence
    if (axisValue === value) matches += 1;
    else mismatches += 1;
  }

  if (matches >= 1 && mismatches === 0) return "match";
  if (mismatches >= 1 && matches === 0) return "mismatch";
  return "neutral";
}

/**
 * The decay half-life (DAYS) for a regime match kind: neutral keeps the base
 * `ACTIVATION_HALF_LIFE_DAYS` (30), match slows erosion (60), mismatch speeds
 * it up (15). The factors are import-time-asserted into hard bounds, so this
 * can never return zero/negative or an effectively-frozen half-life.
 */
export function regimeHalfLifeDays(matchKind: RegimeMatchKind): number {
  switch (matchKind) {
    case "match":
      return ACTIVATION_HALF_LIFE_DAYS * REGIME_MATCH_HALF_LIFE_FACTOR;
    case "mismatch":
      return ACTIVATION_HALF_LIFE_DAYS * REGIME_MISMATCH_HALF_LIFE_FACTOR;
    case "neutral":
      return ACTIVATION_HALF_LIFE_DAYS;
    default: {
      const _exhaustive: never = matchKind;
      return _exhaustive;
    }
  }
}
