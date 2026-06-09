/**
 * Unit tests for the activation decay sweep loop (S6a). IO is stubbed (no DB) —
 * these prove the batching/paging/cap/idempotency-error-handling:
 *  - pages through entries by id and applies decayEntry to each;
 *  - aggregates decayed vs scanned counts;
 *  - respects the per-run entry cap (bounded scan);
 *  - a per-entry failure is non-fatal (sweep continues, errored counted);
 *  - an empty store is a clean no-op.
 */

import { describe, it, expect, vi } from "vitest";

import {
  runDecaySweep,
  DECAY_SWEEP_BATCH_SIZE,
  DECAY_SWEEP_MAX_ENTRIES,
  type DecaySweepDeps,
} from "@vex-agent/engine/memory-manager/decay-sweep.js";
import type { MaturityEntryRow } from "@vex-agent/db/repos/knowledge/crud.js";
import type { DecayResult } from "@vex-agent/memory/manager/maturity.js";

function entry(id: number): MaturityEntryRow {
  return {
    id,
    maturityState: "established",
    activationStrength: 0.5,
    decayPolicy: "regime_aware",
    firstPromotedAt: "2026-01-01T00:00:00Z",
    lastReinforcedAt: "2026-01-01T00:00:00Z",
  };
}

const APPLIED: DecayResult = { ok: true, applied: true, activationBefore: 0.5, activationAfter: 0.4, tierChanged: false };
const NOOP: DecayResult = { ok: true, applied: false, reason: "below_delta" };

/** A paging stub backed by an in-memory list, honoring afterId + limit. */
function pagingList(all: MaturityEntryRow[]): DecaySweepDeps["listDecayableEntries"] {
  return vi.fn(async ({ afterId, limit }) =>
    all.filter((e) => e.id > afterId).slice(0, limit),
  );
}

describe("runDecaySweep", () => {
  it("pages through all entries and decays each", async () => {
    const all = Array.from({ length: DECAY_SWEEP_BATCH_SIZE + 5 }, (_, i) => entry(i + 1));
    const decay = vi.fn(async () => APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList(all), decayEntry: decay };

    const result = await runDecaySweep(new Date(), deps);

    expect(result.scanned).toBe(all.length);
    expect(result.decayed).toBe(all.length);
    expect(result.errored).toBe(0);
    expect(decay).toHaveBeenCalledTimes(all.length);
  });

  it("counts only entries that actually changed as decayed", async () => {
    const all = [entry(1), entry(2), entry(3)];
    const decay = vi
      .fn<DecaySweepDeps["decayEntry"]>()
      .mockResolvedValueOnce(APPLIED)
      .mockResolvedValueOnce(NOOP)
      .mockResolvedValueOnce(APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList(all), decayEntry: decay };

    const result = await runDecaySweep(new Date(), deps);
    expect(result.scanned).toBe(3);
    expect(result.decayed).toBe(2);
  });

  it("respects the per-run entry cap (bounded scan)", async () => {
    const all = Array.from({ length: DECAY_SWEEP_MAX_ENTRIES + 100 }, (_, i) => entry(i + 1));
    const decay = vi.fn(async () => APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList(all), decayEntry: decay };

    const result = await runDecaySweep(new Date(), deps);
    expect(result.scanned).toBe(DECAY_SWEEP_MAX_ENTRIES);
  });

  it("continues past a per-entry failure (non-fatal)", async () => {
    const all = [entry(1), entry(2), entry(3)];
    const decay = vi
      .fn<DecaySweepDeps["decayEntry"]>()
      .mockResolvedValueOnce(APPLIED)
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValueOnce(APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList(all), decayEntry: decay };

    const result = await runDecaySweep(new Date(), deps);
    expect(result.scanned).toBe(3);
    expect(result.decayed).toBe(2);
    expect(result.errored).toBe(1);
  });

  it("is a clean no-op on an empty store", async () => {
    const decay = vi.fn(async () => APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList([]), decayEntry: decay };
    const result = await runDecaySweep(new Date(), deps);
    expect(result).toEqual({ scanned: 0, decayed: 0, errored: 0 });
    expect(decay).not.toHaveBeenCalled();
  });
});
