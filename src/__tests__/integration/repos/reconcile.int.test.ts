/**
 * Integration (real pgvector): S7 outcome reconciliation end-to-end on a fresh
 * DB — ledger wake → reconcile job → consequence, with the REAL repos, the
 * REAL S5 resolver, and a STUB judge (the only injected piece).
 *
 * Covers the risk surface the non-DB unit tests cannot:
 *   - e2e reinforce: promoted lesson (outcome open) + realized win in
 *     proj_pnl_matches → wake (matched via the SEMANTIC instrumentKey — the
 *     closing execution is a NEW id, exactly the FIX-1 case) → job → FSM
 *     advance, outcome_version 0→1, reconcile decision row, `outcome_change`
 *     maturity event with the primary-anchor executionId;
 *   - e2e quench: realized loss → activation pushed to the quench level,
 *     `decayed` tier, last_decayed_at stamped (S6b incremental anchor);
 *   - flip → judge stub → invalidate: status='invalidated' + valid_until
 *     stamped atomically; the row disappears from the recall predicate;
 *   - the D-SEAM fires from the REAL populateCaptureItems, while
 *     replayActivityFromCapture creates NO reconcile jobs (no wake storm);
 *   - wake idempotency: 2× wake → 1 job; completed → re-arm; a wake DURING a
 *     running pass raises wake_pending and the full D-REARM cycle converges
 *     (flag → pending → stale → re-enqueue at v1 → unchanged no-op).
 *
 * recoverStaleRunning × wake_pending (gate R1) is pinned in
 * memory-jobs-crud.int.test.ts (repo-level, same DB).
 *
 * Seeds executions / activity / pnl matches via raw SQL (no embeddings
 * endpoint; candidates use synthetic vectors — _s1c-fixtures precedent).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { execute, query } from "@vex-agent/db/client.js";
import {
  insertCandidate,
  getCandidateById,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import {
  claimNextDueJob,
  getJobById,
  listJobsByStatus,
  markCompleted,
  type MemoryJob,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import { getDecisionsForReconcile } from "@vex-agent/db/repos/memory-decisions/index.js";
import { getMaturityEventsForEntry } from "@vex-agent/db/repos/knowledge-maturity-events/index.js";
import { enqueueLedgerWake } from "@vex-agent/memory/ledger-wake.js";
import {
  processReconcileJob,
  defaultReconcileDeps,
  type ReconcileDeps,
} from "@vex-agent/engine/memory-manager/reconcile.js";
import { OUTCOME_QUENCH_ACTIVATION } from "@vex-agent/memory/manager/reconcile-policy.js";
import type { ReconcileJudgeResult } from "@vex-agent/memory/manager/reconcile-judge.js";
import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";
import {
  populateCaptureItems,
  replayActivityFromCapture,
} from "@vex-agent/tools/protocols/capture-pipeline.js";
import { resetDb, randVector } from "../setup/fixtures.js";
import { makeSession, hex64, EMBEDDING_DIM, EMBEDDING_MODEL } from "./_s1c-fixtures.js";

const WALLET = "WaLLetAddr111111111111111111111111111111111";
const INSTRUMENT = "sol:BONK";
const WORKER = "recon-int-w";

// ── Seeders (raw SQL — regime-snapshots precedent) ─────────────────

async function seedExecution(seed: string): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO protocol_executions (tool_id, namespace, success, params, result)
     VALUES ('jupiter.sell', 'solana', TRUE, '{}'::jsonb, $1::jsonb)
     RETURNING id`,
    [JSON.stringify({ seed })],
  );
  return rows[0]!.id;
}

async function seedActiveEntry(args: {
  seed: string;
  source?: string;
  maturityState?: string;
  activation?: number;
}): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO knowledge_entries
       (kind, title, summary, content_hash, embedding_model, embedding_dim, embedding,
        source, maturity_state, activation_strength, decay_policy,
        first_promoted_at, last_reinforced_at, outcome_version)
     VALUES ('trade_lesson', 't', 's', $1, $2, $3, $4::vector,
        $5, $6, $7, 'outcome_aware', NOW(), NOW(), 0)
     RETURNING id`,
    [
      hex64(`recon-ke-${args.seed}`),
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
      `[${randVector(EMBEDDING_DIM, args.seed).join(",")}]`,
      args.source ?? "observed",
      args.maturityState ?? "probationary",
      args.activation ?? 0.5,
    ],
  );
  return rows[0]!.id;
}

function oldOutcome(overrides: Partial<MemoryOutcomeSummary> = {}): MemoryOutcomeSummary {
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

/** A PROMOTED candidate anchored on `executionId` + the semantic instrument key. */
async function seedPromotedCandidate(args: {
  sessionId: string;
  seed: string;
  entryId: number;
  executionId: number;
  outcome: MemoryOutcomeSummary;
}): Promise<string> {
  const { candidate } = await insertCandidate({
    sessionId: args.sessionId,
    proposedBy: "parent",
    kind: "trade_lesson",
    title: `Lesson ${args.seed}`,
    summary: "A reconciled trade lesson.",
    contentMd: "Body.",
    entities: ["BONK"],
    tags: ["risk"],
    sourceRefs: { messageIds: [1] },
    evidenceRefs: [{ executionId: args.executionId, instrumentKey: INSTRUMENT }],
    source: "observed",
    confidence: 0.8,
    importance: 7,
    sensitivity: "normal",
    evidenceStrength: "weak",
    retrievalVisibility: "not_consolidated",
    retrievalUntil: null,
    retainUntil: null,
    embedding: randVector(EMBEDDING_DIM, `recon-${args.seed}`),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    contentHash: hex64(`recon-cand-${args.seed}`),
    eventTime: null,
    observedAt: null,
    availableAtDecisionTime: null,
  });
  await execute(
    `UPDATE memory_candidates
        SET status = 'promoted',
            promoted_knowledge_id = $2,
            outcome = $3::jsonb,
            available_at_decision_time = NOW() - interval '1 day'
      WHERE id = $1`,
    [candidate.id, args.entryId, JSON.stringify(args.outcome)],
  );
  return candidate.id;
}

/** A realized spot close: sell activity + ONE matched pnl row with `pnlUsd`. */
async function seedRealizedClose(executionId: number, pnlUsd: number): Promise<void> {
  const rows = await query<{ id: number }>(
    `INSERT INTO proj_activity
       (namespace, activity_type, product_type, trade_side, chain,
        execution_id, wallet_address, instrument_key)
     VALUES ('solana', 'swap', 'spot', 'sell', 'solana', $1, $2, $3)
     RETURNING id`,
    [executionId, WALLET, INSTRUMENT],
  );
  await execute(
    `INSERT INTO proj_pnl_matches
       (match_kind, sell_activity_id, instrument_key, wallet_address,
        quantity_matched, realized_pnl_usd, namespace, chain)
     VALUES ('matched', $1, $2, $3, '100', $4, 'solana', 'solana')`,
    [rows[0]!.id, INSTRUMENT, WALLET, pnlUsd],
  );
}

async function readEntry(id: number): Promise<{
  status: string;
  source: string;
  maturity_state: string;
  activation_strength: number;
  outcome_version: number;
  valid_until: string | null;
  status_reason: string | null;
  last_decayed_at: string | null;
}> {
  const rows = await query<{
    status: string;
    source: string;
    maturity_state: string;
    activation_strength: number;
    outcome_version: number;
    valid_until: string | null;
    status_reason: string | null;
    last_decayed_at: string | null;
  }>(
    `SELECT status, source, maturity_state, activation_strength, outcome_version,
            valid_until, status_reason, last_decayed_at
       FROM knowledge_entries WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

async function reconcileJobCount(entryId: number): Promise<number> {
  const rows = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM memory_jobs WHERE job_kind='reconcile' AND reconcile_entry_id=$1",
    [entryId],
  );
  return Number(rows[0]!.n);
}

/** Production deps with ONLY the judge stubbed (default = must not be consulted). */
function testDeps(judge?: () => Promise<ReconcileJudgeResult>): ReconcileDeps {
  return {
    ...defaultReconcileDeps(),
    judge: judge ?? (async () => {
      throw new Error("reconcile judge must not be consulted in this scenario");
    }),
  };
}

async function claimReconcile(): Promise<MemoryJob> {
  const job = await claimNextDueJob(WORKER);
  expect(job).not.toBeNull();
  expect(job!.jobKind).toBe("reconcile");
  return job!;
}

describe("S7 outcome reconciliation (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // ── E2E reinforce ───────────────────────────────────────────────

  it("e2e reinforce: realized win → wake via instrumentKey → FSM advance + v1 + decision + outcome_change event", async () => {
    const sid = await makeSession();
    const anchorExec = await seedExecution("win-anchor");
    const entryId = await seedActiveEntry({ seed: "win" });
    const candidateId = await seedPromotedCandidate({
      sessionId: sid,
      seed: "win",
      entryId,
      executionId: anchorExec,
      outcome: oldOutcome(),
    });
    await seedRealizedClose(anchorExec, 25.5);

    // The CLOSING execution is a NEW id (settlement case) — the wake finds the
    // lesson through the SEMANTIC instrument key, not the execution id.
    const closeExec = await seedExecution("win-close");
    const wake = await enqueueLedgerWake([{ executionId: closeExec, instrumentKey: INSTRUMENT }]);
    expect(wake).toEqual({ matchedEntries: 1, enqueued: 1 });

    const job = await claimReconcile();
    expect(job.reconcileEntryId).toBe(entryId);
    expect(job.reconcileOutcomeVersion).toBe(0);

    // source 'observed' → no F2 consult; no flip → judge must not be called.
    await processReconcileJob(job, WORKER, testDeps());

    const entry = await readEntry(entryId);
    expect(entry.status).toBe("active");
    expect(entry.maturity_state).toBe("established"); // probationary → established
    expect(entry.activation_strength).toBeCloseTo(0.75, 6); // 0.5 + REINFORCE_STEP
    expect(entry.outcome_version).toBe(1);

    // The candidate (live outcome record) carries the v1 closed/positive outcome.
    const candidate = await getCandidateById(candidateId);
    expect(candidate!.outcome).toMatchObject({
      status: "closed",
      lessonSignal: "positive",
      evidenceQuality: "strong",
      pnlSource: "pnl_matches",
      outcomeVersion: 1,
    });

    // ONE reconcile decision at the produced version, decided by the map.
    const decisions = await getDecisionsForReconcile(entryId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.outcomeVersion).toBe(1);
    expect(decisions[0]!.decidedBy).toBe("system");

    // ONE outcome_change maturity event anchored on the candidate's primary anchor.
    const events = await getMaturityEventsForEntry(entryId);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("matured");
    expect(events[0]!.reasonCode).toBe("outcome_change");
    expect(events[0]!.triggerRefs).toEqual({ executionId: anchorExec });

    expect((await getJobById(job.id))!.status).toBe("completed");
  });

  // ── E2E quench ──────────────────────────────────────────────────

  it("e2e quench: realized loss → activation quenched, decayed tier, S6b decay anchor stamped", async () => {
    const sid = await makeSession();
    const anchorExec = await seedExecution("loss-anchor");
    const entryId = await seedActiveEntry({ seed: "loss", maturityState: "established", activation: 0.8 });
    await seedPromotedCandidate({
      sessionId: sid,
      seed: "loss",
      entryId,
      executionId: anchorExec,
      outcome: oldOutcome(),
    });
    await seedRealizedClose(anchorExec, -42);

    await enqueueLedgerWake([{ executionId: anchorExec, instrumentKey: INSTRUMENT }]);
    const job = await claimReconcile();
    await processReconcileJob(job, WORKER, testDeps());

    const entry = await readEntry(entryId);
    expect(entry.status).toBe("active"); // quench suppresses, never deletes
    expect(entry.maturity_state).toBe("decayed");
    expect(entry.activation_strength).toBeCloseTo(OUTCOME_QUENCH_ACTIVATION, 6);
    expect(entry.outcome_version).toBe(1);
    expect(entry.last_decayed_at).not.toBeNull(); // incremental anchor bumped

    const events = await getMaturityEventsForEntry(entryId);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("decayed");
    expect(events[0]!.reasonCode).toBe("outcome_change");

    expect((await getDecisionsForReconcile(entryId))[0]!.decidedBy).toBe("system");
    expect((await getJobById(job.id))!.status).toBe("completed");
  });

  // ── Flip → judge stub → invalidate ──────────────────────────────

  it("flip → judge invalidate: status+valid_until stamped atomically; the row leaves the recall predicate", async () => {
    const sid = await makeSession();
    const anchorExec = await seedExecution("flip-anchor");
    const entryId = await seedActiveEntry({ seed: "flip" });
    await seedPromotedCandidate({
      sessionId: sid,
      seed: "flip",
      entryId,
      executionId: anchorExec,
      // The stored outcome says the lesson WON…
      outcome: oldOutcome({ lessonSignal: "positive" }),
    });
    // …but the realized ledger says it LOST → terminal flip → judge.
    await seedRealizedClose(anchorExec, -10);

    await enqueueLedgerWake([{ executionId: anchorExec }]);
    const job = await claimReconcile();
    await processReconcileJob(
      job,
      WORKER,
      testDeps(async () => ({
        verdict: { action: "invalidate", rationale: "realized loss contradicts the claim" },
        llmCalls: 1,
        costUsd: null,
      })),
    );

    const entry = await readEntry(entryId);
    expect(entry.status).toBe("invalidated");
    expect(entry.valid_until).not.toBeNull(); // bi-temporal honesty
    expect(entry.status_reason).toBe("realized loss contradicts the claim");
    expect(entry.outcome_version).toBe(1); // the bump lands even on invalidate

    // Recall filters status='active' — the row is gone from that predicate.
    const recallable = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM knowledge_entries WHERE id=$1 AND status='active'",
      [entryId],
    );
    expect(recallable[0]!.n).toBe("0");

    const decisions = await getDecisionsForReconcile(entryId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decidedBy).toBe("manager"); // the judge ruled

    // Invalidation is a STATUS transition, not an FSM move — no maturity event.
    expect(await getMaturityEventsForEntry(entryId)).toHaveLength(0);

    expect((await getJobById(job.id))!.status).toBe("completed");
  });

  // ── D-SEAM: real capture pipeline wakes; replay does NOT ────────

  it("populateCaptureItems FIRES the wake; replayActivityFromCapture creates NO reconcile jobs", async () => {
    const sid = await makeSession();
    const anchorExec = await seedExecution("seam-anchor");
    const entryId = await seedActiveEntry({ seed: "seam" });
    await seedPromotedCandidate({
      sessionId: sid,
      seed: "seam",
      entryId,
      executionId: anchorExec,
      outcome: oldOutcome(),
    });

    const capture = {
      type: "swap",
      chain: "solana",
      tradeSide: "sell",
      status: "executed",
      walletAddress: WALLET,
      instrumentKey: INSTRUMENT,
    };

    // REAL pipeline → capture items + activity + projections + WAKE.
    const closeExec = await seedExecution("seam-close");
    await populateCaptureItems(closeExec, "jupiter.sell", "solana", capture, undefined, {});
    expect(await reconcileJobCount(entryId)).toBe(1);

    // Drain the queue so the replay assertion is unambiguous.
    const job = await claimReconcile();
    expect(await markCompleted(job.id, WORKER)).toBe(true);

    // Replay re-populates activity from EXISTING capture items — structurally
    // outside the seam: no new job, the completed one is NOT re-armed.
    await replayActivityFromCapture(closeExec, "jupiter.sell", "solana", [{ id: null, data: capture }], {});
    expect(await reconcileJobCount(entryId)).toBe(1);
    expect((await getJobById(job.id))!.status).toBe("completed");
  });

  // ── Idempotency + the full D-REARM cycle ────────────────────────

  it("wake idempotency: 2× wake → 1 job; a completed job re-arms on the next wake", async () => {
    const sid = await makeSession();
    const anchorExec = await seedExecution("idem-anchor");
    const entryId = await seedActiveEntry({ seed: "idem" });
    await seedPromotedCandidate({
      sessionId: sid,
      seed: "idem",
      entryId,
      executionId: anchorExec,
      outcome: oldOutcome(),
    });

    const w1 = await enqueueLedgerWake([{ executionId: anchorExec }]);
    const w2 = await enqueueLedgerWake([{ executionId: anchorExec }]);
    expect(w1).toEqual({ matchedEntries: 1, enqueued: 1 });
    expect(w2).toEqual({ matchedEntries: 1, enqueued: 0 }); // matched, nothing new
    expect(await reconcileJobCount(entryId)).toBe(1);

    // Complete the run (thin ledger → bookkeep is irrelevant here: drain only).
    const job = await claimReconcile();
    expect(await markCompleted(job.id, WORKER)).toBe(true);

    // A NEW wake at the unchanged version RE-ARMS the completed row in place.
    const w3 = await enqueueLedgerWake([{ executionId: anchorExec }]);
    expect(w3).toEqual({ matchedEntries: 1, enqueued: 0 });
    const rearmed = await getJobById(job.id);
    expect(rearmed!.status).toBe("pending");
    expect(rearmed!.attemptCount).toBe(0);
    expect(await reconcileJobCount(entryId)).toBe(1); // still ONE row
  });

  it("a wake DURING a running pass converges through the full D-REARM cycle (flag → pending → stale → v1 → unchanged)", async () => {
    const sid = await makeSession();
    const anchorExec = await seedExecution("cycle-anchor");
    const entryId = await seedActiveEntry({ seed: "cycle" });
    await seedPromotedCandidate({
      sessionId: sid,
      seed: "cycle",
      entryId,
      executionId: anchorExec,
      outcome: oldOutcome(),
    });
    await seedRealizedClose(anchorExec, 12);

    await enqueueLedgerWake([{ executionId: anchorExec }]);
    const first = await claimReconcile();

    // The wake lands WHILE the pass is running → flag, no second row.
    await enqueueLedgerWake([{ executionId: anchorExec }]);
    expect((await getJobById(first.id))!.wakePending).toBe(true);

    // First pass applies reinforce (0→1) and its completion CONSUMES the flag.
    await processReconcileJob(first, WORKER, testDeps());
    const afterFirst = await getJobById(first.id);
    expect(afterFirst!.status).toBe("pending"); // one more pass, not completed
    expect(afterFirst!.wakePending).toBe(false);
    expect((await readEntry(entryId)).outcome_version).toBe(1);

    // Second pass: the job is keyed v0 but the entry moved to v1 → stale →
    // idempotent re-enqueue at v1, this job retires.
    const second = await claimReconcile();
    expect(second.id).toBe(first.id);
    await processReconcileJob(second, WORKER, testDeps());
    expect((await getJobById(first.id))!.status).toBe("completed");
    expect(await reconcileJobCount(entryId)).toBe(2); // (v0 completed) + (v1 pending)

    // Third pass: the v1 job re-resolves the SAME ledger → unchanged no-op.
    const third = await claimReconcile();
    expect(third.reconcileOutcomeVersion).toBe(1);
    await processReconcileJob(third, WORKER, testDeps());
    expect((await getJobById(third.id))!.status).toBe("completed");

    // The whole cycle produced exactly ONE decision (the real change at v1)
    // and left no pending work behind.
    expect(await getDecisionsForReconcile(entryId)).toHaveLength(1);
    expect(await listJobsByStatus("pending", 10)).toHaveLength(0);
    expect((await readEntry(entryId)).outcome_version).toBe(1);
  });
});
