/**
 * Maturity FSM application (S6a/S6b) — `reinforceEntry` (recurrence
 * reinforcement / reactivation) and `decayEntry` (time + regime decay). The
 * IMPERATIVE SHELL around the pure decisions in `maturity-policy.ts`: it reads
 * the entry's current FSM state, computes the next state via the policy,
 * persists the transition with a precondition guard, and records ONE
 * append-only `knowledge_maturity_events` audit row per real transition
 * (D-AUDIT).
 *
 * Hard invariants (s6-plan §1):
 *   - D-DECAY: decay erodes activation to a floor > 0; it NEVER deletes a row and
 *     NEVER drops below `DECAY_FLOOR`.
 *   - D-MATURE: maturation/reinforcement happens on RECURRENCE (a 2nd confirmation
 *     at consolidation), NOT on retrieval. `last_reinforced_at` is bumped ONLY on
 *     reinforcement/reactivation, never on decay.
 *   - D-AUDIT: every transition that actually changes state writes an audit row
 *     with a `reason_code` + structural `trigger_refs`. A no-op (precondition
 *     miss, or decay below the audit-delta threshold) writes nothing.
 *   - S6b advisory-only (OD-1): the regime view modulates ONLY decay speed and
 *     drives ONLY the decayed→established reactivation here. `regime === null`
 *     (no/stale/unconfirmed snapshots) keeps S6a time-decay bit-for-bit.
 *
 * IO is injectable (`MaturityDeps`) so both functions are unit-testable without a
 * DB. The production wiring (`defaultMaturityDeps`) binds the knowledge repo
 * mutators + the maturity-events repo. Both accept a `PoolClient` so the
 * reinforcement seam can run reinforce + audit in the SAME tx as the candidate
 * decision.
 */

import type { PoolClient } from "pg";

import {
  applyMaturityTransition,
  getMaturityEntry,
  type MaturityEntryRow,
} from "@vex-agent/db/repos/knowledge/crud.js";
import { recordMaturityEvent } from "@vex-agent/db/repos/knowledge-maturity-events/index.js";
import type {
  MaturityReasonCode,
  MaturityTriggerRefs,
} from "@vex-agent/memory/schema/knowledge-maturity-event.js";
import {
  DECAY_FLOOR,
  REACTIVATION_ACTIVATION,
  daysSince,
  decayedActivation,
  nextStateOnDecay,
  nextStateOnReinforce,
  regimeHalfLifeDays,
  regimeMatchKind,
  reinforceEventFor,
  reinforcedActivation,
  type EffectiveRegime,
  type RegimeMatchKind,
} from "./maturity-policy.js";

// ── Injectable IO ───────────────────────────────────────────────────

export interface MaturityDeps {
  /** Read the current FSM inputs for an active entry (null when absent/non-active). */
  getMaturityEntry: (entryId: number, client?: PoolClient) => Promise<MaturityEntryRow | null>;
  /** Persist a guarded FSM transition; returns false on a precondition miss. */
  applyMaturityTransition: typeof applyMaturityTransition;
  /** Append one audit row. */
  recordMaturityEvent: typeof recordMaturityEvent;
}

/** Production wiring (knowledge repo mutators + maturity-events audit repo). */
export function defaultMaturityDeps(): MaturityDeps {
  return {
    getMaturityEntry,
    applyMaturityTransition,
    recordMaturityEvent,
  };
}

// ── Anti audit-spam threshold (decay sweep) ─────────────────────────

/**
 * Minimum activation delta for a decay step to be persisted + audited. A sweep
 * that re-runs the same day on the same row produces a tiny Δactivation (small
 * Δdays); writing/auditing it would be noise. Below this delta the decay step is a
 * no-op (idempotent re-sweep). A maturity-TIER change is ALWAYS persisted even if
 * the activation delta is sub-threshold (the tier move is the meaningful event).
 * tune empirically, do not freeze.
 */
export const DECAY_AUDIT_MIN_DELTA = 0.01;

// ── Outcomes ─────────────────────────────────────────────────────────

export type ReinforceResult =
  | { ok: true; applied: true; fromState: MaturityEntryRow["maturityState"]; toState: MaturityEntryRow["maturityState"]; activationBefore: number; activationAfter: number }
  | { ok: true; applied: false; reason: "not_found" | "precondition_miss" };

export type DecayResult =
  | { ok: true; applied: true; activationBefore: number; activationAfter: number; tierChanged: boolean }
  | { ok: true; applied: false; reason: "not_found" | "below_delta" | "precondition_miss" };

// ── reinforceEntry (recurrence / reactivation) ──────────────────────

/**
 * Reinforce an entry on a 2nd real confirmation (recurrence at consolidation;
 * D-MATURE). Bumps activation (`REINFORCE_STEP`, capped 1.0) and advances the FSM
 * one tier (probationary → established → reinforced); a `decayed` entry is
 * REACTIVATED to `established` (R1#7 — decayed is never a dead end). Bumps
 * `last_reinforced_at = NOW()`. Records `matured` / `reinforced` / `reactivated`
 * (reason `recurrence_confirmation`) in the SAME tx.
 *
 * MUST run inside the caller's tx (the reinforcement seam reads the entry, applies
 * the transition, and records the decision atomically). A precondition miss
 * (concurrent transition / row went non-active) returns `applied:false` WITHOUT an
 * audit row — never a lost update or a phantom audit.
 */
export async function reinforceEntry(
  entryId: number,
  trigger: MaturityTriggerRefs,
  tx: PoolClient,
  deps: MaturityDeps = defaultMaturityDeps(),
): Promise<ReinforceResult> {
  const entry = await deps.getMaturityEntry(entryId, tx);
  if (!entry) return { ok: true, applied: false, reason: "not_found" };

  const fromState = entry.maturityState;
  const toState = nextStateOnReinforce(fromState);
  const activationBefore = entry.activationStrength;
  const activationAfter = reinforcedActivation(activationBefore, fromState);

  const ok = await deps.applyMaturityTransition(
    {
      entryId,
      expectedMaturityState: fromState,
      expectedActivation: activationBefore,
      nextMaturityState: toState,
      nextActivation: activationAfter,
      bumpLastReinforcedAt: true,
      bumpLastDecayedAt: false,
    },
    tx,
  );
  if (!ok) return { ok: true, applied: false, reason: "precondition_miss" };

  await deps.recordMaturityEvent(
    {
      entryId,
      event: reinforceEventFor(fromState, toState),
      fromState,
      toState,
      reasonCode: "recurrence_confirmation",
      activationBefore,
      activationAfter,
      triggerRefs: trigger,
      decidedBy: "system",
    },
    tx,
  );

  return { ok: true, applied: true, fromState, toState, activationBefore, activationAfter };
}

// ── decayEntry (time + regime decay) ────────────────────────────────

/**
 * The later of two timestamp strings (the incremental-decay anchor pick).
 * Either side unparseable → return `a` (the reinforcement-side anchor): an
 * invalid date then yields 0 days via `daysSince`, so a corrupt timestamp
 * degrades to "no decay this round" — a conservative freeze, never a wrong
 * erosion (Phase-6: NaN handling explicit, not via NaN-comparison fallout).
 */
function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const ams = Date.parse(a);
  const bms = Date.parse(b);
  if (!Number.isFinite(ams) || !Number.isFinite(bms)) return a;
  return bms > ams ? b : a;
}

/**
 * Apply one decay step to an entry (D-DECAY). Computes the decayed activation
 * via the policy (exp half-life, floored at `DECAY_FLOOR > 0`) and the resulting
 * maturity tier (→ `decayed` once below the threshold). NEVER deletes the row and
 * NEVER drops below the floor.
 *
 * S6b regime modulation: a `regime_aware` entry under a non-null effective
 * regime resolves a match kind against its closed-vocab tags — match decays
 * slower (60d half-life), mismatch faster (15d), neutral unchanged (30d) — and
 * a `decayed` entry whose tags MATCH a HIGH-confidence regime is REACTIVATED to
 * `established`. `regime === null` (no/stale/unconfirmed snapshots) and the
 * `time` policy keep the S6a time-decay path bit-for-bit (floor repair,
 * `below_delta` skip, `time_decay` reason, empty trigger_refs).
 *
 * INCREMENTAL by construction: each applied decay stamps `last_decayed_at`, and
 * the next step erodes only the quantum since max(last_reinforced_at,
 * last_decayed_at) — an immediate re-run sees Δt ≈ 0 (factor ≈ 1) and no-ops,
 * so idempotency holds for ANY entry age (not just fresh rows).
 *
 * Anti audit-spam: if the activation change is below `DECAY_AUDIT_MIN_DELTA` AND
 * the tier is unchanged, the step is a no-op (no write, no audit) — sub-quantum
 * intervals accumulate until the eroded amount is worth persisting. A tier
 * change is always persisted + audited. Does NOT bump `last_reinforced_at`
 * (decay is not reinforcement; reactivation IS — it restarts the decay clock).
 * `decidedBy` is `system`. `now` is injectable for deterministic tests.
 */
export async function decayEntry(
  entry: MaturityEntryRow,
  now: Date,
  regime: EffectiveRegime | null,
  tx?: PoolClient,
  deps: MaturityDeps = defaultMaturityDeps(),
): Promise<DecayResult> {
  // `none` is filtered out by the sweep query, but guard defensively (no-op).
  if (entry.decayPolicy === "none") {
    return { ok: true, applied: false, reason: "below_delta" };
  }

  // ONLY regime_aware entries under a live effective regime get a non-neutral
  // match kind ('low' dwell-confidence resolves to neutral inside the policy).
  // Everything else — `time` policy, `outcome_aware` (the outcome is an EVENT
  // applied at reconcile, S7 D-OUTCOME-AWARE — between reconciles it
  // time-decays), or no regime — is neutral, i.e. the unmodulated S6a half-life.
  const matchKind: RegimeMatchKind =
    entry.decayPolicy === "regime_aware" && regime !== null
      ? regimeMatchKind(entry.regimeTags, regime)
      : "neutral";

  const activationBefore = entry.activationStrength;

  // 1) REACTIVATION — checked BEFORE the below_delta skip (a decayed entry sits
  //    at/near the floor, so its day-over-day delta is ~0 and the skip branch
  //    would swallow the resurrection forever). Requires the STRONGEST signal:
  //    decayed entry + regime match + HIGH dwell confidence (high in BOTH
  //    snapshots of the pair — see `effectiveRegime`'s min()). Bumps
  //    `last_reinforced_at` (restart of the decay clock — the lesson gets a
  //    fresh run); after the transition the entry is `established`, so this
  //    branch cannot re-fire on the next sweep.
  if (entry.maturityState === "decayed" && matchKind === "match" && regime !== null && regime.confidence === "high") {
    const ok = await deps.applyMaturityTransition(
      {
        entryId: entry.id,
        expectedMaturityState: "decayed",
        expectedActivation: activationBefore,
        nextMaturityState: "established",
        nextActivation: REACTIVATION_ACTIVATION,
        bumpLastReinforcedAt: true,
        bumpLastDecayedAt: false,
      },
      tx,
    );
    if (!ok) return { ok: true, applied: false, reason: "precondition_miss" };

    await deps.recordMaturityEvent(
      {
        entryId: entry.id,
        event: "reactivated",
        fromState: "decayed",
        toState: "established",
        reasonCode: "regime_decay",
        activationBefore,
        activationAfter: REACTIVATION_ACTIVATION,
        triggerRefs: { regimeSnapshotId: regime.snapshotId },
        decidedBy: "system",
      },
      tx,
    );

    return {
      ok: true,
      applied: true,
      activationBefore,
      activationAfter: REACTIVATION_ACTIVATION,
      tierChanged: true,
    };
  }

  // 2) Normal decay with the regime-modulated half-life (neutral = S6a base).
  // INCREMENTAL anchor: erode only the quantum since the last APPLIED decay (or
  // the last reinforcement, whichever is later). Anchoring on reinforcement
  // alone would re-apply the FULL elapsed factor to the already-decayed value
  // on every run — a 30-day-stale lesson would halve once per sweep
  // (compounding), not once per half-life. Exponential decay composes exactly
  // (0.5^(a/h) × 0.5^(b/h) = 0.5^((a+b)/h)), so per-interval quanta sum to the
  // same curve — and under a TIME-VARYING half-life (regime modulation) the
  // per-interval form is the only correct one: each interval erodes at the
  // regime rate in force while it elapsed.
  const anchor = laterOf(entry.lastReinforcedAt ?? entry.firstPromotedAt, entry.lastDecayedAt);
  const days = daysSince(anchor ? new Date(anchor) : null, now);
  const halfLifeDays = regimeHalfLifeDays(matchKind);
  // Floor UP-FRONT so the skip/persist decision sees the value we will actually
  // store. `decayedActivation` already floors at DECAY_FLOOR; the Math.max is
  // belt-and-braces AND repairs a row that arrived BELOW the floor
  // (legacy/imported/corrupt) up to it — the D-DECAY floor invariant must be
  // self-healing, not just non-decreasing.
  const flooredAfter = Math.max(
    DECAY_FLOOR,
    decayedActivation(activationBefore, days, entry.decayPolicy, halfLifeDays),
  );
  const toState = nextStateOnDecay(entry.maturityState, flooredAfter);
  const tierChanged = toState !== entry.maturityState;

  // `lowered` > 0: normal decay; < 0: a sub-floor row repaired UP to the floor
  // (must persist); 0: stable. Skip (idempotent re-sweep / anti audit-spam) ONLY
  // a negligible LOWERING with no tier change — NEVER skip a floor repair
  // (`lowered < 0`), so a below-floor row is always brought back to the floor.
  const lowered = activationBefore - flooredAfter;
  if (!tierChanged && lowered >= 0 && lowered < DECAY_AUDIT_MIN_DELTA) {
    return { ok: true, applied: false, reason: "below_delta" };
  }

  const ok = await deps.applyMaturityTransition(
    {
      entryId: entry.id,
      expectedMaturityState: entry.maturityState,
      expectedActivation: activationBefore,
      nextMaturityState: toState,
      nextActivation: flooredAfter,
      bumpLastReinforcedAt: false,
      bumpLastDecayedAt: true,
    },
    tx,
  );
  if (!ok) return { ok: true, applied: false, reason: "precondition_miss" };

  // A regime-modulated step (match OR mismatch) is audited as `regime_decay`
  // with the driving snapshot in trigger_refs; a neutral step stays the S6a
  // `time_decay` with empty refs. The explicit `regime !== null` re-check keeps
  // the narrowing honest (matchKind is only non-neutral under a non-null
  // regime, but TS cannot see that coupling).
  const regimeDriven = matchKind !== "neutral" && regime !== null;
  const reasonCode: MaturityReasonCode = regimeDriven ? "regime_decay" : "time_decay";
  const triggerRefs: MaturityTriggerRefs = regimeDriven && regime !== null
    ? { regimeSnapshotId: regime.snapshotId }
    : {};

  await deps.recordMaturityEvent(
    {
      entryId: entry.id,
      event: "decayed",
      fromState: entry.maturityState,
      toState,
      reasonCode,
      activationBefore,
      activationAfter: flooredAfter,
      triggerRefs,
      decidedBy: "system",
    },
    tx,
  );

  return { ok: true, applied: true, activationBefore, activationAfter: flooredAfter, tierChanged };
}
