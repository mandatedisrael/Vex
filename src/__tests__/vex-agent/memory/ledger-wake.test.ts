/**
 * Ledger-wake seam unit tests (S7 §3 / D-MAP) — probe construction (dedupe,
 * single-field containment shapes, invalid-key skip) and the wake→enqueue
 * mapping with stubbed deps (one enqueueReconcileJob per matched ACTIVE entry,
 * keyed by the entry's CURRENT outcome_version).
 */

import { describe, it, expect, vi } from "vitest";

import {
  buildWakeProbes,
  enqueueLedgerWake,
  type LedgerWakeDeps,
  type LedgerWakeKey,
} from "@vex-agent/memory/ledger-wake.js";
import type { WakeTarget } from "@vex-agent/db/repos/memory-candidates/index.js";
import type { MemoryJob } from "@vex-agent/db/repos/memory-jobs/index.js";

function makeJob(overrides: Partial<MemoryJob> = {}): MemoryJob {
  const now = new Date().toISOString();
  return {
    id: 1,
    jobKind: "reconcile",
    status: "pending",
    reconcileEntryId: 7,
    reconcileOutcomeVersion: 0,
    wakePending: false,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: now,
    lockedAt: null,
    lockedBy: null,
    heartbeatAt: null,
    lastError: null,
    inferenceProvider: null,
    inferenceModel: null,
    inferenceCompletedAt: null,
    costUsd: null,
    llmCallCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeDeps(
  targets: WakeTarget[],
  insertedByEntry: Record<number, boolean> = {},
): { deps: LedgerWakeDeps; find: ReturnType<typeof vi.fn>; enqueue: ReturnType<typeof vi.fn> } {
  const find = vi.fn().mockResolvedValue(targets);
  const enqueue = vi.fn(async (entryId: number, outcomeVersion: number) => ({
    job: makeJob({ reconcileEntryId: entryId, reconcileOutcomeVersion: outcomeVersion }),
    inserted: insertedByEntry[entryId] ?? true,
  }));
  const deps: LedgerWakeDeps = {
    findPromotedWakeTargets: find as unknown as LedgerWakeDeps["findPromotedWakeTargets"],
    enqueueReconcileJob: enqueue as unknown as LedgerWakeDeps["enqueueReconcileJob"],
  };
  return { deps, find, enqueue };
}

// ── buildWakeProbes ───────────────────────────────────────────────

describe("buildWakeProbes", () => {
  it("emits ONE single-field probe per distinct key value (camelCase anchor keys)", () => {
    const keys: LedgerWakeKey[] = [
      { executionId: 5, instrumentKey: "BONK", positionKey: "pos-1" },
      { executionId: 6, instrumentKey: "BONK" },
    ];
    expect(buildWakeProbes(keys)).toEqual([
      { executionId: 5 },
      { executionId: 6 },
      { instrumentKey: "BONK" },
      { positionKey: "pos-1" },
    ]);
  });

  it("dedupes repeated keys across items (a batch never multiplies probes)", () => {
    const keys: LedgerWakeKey[] = [
      { executionId: 5, positionKey: "pos-1" },
      { executionId: 5, positionKey: "pos-1" },
      { executionId: 5, positionKey: "pos-1" },
    ];
    expect(buildWakeProbes(keys)).toEqual([{ executionId: 5 }, { positionKey: "pos-1" }]);
  });

  it("skips invalid values fail-closed (non-positive/non-finite ids, empty strings)", () => {
    const keys: LedgerWakeKey[] = [
      { executionId: 0, instrumentKey: "" },
      { executionId: -3 },
      { executionId: Number.NaN, positionKey: "" },
    ];
    expect(buildWakeProbes(keys)).toEqual([]);
  });
});

// ── enqueueLedgerWake ─────────────────────────────────────────────

describe("enqueueLedgerWake", () => {
  it("returns zeros and queries NOTHING when no valid probe exists", async () => {
    const { deps, find, enqueue } = makeDeps([]);
    const res = await enqueueLedgerWake([{ executionId: 0 }], deps);
    expect(res).toEqual({ matchedEntries: 0, enqueued: 0 });
    expect(find).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues ONE reconcile job per matched entry, keyed by the CURRENT outcome_version", async () => {
    const { deps, find, enqueue } = makeDeps([
      { entryId: 7, outcomeVersion: 0 },
      { entryId: 9, outcomeVersion: 3 },
    ]);
    const res = await enqueueLedgerWake(
      [{ executionId: 5, instrumentKey: "BONK" }],
      deps,
    );
    expect(find).toHaveBeenCalledWith([{ executionId: 5 }, { instrumentKey: "BONK" }]);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(7, 0);
    expect(enqueue).toHaveBeenCalledWith(9, 3);
    expect(res).toEqual({ matchedEntries: 2, enqueued: 2 });
  });

  it("counts only FRESH inserts as enqueued (a re-arm/no-op conflict is matched, not newly enqueued)", async () => {
    const { deps } = makeDeps(
      [
        { entryId: 7, outcomeVersion: 0 },
        { entryId: 9, outcomeVersion: 1 },
      ],
      { 7: true, 9: false },
    );
    const res = await enqueueLedgerWake([{ executionId: 5 }], deps);
    expect(res).toEqual({ matchedEntries: 2, enqueued: 1 });
  });

  it("propagates a deps error to the caller (the single call site catches — sync never breaks)", async () => {
    const { deps, find } = makeDeps([]);
    find.mockRejectedValue(new Error("db down"));
    await expect(enqueueLedgerWake([{ executionId: 5 }], deps)).rejects.toThrow("db down");
  });
});
