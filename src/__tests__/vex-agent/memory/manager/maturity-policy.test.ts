/**
 * Unit tests for the maturity FSM + activation-decay policy (S6a). Pure
 * decisions, no DB.
 *
 * Doctrine guards proven here:
 *  - decay is exponential half-life of days-since-reinforcement, floored at
 *    DECAY_FLOOR > 0 (influence erosion, NEVER deletion);
 *  - `none` policy is a no-op (pinned/legacy frozen);
 *  - regime_aware / outcome_aware behave as time decay in S6a (D-SCOPE-GATE);
 *  - the FSM advances on reinforcement and tips to `decayed` below the threshold,
 *    and a decayed entry is REACTIVATED (never a dead end);
 *  - the rerank activation factor is bounded in [ACTIVATION_MIN_FACTOR, 1] and the
 *    proven §7 bound holds.
 */

import { describe, it, expect } from "vitest";

import {
  ACTIVATION_HALF_LIFE_DAYS,
  ACTIVATION_MIN_FACTOR,
  ACTIVATION_MIN_FACTOR_PROVEN_BOUND,
  DECAY_FLOOR,
  DECAY_TO_DECAYED_THRESHOLD,
  REACTIVATION_ACTIVATION,
  REINFORCE_STEP,
  activationFactor,
  daysSince,
  decayedActivation,
  nextStateOnDecay,
  nextStateOnReinforce,
  reinforceEventFor,
  reinforcedActivation,
} from "@vex-agent/memory/manager/maturity-policy.js";

// ── decayedActivation ─────────────────────────────────────────────

describe("decayedActivation — exponential half-life, floored, none = no-op", () => {
  it("halves activation after exactly one half-life", () => {
    expect(decayedActivation(0.8, ACTIVATION_HALF_LIFE_DAYS, "time")).toBeCloseTo(0.4, 10);
  });

  it("quarters activation after two half-lives", () => {
    expect(decayedActivation(0.8, 2 * ACTIVATION_HALF_LIFE_DAYS, "time")).toBeCloseTo(0.2, 10);
  });

  it("never erodes below DECAY_FLOOR (> 0 — never deletes)", () => {
    const decayed = decayedActivation(0.5, 100 * ACTIVATION_HALF_LIFE_DAYS, "time");
    expect(decayed).toBe(DECAY_FLOOR);
    expect(decayed).toBeGreaterThan(0);
  });

  it("is a no-op for the 'none' policy (frozen)", () => {
    expect(decayedActivation(1.0, 365, "none")).toBe(1.0);
    expect(decayedActivation(0.5, 9999, "none")).toBe(0.5);
  });

  it("treats regime_aware and outcome_aware as time decay in S6a (gated)", () => {
    const time = decayedActivation(0.8, ACTIVATION_HALF_LIFE_DAYS, "time");
    expect(decayedActivation(0.8, ACTIVATION_HALF_LIFE_DAYS, "regime_aware")).toBeCloseTo(time, 10);
    expect(decayedActivation(0.8, ACTIVATION_HALF_LIFE_DAYS, "outcome_aware")).toBeCloseTo(time, 10);
  });

  it("clamps negative days (clock skew) to no decay", () => {
    expect(decayedActivation(0.8, -10, "time")).toBeCloseTo(0.8, 10);
  });
});

// ── FSM transitions ───────────────────────────────────────────────

describe("nextStateOnReinforce — FSM advance and reactivation", () => {
  it("advances probationary → established → reinforced and caps at reinforced", () => {
    expect(nextStateOnReinforce("probationary")).toBe("established");
    expect(nextStateOnReinforce("established")).toBe("reinforced");
    expect(nextStateOnReinforce("reinforced")).toBe("reinforced");
  });

  it("reactivates a decayed entry back to established (never a dead end)", () => {
    expect(nextStateOnReinforce("decayed")).toBe("established");
  });
});

describe("reinforcedActivation — bump capped at 1.0, decayed resurrected", () => {
  it("adds REINFORCE_STEP capped at 1.0 for a non-decayed entry", () => {
    expect(reinforcedActivation(0.5, "established")).toBeCloseTo(0.5 + REINFORCE_STEP, 10);
    expect(reinforcedActivation(0.95, "reinforced")).toBe(1.0);
  });

  it("resets a decayed entry to REACTIVATION_ACTIVATION (clears the decayed threshold)", () => {
    expect(reinforcedActivation(DECAY_FLOOR, "decayed")).toBe(REACTIVATION_ACTIVATION);
    expect(REACTIVATION_ACTIVATION).toBeGreaterThan(DECAY_TO_DECAYED_THRESHOLD);
  });
});

describe("nextStateOnDecay — tips to decayed below the threshold", () => {
  it("keeps the tier above the threshold", () => {
    expect(nextStateOnDecay("established", DECAY_TO_DECAYED_THRESHOLD + 0.1)).toBe("established");
    expect(nextStateOnDecay("reinforced", 0.9)).toBe("reinforced");
  });

  it("tips any non-decayed tier to decayed at/below the threshold", () => {
    expect(nextStateOnDecay("established", DECAY_TO_DECAYED_THRESHOLD)).toBe("decayed");
    expect(nextStateOnDecay("reinforced", DECAY_FLOOR)).toBe("decayed");
    expect(nextStateOnDecay("probationary", DECAY_FLOOR)).toBe("decayed");
  });

  it("keeps an already-decayed entry decayed", () => {
    expect(nextStateOnDecay("decayed", 0.9)).toBe("decayed");
  });
});

describe("reinforceEventFor — audit event derivation", () => {
  it("maps decayed source to reactivated", () => {
    expect(reinforceEventFor("decayed", "established")).toBe("reactivated");
  });
  it("maps a tier advance to matured", () => {
    expect(reinforceEventFor("probationary", "established")).toBe("matured");
    expect(reinforceEventFor("established", "reinforced")).toBe("matured");
  });
  it("maps a same-tier reinforce to reinforced", () => {
    expect(reinforceEventFor("reinforced", "reinforced")).toBe("reinforced");
  });
});

// ── Rerank activation factor ──────────────────────────────────────

describe("activationFactor — bounded rerank multiplier (§7)", () => {
  it("maps activation 0 → MIN_FACTOR and activation 1 → 1.0", () => {
    expect(activationFactor(0)).toBeCloseTo(ACTIVATION_MIN_FACTOR, 10);
    expect(activationFactor(1)).toBeCloseTo(1.0, 10);
  });

  it("is linear between the bounds", () => {
    expect(activationFactor(0.5)).toBeCloseTo(ACTIVATION_MIN_FACTOR + (1 - ACTIVATION_MIN_FACTOR) * 0.5, 10);
  });

  it("clamps out-of-range activation into [MIN_FACTOR, 1]", () => {
    expect(activationFactor(-5)).toBeCloseTo(ACTIVATION_MIN_FACTOR, 10);
    expect(activationFactor(5)).toBeCloseTo(1.0, 10);
  });

  it("keeps MIN_FACTOR at/above the proven §7 bound", () => {
    expect(ACTIVATION_MIN_FACTOR).toBeGreaterThanOrEqual(ACTIVATION_MIN_FACTOR_PROVEN_BOUND);
  });
});

// ── daysSince ─────────────────────────────────────────────────────

describe("daysSince", () => {
  it("returns fractional days between two dates", () => {
    const now = new Date("2026-01-31T00:00:00Z");
    const ref = new Date("2026-01-01T00:00:00Z");
    expect(daysSince(ref, now)).toBeCloseTo(30, 6);
  });
  it("returns 0 for a null reference (no decay)", () => {
    expect(daysSince(null, new Date())).toBe(0);
  });
  it("clamps a future reference (clock skew) to 0", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-02-01T00:00:00Z");
    expect(daysSince(future, now)).toBe(0);
  });
});
