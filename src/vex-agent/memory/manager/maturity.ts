/**
 * Maturity FSM application (S6a) — `reinforceEntry` (recurrence reinforcement /
 * reactivation) and `decayEntry` (time decay). The IMPERATIVE SHELL around the
 * pure decisions in `maturity-policy.ts`: it reads the entry's current FSM state,
 * computes the next state via the policy, persists the transition with a
 * precondition guard, and records ONE append-only `knowledge_maturity_events`
 * audit row per real transition (D-AUDIT).
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
import type { MaturityTriggerRefs } from "@vex-agent/memory/schema/knowledge-maturity-event.js";
import {
  DECAY_FLOOR,
  daysSince,
  decayedActivation,
  nextStateOnDecay,
  nextStateOnReinforce,
  reinforceEventFor,
  reinforcedActivation,
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

// ── decayEntry (time decay) ─────────────────────────────────────────

/**
 * Apply one time-decay step to an entry (D-DECAY). Computes the decayed activation
 * via the policy (exp half-life, floored at `DECAY_FLOOR > 0`) and the resulting
 * maturity tier (→ `decayed` once below the threshold). NEVER deletes the row and
 * NEVER drops below the floor.
 *
 * Anti audit-spam: if the activation change is below `DECAY_AUDIT_MIN_DELTA` AND
 * the tier is unchanged, the step is a no-op (no write, no audit) — re-sweeping
 * the same day is idempotent. A tier change is always persisted + audited. Does
 * NOT bump `last_reinforced_at` (decay is not reinforcement). `decidedBy` is
 * `system`. `now` is injectable for deterministic tests.
 */
export async function decayEntry(
  entry: MaturityEntryRow,
  now: Date,
  tx?: PoolClient,
  deps: MaturityDeps = defaultMaturityDeps(),
): Promise<DecayResult> {
  // `none` is filtered out by the sweep query, but guard defensively (no-op).
  if (entry.decayPolicy === "none") {
    return { ok: true, applied: false, reason: "below_delta" };
  }

  const activationBefore = entry.activationStrength;
  const reference = entry.lastReinforcedAt ?? entry.firstPromotedAt;
  const days = daysSince(reference ? new Date(reference) : null, now);
  // Floor UP-FRONT so the skip/persist decision sees the value we will actually
  // store. `decayedActivation` already floors at DECAY_FLOOR; the Math.max is
  // belt-and-braces AND repairs a row that arrived BELOW the floor
  // (legacy/imported/corrupt) up to it — the D-DECAY floor invariant must be
  // self-healing, not just non-decreasing.
  const flooredAfter = Math.max(DECAY_FLOOR, decayedActivation(activationBefore, days, entry.decayPolicy));
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
    },
    tx,
  );
  if (!ok) return { ok: true, applied: false, reason: "precondition_miss" };

  await deps.recordMaturityEvent(
    {
      entryId: entry.id,
      event: "decayed",
      fromState: entry.maturityState,
      toState,
      reasonCode: "time_decay",
      activationBefore,
      activationAfter: flooredAfter,
      triggerRefs: {},
      decidedBy: "system",
    },
    tx,
  );

  return { ok: true, applied: true, activationBefore, activationAfter: flooredAfter, tierChanged };
}
