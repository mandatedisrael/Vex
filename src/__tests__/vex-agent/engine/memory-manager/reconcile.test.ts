/**
 * processReconcileJob unit tests (S7 §4) — every worker branch with fully
 * stubbed IO (`ReconcileDeps`): stale → idempotent re-enqueue at the current
 * version, the no-op vocabulary, the deterministic reinforce/quench
 * consequences (FSM transition + `outcome_change` audit + S6b decay anchor),
 * the flip→judge path (invalidate / retain), the F2 tier-raise consult, and
 * the fail-closed judge error → markFailed retry.
 */

import { describe, it, expect, vi } from "vitest";

import {
  processReconcileJob,
  type ReconcileDeps,
} from "@vex-agent/engine/memory-manager/reconcile.js";
import { OUTCOME_QUENCH_ACTIVATION } from "@vex-agent/memory/manager/reconcile-policy.js";
import type { ReconcileJudgeResult } from "@vex-agent/memory/manager/reconcile-judge.js";
import type { ReconcileEntryLock } from "@vex-agent/db/repos/knowledge/crud.js";
import type { MemoryCandidate } from "@vex-agent/db/repos/memory-candidates/index.js";
import type { MemoryJob } from "@vex-agent/db/repos/memory-jobs/index.js";
import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";
import { makeCandidate } from "../../memory/manager/_fixtures.js";

// A fake PoolClient — the stubbed deps never touch it.
const TX = {} as never;

const ENTRY_ID = 42;
const WORKER = "w-test";

function makeJob(overrides: Partial<MemoryJob> = {}): MemoryJob {
  const now = new Date().toISOString();
  return {
    id: 11,
    jobKind: "reconcile",
    status: "running",
    reconcileEntryId: ENTRY_ID,
    reconcileOutcomeVersion: 0,
    wakePending: false,
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: now,
    lockedAt: now,
    lockedBy: WORKER,
    heartbeatAt: now,
    lastError: null,
    inferenceProvider: null,
    inferenceModel: null,
    inferenceCompletedAt: null,
    costUsd: null,
    llmCallCount: 0,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ReconcileEntryLock> = {}): ReconcileEntryLock {
  return {
    id: ENTRY_ID,
    status: "active",
    source: "inferred",
    outcomeVersion: 0,
    maturityState: "probationary",
    activationStrength: 0.5,
    ...overrides,
  };
}

function outcome(overrides: Partial<MemoryOutcomeSummary> = {}): MemoryOutcomeSummary {
  return {
    status: "open",
    lessonSignal: "neutral",
    evidenceQuality: "weak",
    pointInTimeChecked: true,
    outcomeComputedBy: "memory_manager",
    outcomeVersion: 0,
    needsReconciliation: true,
    pnlSource: "none",
    ...overrides,
  };
}

/** A PROMOTED candidate carrying the S5-stored outcome (the live record). */
function promotedCandidate(
  oldOutcome: MemoryOutcomeSummary | null,
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return makeCandidate({
    status: "promoted",
    promotedKnowledgeId: ENTRY_ID,
    outcome: oldOutcome,
    availableAtDecisionTime: "2026-06-01T00:00:00.000Z",
    ...overrides,
  });
}

interface StubScenario {
  entry?: ReconcileEntryLock | null;
  /** Tx re-lock result; defaults to `entry` (no race). */
  txEntry?: ReconcileEntryLock | null;
  candidate?: MemoryCandidate | null;
  resolved?: MemoryOutcomeSummary | null;
  judge?: ReconcileJudgeResult | Error;
}

interface Stubs {
  deps: ReconcileDeps;
  readEntry: ReturnType<typeof vi.fn>;
  resolveOutcome: ReturnType<typeof vi.fn>;
  judge: ReturnType<typeof vi.fn>;
  applyMaturityTransition: ReturnType<typeof vi.fn>;
  recordMaturityEvent: ReturnType<typeof vi.fn>;
  invalidateEntryOnReconcile: ReturnType<typeof vi.fn>;
  invalidateEdgesForOrigin: ReturnType<typeof vi.fn>;
  raiseEntrySourceTier: ReturnType<typeof vi.fn>;
  bumpOutcomeVersion: ReturnType<typeof vi.fn>;
  updateReconciledCandidateOutcome: ReturnType<typeof vi.fn>;
  recordDecision: ReturnType<typeof vi.fn>;
  enqueueReconcileJob: ReturnType<typeof vi.fn>;
  markCompleted: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  bumpJobInference: ReturnType<typeof vi.fn>;
  withTransaction: ReturnType<typeof vi.fn>;
}

function makeDeps(scenario: StubScenario = {}): Stubs {
  const entry = scenario.entry === undefined ? makeEntry() : scenario.entry;
  const txEntry = scenario.txEntry === undefined ? entry : scenario.txEntry;

  const readEntry = vi.fn().mockResolvedValue(entry);
  const resolveOutcome = vi.fn().mockResolvedValue(scenario.resolved ?? null);
  const judge =
    scenario.judge instanceof Error
      ? vi.fn().mockRejectedValue(scenario.judge)
      : vi.fn().mockResolvedValue(scenario.judge ?? null);
  const applyMaturityTransition = vi.fn().mockResolvedValue(true);
  const recordMaturityEvent = vi.fn().mockResolvedValue({ id: "1" });
  const invalidateEntryOnReconcile = vi.fn().mockResolvedValue(true);
  // S8: graph-edge retraction stub (the invalidate branch retracts the lesson's
  // asserted edges in the SAME tx; 0 = "no edges existed", the common case).
  const invalidateEdgesForOrigin = vi.fn().mockResolvedValue(0);
  const raiseEntrySourceTier = vi.fn().mockResolvedValue(true);
  const bumpOutcomeVersion = vi.fn().mockResolvedValue(true);
  const updateReconciledCandidateOutcome = vi.fn().mockResolvedValue({ ok: true });
  const recordDecision = vi.fn().mockResolvedValue({
    ok: true,
    decision: { id: "1" },
    inserted: true,
  });
  const enqueueReconcileJob = vi.fn().mockResolvedValue({ job: makeJob(), inserted: true });
  const markCompleted = vi.fn().mockResolvedValue(true);
  const markFailed = vi.fn().mockResolvedValue({ ok: true, terminal: false });
  const bumpJobInference = vi.fn().mockResolvedValue(makeJob());
  const withTransaction = vi.fn(async (fn: (tx: never) => Promise<unknown>) => fn(TX));

  const deps: ReconcileDeps = {
    readEntry: readEntry as unknown as ReconcileDeps["readEntry"],
    findCandidateByPromotedKnowledgeId: vi
      .fn()
      .mockResolvedValue(scenario.candidate === undefined ? null : scenario.candidate) as unknown as ReconcileDeps["findCandidateByPromotedKnowledgeId"],
    resolveOutcome: resolveOutcome as unknown as ReconcileDeps["resolveOutcome"],
    judge: judge as unknown as ReconcileDeps["judge"],
    withTransaction: withTransaction as unknown as ReconcileDeps["withTransaction"],
    lockEntryForReconcile: vi.fn().mockResolvedValue(txEntry) as unknown as ReconcileDeps["lockEntryForReconcile"],
    applyMaturityTransition: applyMaturityTransition as unknown as ReconcileDeps["applyMaturityTransition"],
    recordMaturityEvent: recordMaturityEvent as unknown as ReconcileDeps["recordMaturityEvent"],
    invalidateEntryOnReconcile: invalidateEntryOnReconcile as unknown as ReconcileDeps["invalidateEntryOnReconcile"],
    invalidateEdgesForOrigin: invalidateEdgesForOrigin as unknown as ReconcileDeps["invalidateEdgesForOrigin"],
    raiseEntrySourceTier: raiseEntrySourceTier as unknown as ReconcileDeps["raiseEntrySourceTier"],
    bumpOutcomeVersion: bumpOutcomeVersion as unknown as ReconcileDeps["bumpOutcomeVersion"],
    updateReconciledCandidateOutcome: updateReconciledCandidateOutcome as unknown as ReconcileDeps["updateReconciledCandidateOutcome"],
    recordDecision: recordDecision as unknown as ReconcileDeps["recordDecision"],
    enqueueReconcileJob: enqueueReconcileJob as unknown as ReconcileDeps["enqueueReconcileJob"],
    markCompleted: markCompleted as unknown as ReconcileDeps["markCompleted"],
    markFailed: markFailed as unknown as ReconcileDeps["markFailed"],
    heartbeat: vi.fn().mockResolvedValue(true) as unknown as ReconcileDeps["heartbeat"],
    bumpJobInference: bumpJobInference as unknown as ReconcileDeps["bumpJobInference"],
    inferenceProvider: "openrouter",
    inferenceModel: "test-model",
  };

  return {
    deps,
    readEntry,
    resolveOutcome,
    judge,
    applyMaturityTransition,
    recordMaturityEvent,
    invalidateEntryOnReconcile,
    invalidateEdgesForOrigin,
    raiseEntrySourceTier,
    bumpOutcomeVersion,
    updateReconciledCandidateOutcome,
    recordDecision,
    enqueueReconcileJob,
    markCompleted,
    markFailed,
    bumpJobInference,
    withTransaction,
  };
}

// ── No-op branches ────────────────────────────────────────────────

describe("processReconcileJob — no-op branches", () => {
  it("stale pre-read version → re-enqueues at the CURRENT version, completes, never resolves", async () => {
    const s = makeDeps({ entry: makeEntry({ outcomeVersion: 2 }) });
    await processReconcileJob(makeJob({ reconcileOutcomeVersion: 0 }), WORKER, s.deps);
    expect(s.enqueueReconcileJob).toHaveBeenCalledWith(ENTRY_ID, 2);
    expect(s.markCompleted).toHaveBeenCalledWith(makeJob().id, WORKER);
    expect(s.resolveOutcome).not.toHaveBeenCalled();
    expect(s.withTransaction).not.toHaveBeenCalled();
  });

  it("entry gone / non-active → complete no-op without re-enqueue", async () => {
    for (const entry of [null, makeEntry({ status: "invalidated" })]) {
      const s = makeDeps({ entry });
      await processReconcileJob(makeJob(), WORKER, s.deps);
      expect(s.markCompleted).toHaveBeenCalled();
      expect(s.enqueueReconcileJob).not.toHaveBeenCalled();
      expect(s.withTransaction).not.toHaveBeenCalled();
    }
  });

  it("no promoted candidate OR no stored outcome → complete no-op (no live outcome record)", async () => {
    for (const candidate of [null, promotedCandidate(null)]) {
      const s = makeDeps({ candidate });
      await processReconcileJob(makeJob(), WORKER, s.deps);
      expect(s.markCompleted).toHaveBeenCalled();
      expect(s.resolveOutcome).not.toHaveBeenCalled();
    }
  });

  it("resolver returns null → unresolvable no-op", async () => {
    const s = makeDeps({ candidate: promotedCandidate(outcome()), resolved: null });
    await processReconcileJob(makeJob(), WORKER, s.deps);
    expect(s.markCompleted).toHaveBeenCalled();
    expect(s.withTransaction).not.toHaveBeenCalled();
  });

  it("unchanged outcome → complete WITHOUT tx and WITHOUT a decision row (conscious audit choice)", async () => {
    const same = outcome();
    const s = makeDeps({ candidate: promotedCandidate(same), resolved: outcome() });
    await processReconcileJob(makeJob(), WORKER, s.deps);
    expect(s.markCompleted).toHaveBeenCalled();
    expect(s.withTransaction).not.toHaveBeenCalled();
    expect(s.recordDecision).not.toHaveBeenCalled();
    expect(s.judge).not.toHaveBeenCalled();
  });

  it("corrupt job row (missing reconcile fields) → markFailed, never a guess", async () => {
    const s = makeDeps();
    await processReconcileJob(makeJob({ reconcileEntryId: null }), WORKER, s.deps);
    expect(s.markFailed).toHaveBeenCalled();
    expect(s.markCompleted).not.toHaveBeenCalled();
  });
});

// ── Deterministic consequences (no judge) ─────────────────────────

describe("processReconcileJob — deterministic map", () => {
  it("reinforce: FSM advance + outcome_change audit + v+1 bump + system decision (judge NOT consulted)", async () => {
    // closed+positive+medium → reinforce; ceiling NOT strong → no F2 consult.
    const s = makeDeps({
      candidate: promotedCandidate(outcome()),
      resolved: outcome({ status: "closed", lessonSignal: "positive", evidenceQuality: "medium", pnlSource: "open_position" }),
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);

    expect(s.judge).not.toHaveBeenCalled();
    expect(s.applyMaturityTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: ENTRY_ID,
        expectedMaturityState: "probationary",
        expectedActivation: 0.5,
        nextMaturityState: "established",
        nextActivation: 0.75,
        bumpLastReinforcedAt: true,
        bumpLastDecayedAt: false,
      }),
      TX,
    );
    expect(s.recordMaturityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: ENTRY_ID,
        event: "matured",
        fromState: "probationary",
        toState: "established",
        reasonCode: "outcome_change",
        triggerRefs: { executionId: 5 }, // the candidate's primary anchor
        decidedBy: "system",
      }),
      TX,
    );
    expect(s.updateReconciledCandidateOutcome).toHaveBeenCalledWith(
      promotedCandidate(outcome()).id,
      ENTRY_ID,
      expect.objectContaining({ outcomeVersion: 1, outcomeLastChangedAt: expect.any(String) }),
      TX,
    );
    expect(s.bumpOutcomeVersion).toHaveBeenCalledWith(ENTRY_ID, 0, TX);
    expect(s.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionType: "reconcile",
        reconcileEntryId: ENTRY_ID,
        outcomeVersion: 1,
        decidedBy: "system",
      }),
      TX,
    );
    // No judge → no inference identity on the decision, no LLM accumulators.
    const decisionInput = s.recordDecision.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(decisionInput.inferenceProvider).toBeUndefined();
    expect(s.bumpJobInference).not.toHaveBeenCalled();
    expect(s.markCompleted).toHaveBeenCalled();
  });

  it("quench: activation min(current, QUENCH) floored, decayed tier, S6b decay anchor bumped", async () => {
    const s = makeDeps({
      entry: makeEntry({ maturityState: "established", activationStrength: 0.8 }),
      candidate: promotedCandidate(outcome()),
      resolved: outcome({ status: "closed", lessonSignal: "negative", evidenceQuality: "medium", pnlSource: "open_position" }),
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);

    expect(s.judge).not.toHaveBeenCalled();
    expect(s.applyMaturityTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMaturityState: "established",
        expectedActivation: 0.8,
        nextMaturityState: "decayed", // 0.15 ≤ DECAY_TO_DECAYED_THRESHOLD
        nextActivation: OUTCOME_QUENCH_ACTIVATION,
        bumpLastReinforcedAt: false,
        bumpLastDecayedAt: true, // S6b incremental anchor — a quench IS an applied decay step
      }),
      TX,
    );
    expect(s.recordMaturityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "decayed", reasonCode: "outcome_change", decidedBy: "system" }),
      TX,
    );
    expect(s.markCompleted).toHaveBeenCalled();
  });

  it("bookkeep (signal change to mixed): version bump + decision ONLY — zero FSM writes", async () => {
    const s = makeDeps({
      candidate: promotedCandidate(outcome()),
      resolved: outcome({ lessonSignal: "mixed" }),
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);
    expect(s.applyMaturityTransition).not.toHaveBeenCalled();
    expect(s.recordMaturityEvent).not.toHaveBeenCalled();
    expect(s.invalidateEntryOnReconcile).not.toHaveBeenCalled();
    expect(s.bumpOutcomeVersion).toHaveBeenCalledWith(ENTRY_ID, 0, TX);
    expect(s.recordDecision).toHaveBeenCalled();
    expect(s.markCompleted).toHaveBeenCalled();
  });
});

// ── Flip → judge ──────────────────────────────────────────────────

const FLIP_OLD = outcome({ lessonSignal: "positive" });
const FLIP_NEW = outcome({
  status: "closed",
  lessonSignal: "negative",
  evidenceQuality: "strong",
  pnlSource: "pnl_matches",
  needsReconciliation: false,
});

describe("processReconcileJob — flip → judge", () => {
  it("invalidate verdict: direct status update (rationale carried), manager decision, NO maturity event", async () => {
    const s = makeDeps({
      candidate: promotedCandidate(FLIP_OLD),
      resolved: FLIP_NEW,
      judge: { verdict: { action: "invalidate", rationale: "contradicted" }, llmCalls: 1, costUsd: 0.002 },
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);

    expect(s.judge).toHaveBeenCalledWith(
      expect.objectContaining({ flip: true, tierRaiseEligible: true }),
    );
    expect(s.invalidateEntryOnReconcile).toHaveBeenCalledWith(ENTRY_ID, "contradicted", TX);
    // S8 (D-SUPERSEDE-WIRING): the dead lesson's graph edges are retracted in
    // the SAME tx as the invalidation.
    expect(s.invalidateEdgesForOrigin).toHaveBeenCalledWith(ENTRY_ID, TX);
    expect(s.applyMaturityTransition).not.toHaveBeenCalled();
    expect(s.recordMaturityEvent).not.toHaveBeenCalled();
    expect(s.bumpJobInference).toHaveBeenCalledWith(makeJob().id, { llmCalls: 1, costUsd: 0.002 });
    expect(s.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decidedBy: "manager",
        inferenceProvider: "openrouter",
        inferenceModel: "test-model",
        costUsd: 0.002,
        outcomeVersion: 1,
      }),
      TX,
    );
    expect(s.markCompleted).toHaveBeenCalled();
  });

  it("retain verdict: keeps the lesson untouched (bump + decision only)", async () => {
    const s = makeDeps({
      candidate: promotedCandidate(FLIP_OLD),
      resolved: FLIP_NEW,
      judge: { verdict: { action: "retain", rationale: "process claim unaffected" }, llmCalls: 1, costUsd: null },
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);
    expect(s.invalidateEntryOnReconcile).not.toHaveBeenCalled();
    expect(s.invalidateEdgesForOrigin).not.toHaveBeenCalled();
    expect(s.applyMaturityTransition).not.toHaveBeenCalled();
    expect(s.bumpOutcomeVersion).toHaveBeenCalledWith(ENTRY_ID, 0, TX);
    expect(s.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decidedBy: "manager" }),
      TX,
    );
    expect(s.markCompleted).toHaveBeenCalled();
  });

  it("quench verdict: executes the rule-3 math exactly like the deterministic quench", async () => {
    const s = makeDeps({
      entry: makeEntry({ maturityState: "reinforced", activationStrength: 0.9 }),
      candidate: promotedCandidate(FLIP_OLD),
      resolved: FLIP_NEW,
      judge: { verdict: { action: "quench", rationale: "loss outweighs" }, llmCalls: 1, costUsd: null },
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);
    expect(s.applyMaturityTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        nextActivation: OUTCOME_QUENCH_ACTIVATION,
        nextMaturityState: "decayed",
        bumpLastDecayedAt: true,
      }),
      TX,
    );
    expect(s.recordMaturityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "decayed", reasonCode: "outcome_change", decidedBy: "manager" }),
      TX,
    );
  });

  it("judge failure → markFailed (retry), NO tx, NO completion (fail-closed)", async () => {
    const s = makeDeps({
      candidate: promotedCandidate(FLIP_OLD),
      resolved: FLIP_NEW,
      judge: new Error("memory_reconcile_judge_timeout"),
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);
    expect(s.markFailed).toHaveBeenCalledWith(makeJob().id, WORKER, "judge_timeout", expect.any(Number));
    expect(s.withTransaction).not.toHaveBeenCalled();
    expect(s.markCompleted).not.toHaveBeenCalled();
  });
});

// ── F2 tier raise (orthogonal to the map) ─────────────────────────

describe("processReconcileJob — F2 tier raise", () => {
  it("ceiling strong on an inferred entry consults the judge tier-only; the deterministic kind still executes", async () => {
    // closed+positive+strong → reinforce AND ceiling 'strong' → F2 consult.
    const s = makeDeps({
      entry: makeEntry({ source: "inferred" }),
      candidate: promotedCandidate(outcome()),
      resolved: outcome({ status: "closed", lessonSignal: "positive", evidenceQuality: "strong", pnlSource: "pnl_matches", needsReconciliation: false }),
      judge: { verdict: { action: "retain", sourceTier: "observed", rationale: "full data" }, llmCalls: 1, costUsd: null },
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);

    expect(s.judge).toHaveBeenCalledWith(
      expect.objectContaining({ flip: false, tierRaiseEligible: true }),
    );
    // The judge's ACTION is ignored on a deterministic consequence — reinforce runs.
    expect(s.applyMaturityTransition).toHaveBeenCalledWith(
      expect.objectContaining({ bumpLastReinforcedAt: true }),
      TX,
    );
    // The tier proposal is applied upward (inferred → observed under ceiling strong).
    expect(s.raiseEntrySourceTier).toHaveBeenCalledWith(ENTRY_ID, "observed", TX);
    expect(s.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decidedBy: "manager" }),
      TX,
    );
  });

  it("an observed entry never triggers the F2 consult (no LLM call)", async () => {
    const s = makeDeps({
      entry: makeEntry({ source: "observed" }),
      candidate: promotedCandidate(outcome()),
      resolved: outcome({ status: "closed", lessonSignal: "positive", evidenceQuality: "strong", pnlSource: "pnl_matches", needsReconciliation: false }),
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);
    expect(s.judge).not.toHaveBeenCalled();
    expect(s.raiseEntrySourceTier).not.toHaveBeenCalled();
    expect(s.markCompleted).toHaveBeenCalled();
  });
});

// ── Tx re-validation (optimistic concurrency) ─────────────────────

describe("processReconcileJob — tx re-check", () => {
  it("a version race inside the tx → no writes, idempotent re-enqueue at the racer's version, complete", async () => {
    const s = makeDeps({
      entry: makeEntry({ outcomeVersion: 0 }),
      txEntry: makeEntry({ outcomeVersion: 5 }), // concurrent reconcile bumped it
      candidate: promotedCandidate(outcome()),
      resolved: outcome({ status: "closed", lessonSignal: "positive", evidenceQuality: "medium", pnlSource: "open_position" }),
    });
    await processReconcileJob(makeJob(), WORKER, s.deps);
    expect(s.applyMaturityTransition).not.toHaveBeenCalled();
    expect(s.recordDecision).not.toHaveBeenCalled();
    expect(s.enqueueReconcileJob).toHaveBeenCalledWith(ENTRY_ID, 5);
    expect(s.markCompleted).toHaveBeenCalled();
  });
});
