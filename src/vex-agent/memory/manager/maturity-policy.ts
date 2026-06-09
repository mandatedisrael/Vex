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
 * hours). `regime_aware` / `outcome_aware` decay policies behave as plain time
 * decay in S6a (D-SCOPE-GATE; full regime decay is S6b, outcome is S7).
 */

import type { DecayPolicy, MaturityState } from "@vex-agent/memory/schema/long-memory-enums.js";

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

// Runtime assertion of the §7 bound (mirrors the existing invariant-assert in
// long-memory-retrieval-policy.ts). A future edit that lowers MIN_FACTOR below
// the proven 0.857 bound would silently let a fresh candidate outrank a confirmed
// knowledge entry — fail loud at import instead.
if (ACTIVATION_MIN_FACTOR < ACTIVATION_MIN_FACTOR_PROVEN_BOUND) {
  throw new Error(
    `maturity-policy: ACTIVATION_MIN_FACTOR (${ACTIVATION_MIN_FACTOR}) is below the proven bound ${ACTIVATION_MIN_FACTOR_PROVEN_BOUND} — the "confirmed > candidate" rerank invariant would break`,
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
 * Otherwise `max(DECAY_FLOOR, activation × 0.5^(daysSinceReinforced / HALF_LIFE))`.
 *
 * `regime_aware` / `outcome_aware` behave as plain time decay in S6a
 * (D-SCOPE-GATE). `daysSinceReinforced < 0` (clock skew) is clamped to 0 (no
 * decay, never an increase). Activation is clamped to [0,1] on input.
 */
export function decayedActivation(
  activation: number,
  daysSinceReinforced: number,
  policy: DecayPolicy,
): number {
  const current = clampUnit(activation);
  if (policy === "none") return current;
  const days = Number.isFinite(daysSinceReinforced) ? Math.max(0, daysSinceReinforced) : 0;
  const decayed = current * Math.pow(0.5, days / ACTIVATION_HALF_LIFE_DAYS);
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
