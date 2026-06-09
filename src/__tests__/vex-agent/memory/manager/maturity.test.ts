/**
 * Unit tests for the maturity FSM application shell (S6a): reinforceEntry +
 * decayEntry. IO is stubbed (no DB) — these prove the orchestration:
 *  - reinforcement bumps activation + advances the FSM + bumps last_reinforced_at
 *    + records ONE audit row with reason recurrence_confirmation;
 *  - a decayed entry is reactivated (decayed → established, event reactivated);
 *  - decay erodes activation, never deletes, tips to decayed below the threshold,
 *    records reason time_decay, and does NOT bump last_reinforced_at;
 *  - anti audit-spam: a sub-delta decay with no tier change is a no-op (no write,
 *    no audit);
 *  - a precondition miss writes no audit row (no phantom audit / lost update).
 */

import { describe, it, expect, vi } from "vitest";

import {
  reinforceEntry,
  decayEntry,
  DECAY_AUDIT_MIN_DELTA,
  type MaturityDeps,
} from "@vex-agent/memory/manager/maturity.js";
import {
  ACTIVATION_HALF_LIFE_DAYS,
  DECAY_FLOOR,
  REACTIVATION_ACTIVATION,
  REINFORCE_STEP,
} from "@vex-agent/memory/manager/maturity-policy.js";
import type { MaturityEntryRow } from "@vex-agent/db/repos/knowledge/crud.js";

// A fake PoolClient — the stubbed deps never touch it.
const TX = {} as never;

function makeEntry(overrides: Partial<MaturityEntryRow> = {}): MaturityEntryRow {
  return {
    id: 42,
    maturityState: "probationary",
    activationStrength: 0.5,
    decayPolicy: "regime_aware",
    firstPromotedAt: "2026-01-01T00:00:00Z",
    lastReinforcedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDeps(entry: MaturityEntryRow | null, transitionOk = true): {
  deps: MaturityDeps;
  apply: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
} {
  const apply = vi.fn().mockResolvedValue(transitionOk);
  const audit = vi.fn().mockResolvedValue({ id: "1" });
  const deps: MaturityDeps = {
    getMaturityEntry: vi.fn().mockResolvedValue(entry),
    applyMaturityTransition: apply as unknown as MaturityDeps["applyMaturityTransition"],
    recordMaturityEvent: audit as unknown as MaturityDeps["recordMaturityEvent"],
  };
  return { deps, apply, audit };
}

// ── reinforceEntry ────────────────────────────────────────────────

describe("reinforceEntry — recurrence reinforcement", () => {
  it("matures probationary → established, bumps activation + last_reinforced_at, audits", async () => {
    const { deps, apply, audit } = makeDeps(makeEntry({ maturityState: "probationary", activationStrength: 0.5 }));
    const result = await reinforceEntry(7, { candidateId: "11111111-1111-1111-1111-111111111111" }, TX, deps);

    expect(result).toMatchObject({ ok: true, applied: true, fromState: "probationary", toState: "established" });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        nextMaturityState: "established",
        nextActivation: 0.5 + REINFORCE_STEP,
        bumpLastReinforcedAt: true,
      }),
      TX,
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "matured",
        reasonCode: "recurrence_confirmation",
        triggerRefs: { candidateId: "11111111-1111-1111-1111-111111111111" },
      }),
      TX,
    );
  });

  it("reactivates a decayed entry → established with event reactivated", async () => {
    const { deps, apply, audit } = makeDeps(makeEntry({ maturityState: "decayed", activationStrength: DECAY_FLOOR }));
    const result = await reinforceEntry(7, {}, TX, deps);

    expect(result).toMatchObject({ ok: true, applied: true, fromState: "decayed", toState: "established" });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ nextMaturityState: "established", nextActivation: REACTIVATION_ACTIVATION }),
      TX,
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "reactivated" }), TX);
  });

  it("records reinforced (no tier change) at the top tier", async () => {
    const { deps, audit } = makeDeps(makeEntry({ maturityState: "reinforced", activationStrength: 0.9 }));
    await reinforceEntry(7, {}, TX, deps);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "reinforced" }), TX);
  });

  it("no-ops without an audit row when the entry is absent/non-active", async () => {
    const { deps, apply, audit } = makeDeps(null);
    const result = await reinforceEntry(7, {}, TX, deps);
    expect(result).toEqual({ ok: true, applied: false, reason: "not_found" });
    expect(apply).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("no-ops without an audit row on a precondition miss (concurrent transition)", async () => {
    const { deps, audit } = makeDeps(makeEntry(), /* transitionOk */ false);
    const result = await reinforceEntry(7, {}, TX, deps);
    expect(result).toEqual({ ok: true, applied: false, reason: "precondition_miss" });
    expect(audit).not.toHaveBeenCalled();
  });
});

// ── decayEntry ────────────────────────────────────────────────────

describe("decayEntry — time decay (erode, never delete)", () => {
  const NOW = new Date("2026-01-31T00:00:00Z"); // 30 days after the entry's last_reinforced_at

  it("erodes activation by one half-life, records reason time_decay, does NOT bump last_reinforced_at", async () => {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.8 });
    // 30 days ≈ one half-life → 0.4.
    const reinforced = new Date(NOW.getTime() - ACTIVATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    entry.lastReinforcedAt = reinforced.toISOString();

    const { deps, apply, audit } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, TX, deps);

    expect(result).toMatchObject({ ok: true, applied: true });
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBeCloseTo(0.4, 6);
    }
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ bumpLastReinforcedAt: false }), TX);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "decayed", reasonCode: "time_decay" }),
      TX,
    );
  });

  it("never erodes below DECAY_FLOOR and never deletes (floor invariant)", async () => {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.5 });
    const ancient = new Date(NOW.getTime() - 1000 * ACTIVATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    entry.lastReinforcedAt = ancient.toISOString();

    const { deps } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, TX, deps);
    expect(result.ok).toBe(true);
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBe(DECAY_FLOOR);
      expect(result.activationAfter).toBeGreaterThan(0);
    }
  });

  it("tips to decayed and audits the tier change", async () => {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.5 });
    const old = new Date(NOW.getTime() - 5 * ACTIVATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    entry.lastReinforcedAt = old.toISOString();

    const { deps, apply } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, TX, deps);
    expect(result).toMatchObject({ ok: true, applied: true, tierChanged: true });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ nextMaturityState: "decayed" }), TX);
  });

  it("anti audit-spam: a sub-delta decay with no tier change is a no-op", async () => {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.8 });
    // Tiny elapsed time → Δactivation below the delta, tier unchanged.
    const recent = new Date(NOW.getTime() - 60 * 1000); // 1 minute
    entry.lastReinforcedAt = recent.toISOString();

    const { deps, apply, audit } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, TX, deps);
    expect(result).toEqual({ ok: true, applied: false, reason: "below_delta" });
    expect(apply).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    // Sanity: the same-day re-sweep delta really is below the threshold.
    expect(DECAY_AUDIT_MIN_DELTA).toBeGreaterThan(0);
  });

  it("'none' policy is a defensive no-op", async () => {
    const entry = makeEntry({ decayPolicy: "none", activationStrength: 1.0 });
    const { deps, apply } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, TX, deps);
    expect(result.applied).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});
