/**
 * Integration: memory_jobs repo — durable queue FSM, reconcile idempotency
 * with S7 D-REARM conflict semantics (completed→re-arm, running→wake_pending,
 * pending/failed→no-op, permanently_failed untouched), wake_pending
 * consumption on markCompleted, crash-recovery flag preservation (gate R1),
 * derived progress, atomic stale recovery, CHECK/uniqueness enforcement
 * (S1c + S7).
 *
 * Runs against the ephemeral pgvector container from `setup/globalSetup.ts`.
 * S1c does NOT embed — candidates use synthetic vectors (_s1c-fixtures).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { execute, query } from "@vex-agent/db/client.js";
import {
  enqueueConsolidateJob,
  enqueueReconcileJob,
  resetReconcileJob,
  claimNextDueJob,
  markFailed,
  markCompleted,
  bumpJobInference,
  getJobProgress,
  getJobById,
  listJobsByStatus,
  recoverStaleRunning,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import {
  reserveCandidatesForJob,
  markItemProcessing,
  markItemFailed,
  releaseItemsForJob,
  listItemsByJob,
} from "@vex-agent/db/repos/memory-job-items/index.js";
import { resetDb } from "../setup/fixtures.js";
import {
  makeSession,
  seedKnowledgeEntry,
  seedPendingCandidates,
} from "./_s1c-fixtures.js";

/** Drive a claimable job to permanently_failed via repeated claim+markFailed. */
async function exhaustAttempts(workerId: string): Promise<number> {
  let lastId = -1;
  for (let i = 0; i < 5; i++) {
    const job = await claimNextDueJob(workerId);
    if (!job) break;
    lastId = job.id;
    const res = await markFailed(job.id, workerId, "transient_error", 0);
    if (res.terminal) break;
  }
  return lastId;
}

describe("memory_jobs repo (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("enqueueConsolidateJob inserts a fresh pending consolidate job each call", async () => {
    const a = await enqueueConsolidateJob();
    const b = await enqueueConsolidateJob();
    expect(a.jobKind).toBe("consolidate");
    expect(a.status).toBe("pending");
    expect(a.reconcileEntryId).toBeNull();
    expect(a.reconcileOutcomeVersion).toBeNull();
    expect(a.attemptCount).toBe(0);
    expect(a.llmCallCount).toBe(0);
    expect(b.id).not.toBe(a.id); // no idempotency key — always a new row
  });

  it("claim race: two parallel claims of one pending job → exactly one wins", async () => {
    await enqueueConsolidateJob();
    const [a, b] = await Promise.all([
      claimNextDueJob("worker-A"),
      claimNextDueJob("worker-B"),
    ]);
    const claimed = [a, b].filter((j) => j !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.status).toBe("running");
    expect(claimed[0]!.attemptCount).toBe(1); // attempt incremented at claim
  });

  it("retry/permanent: markFailed retries with backoff then permanently_failed", async () => {
    await enqueueConsolidateJob();

    const j1 = await claimNextDueJob("w");
    expect(j1!.attemptCount).toBe(1);
    const r1 = await markFailed(j1!.id, "w", "transient_error", 0);
    expect(r1).toEqual({ ok: true, terminal: false });
    expect((await getJobById(j1!.id))!.status).toBe("failed");

    const j2 = await claimNextDueJob("w");
    expect(j2!.id).toBe(j1!.id);
    expect(j2!.attemptCount).toBe(2);
    await markFailed(j2!.id, "w", "transient_error", 0);

    const j3 = await claimNextDueJob("w");
    expect(j3!.attemptCount).toBe(3);
    const r3 = await markFailed(j3!.id, "w", "transient_error", 0);
    expect(r3).toEqual({ ok: true, terminal: true });
    expect((await getJobById(j1!.id))!.status).toBe("permanently_failed");

    // Exhausted (attempt_count >= max_attempts) → no longer claimable.
    expect(await claimNextDueJob("w")).toBeNull();
  });

  it("markFailed / markCompleted are owner-checked", async () => {
    await enqueueConsolidateJob();
    const job = await claimNextDueJob("owner");
    // Wrong worker cannot fail or complete the job.
    expect(await markFailed(job!.id, "intruder", "x", 0)).toEqual({ ok: false, terminal: false });
    expect(await markCompleted(job!.id, "intruder")).toBe(false);
    // Owner can complete it.
    expect(await markCompleted(job!.id, "owner")).toBe(true);
    expect((await getJobById(job!.id))!.status).toBe("completed");
  });

  it("enqueueReconcileJob: pending / failed rows are no-ops (the queued run reads the post-wake ledger anyway)", async () => {
    const entryId = await seedKnowledgeEntry("reconcile");
    const first = await enqueueReconcileJob(entryId, 2);
    expect(first.inserted).toBe(true);
    expect(first.job.jobKind).toBe("reconcile");
    expect(first.job.reconcileEntryId).toBe(entryId);
    expect(first.job.reconcileOutcomeVersion).toBe(2);
    expect(first.job.wakePending).toBe(false);

    const second = await enqueueReconcileJob(entryId, 2);
    expect(second.inserted).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.status).toBe("pending");
    expect(second.job.wakePending).toBe(false);

    // Drive the row into `failed` with a custom backoff/attempt, then re-enqueue:
    // the conflict path must NOT erase the retry/backoff (D-REARM: failed = no-op).
    await execute(
      `UPDATE memory_jobs SET status='failed', attempt_count=2,
         next_attempt_at = NOW() + interval '1 hour', last_error='boom' WHERE id=$1`,
      [first.job.id],
    );
    const third = await enqueueReconcileJob(entryId, 2);
    expect(third.inserted).toBe(false);
    expect(third.job.status).toBe("failed");
    expect(third.job.attemptCount).toBe(2);
    expect(third.job.lastError).toBe("boom");
    expect(third.job.wakePending).toBe(false);

    // Only ONE reconcile row exists for (entry, v) — across all statuses.
    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_jobs WHERE reconcile_entry_id=$1 AND reconcile_outcome_version=2",
      [entryId],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("enqueueReconcileJob: completed → RE-ARM (fresh pending run on a same-version wake)", async () => {
    const entryId = await seedKnowledgeEntry("rearm");
    const { job } = await enqueueReconcileJob(entryId, 0);
    const claimed = await claimNextDueJob("w");
    expect(claimed!.id).toBe(job.id);
    expect(await markCompleted(job.id, "w")).toBe(true);
    expect((await getJobById(job.id))!.status).toBe("completed");

    const rearmed = await enqueueReconcileJob(entryId, 0);
    expect(rearmed.inserted).toBe(false); // conflict path, not a new row
    expect(rearmed.job.id).toBe(job.id);
    expect(rearmed.job.status).toBe("pending");
    expect(rearmed.job.attemptCount).toBe(0);
    expect(rearmed.job.completedAt).toBeNull();
    expect(rearmed.job.wakePending).toBe(false);

    // The re-armed job is claimable again (still ONE row for the key).
    const reclaimed = await claimNextDueJob("w");
    expect(reclaimed!.id).toBe(job.id);
  });

  it("enqueueReconcileJob: running → wake_pending flag; markCompleted CONSUMES it into one more pending pass", async () => {
    const entryId = await seedKnowledgeEntry("wake-flag");
    const { job } = await enqueueReconcileJob(entryId, 0);
    const claimed = await claimNextDueJob("w");
    expect(claimed!.id).toBe(job.id);

    // A wake landing WHILE running raises the flag without touching the run.
    const flagged = await enqueueReconcileJob(entryId, 0);
    expect(flagged.inserted).toBe(false);
    expect(flagged.job.status).toBe("running");
    expect(flagged.job.wakePending).toBe(true);

    // Completion consumes the flag: pending + attempt 0, NOT completed.
    expect(await markCompleted(job.id, "w")).toBe(true);
    const after = await getJobById(job.id);
    expect(after!.status).toBe("pending");
    expect(after!.attemptCount).toBe(0);
    expect(after!.completedAt).toBeNull();
    expect(after!.wakePending).toBe(false);

    // The second pass runs against the post-wake ledger and completes normally.
    const second = await claimNextDueJob("w");
    expect(second!.id).toBe(job.id);
    expect(await markCompleted(second!.id, "w")).toBe(true);
    expect((await getJobById(job.id))!.status).toBe("completed");
  });

  it("enqueueReconcileJob: permanently_failed is untouched by a wake (resetReconcileJob is the ONLY revive)", async () => {
    const entryId = await seedKnowledgeEntry("permfail-wake");
    await enqueueReconcileJob(entryId, 1);
    const id = await exhaustAttempts("w");
    expect((await getJobById(id))!.status).toBe("permanently_failed");

    const res = await enqueueReconcileJob(entryId, 1);
    expect(res.inserted).toBe(false);
    expect(res.job.id).toBe(id);
    expect(res.job.status).toBe("permanently_failed");
    expect(res.job.wakePending).toBe(false);
  });

  it("recoverStaleRunning PRESERVES wake_pending (S7 gate R1 — the signal survives a worker crash)", async () => {
    const entryId = await seedKnowledgeEntry("wake-recover");
    const { job } = await enqueueReconcileJob(entryId, 0);
    await claimNextDueJob("w");
    await enqueueReconcileJob(entryId, 0); // wake during running → flag
    expect((await getJobById(job.id))!.wakePending).toBe(true);

    await execute(
      "UPDATE memory_jobs SET heartbeat_at = NOW() - interval '10 minutes' WHERE id=$1",
      [job.id],
    );
    const recovered = await recoverStaleRunning(1000);
    expect(recovered.jobsReset).toBe(1);

    const after = await getJobById(job.id);
    expect(after!.status).toBe("pending");
    expect(after!.wakePending).toBe(true); // NOT cleaned up by recovery
  });

  it("enqueueReconcileJob is race-safe under two concurrent same-key inserts (one row, neither throws)", async () => {
    const entryId = await seedKnowledgeEntry("recon-race");
    const [a, b] = await Promise.all([
      enqueueReconcileJob(entryId, 5),
      enqueueReconcileJob(entryId, 5),
    ]);
    // Neither threw; both reference the same row; exactly one observed the fresh insert.
    expect(a.job.id).toBe(b.job.id);
    expect([a.inserted, b.inserted].filter(Boolean).length).toBe(1);
    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_jobs WHERE reconcile_entry_id=$1 AND reconcile_outcome_version=5",
      [entryId],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("resetReconcileJob resets ONLY a permanently_failed reconcile (full reset)", async () => {
    const entryId = await seedKnowledgeEntry("reset");
    await enqueueReconcileJob(entryId, 1);

    // A pending reconcile is NOT resettable.
    const early = await resetReconcileJob(entryId, 1);
    expect(early).toEqual({ ok: false, reason: "not_permanently_failed" });

    // Drive it to permanently_failed, accumulate audit fields, then reset.
    const id = await exhaustAttempts("w");
    expect(id).toBeGreaterThan(0);
    await bumpJobInference(id, { llmCalls: 4, costUsd: 1.25 });
    expect((await getJobById(id))!.status).toBe("permanently_failed");

    const reset = await resetReconcileJob(entryId, 1);
    expect(reset.ok).toBe(true);
    if (!reset.ok) throw new Error("unreachable");
    expect(reset.job.status).toBe("pending");
    expect(reset.job.attemptCount).toBe(0);
    expect(reset.job.llmCallCount).toBe(0);
    expect(reset.job.costUsd).toBeNull();
    expect(reset.job.lastError).toBeNull();
    expect(reset.job.completedAt).toBeNull();
    expect(reset.job.wakePending).toBe(false); // FULL reset includes the S7 flag

    // A non-existent reconcile key → not_found.
    expect(await resetReconcileJob(99999, 0)).toEqual({ ok: false, reason: "not_found" });
  });

  it("bumpJobInference accumulates only llm_call_count + cost_usd", async () => {
    const job = await enqueueConsolidateJob();
    await bumpJobInference(job.id, { llmCalls: 1, costUsd: 0.5 });
    const after = await bumpJobInference(job.id, { llmCalls: 2, costUsd: 0.25 });
    expect(after!.llmCallCount).toBe(3);
    expect(after!.costUsd).toBeCloseTo(0.75, 4);
  });

  it("getJobProgress is DERIVED and never drifts on reserve→release→revive", async () => {
    const sid = await makeSession();
    await seedPendingCandidates(sid, 3, "prog");
    await enqueueConsolidateJob();
    const job = await claimNextDueJob("w");

    const r1 = await reserveCandidatesForJob(job!.id, "w", 10);
    expect(r1).toHaveLength(3);
    expect(await getJobProgress(job!.id)).toMatchObject({ reserved: 3, total: 3 });

    await releaseItemsForJob(job!.id);
    expect(await getJobProgress(job!.id)).toMatchObject({ released: 3, reserved: 0, total: 3 });

    // Revive own released items — still 3 ITEMS total, not 6 (no stored counter to drift).
    const r2 = await reserveCandidatesForJob(job!.id, "w", 10);
    expect(r2).toHaveLength(3);
    expect(await getJobProgress(job!.id)).toMatchObject({ reserved: 3, released: 0, total: 3 });
  });

  it("recoverStaleRunning resets a stale job to pending AND releases its reserved items in one transaction", async () => {
    const sid = await makeSession();
    const candIds = await seedPendingCandidates(sid, 2, "stale");
    await enqueueConsolidateJob();
    const job = await claimNextDueJob("w");
    await reserveCandidatesForJob(job!.id, "w", 10);
    await markItemProcessing(
      (await listItemsByJob(job!.id))[0]!.id,
      job!.id,
      "w",
    );

    // Make the heartbeat stale.
    await execute("UPDATE memory_jobs SET heartbeat_at = NOW() - interval '10 minutes' WHERE id=$1", [
      job!.id,
    ]);

    const recovered = await recoverStaleRunning(1000);
    expect(recovered.jobsReset).toBe(1);
    expect(recovered.itemsReleased).toBe(2);

    expect((await getJobById(job!.id))!.status).toBe("pending");
    const items = await listItemsByJob(job!.id);
    expect(items.every((i) => i.itemStatus === "released")).toBe(true);

    // Candidates re-enter the pool. The recovered job carries a backoff
    // (next_attempt_at in the future), so claim a FRESH job — it reserves both
    // released candidates (still pending, no active hold).
    const fresh = await enqueueConsolidateJob();
    const job2 = await claimNextDueJob("w");
    expect(job2!.id).toBe(fresh.id);
    const r = await reserveCandidatesForJob(job2!.id, "w", 10);
    expect(new Set(r)).toEqual(new Set(candIds));
  });

  it("recoverStaleRunning fails a stale FINAL-attempt job instead of stranding it as unclaimable pending", async () => {
    const job = await enqueueConsolidateJob();
    // A job that went stale on its LAST attempt: running, attempt_count == max_attempts.
    // Resetting it to pending would make it unclaimable (claim needs attempt < max) AND
    // unresettable (resetReconcileJob only touches permanently_failed) — i.e. stranded.
    await execute(
      `UPDATE memory_jobs SET status='running', attempt_count=max_attempts, locked_by='w',
         heartbeat_at = NOW() - interval '10 minutes' WHERE id=$1`,
      [job.id],
    );
    const recovered = await recoverStaleRunning(1000);
    expect(recovered.jobsFailed).toBe(1);
    expect(recovered.jobsReset).toBe(0);
    expect((await getJobById(job.id))!.status).toBe("permanently_failed");
  });

  it("listJobsByStatus filters and orders by created_at", async () => {
    await enqueueConsolidateJob();
    await enqueueConsolidateJob();
    const pending = await listJobsByStatus("pending", 10);
    expect(pending).toHaveLength(2);
    expect(pending.every((j) => j.status === "pending")).toBe(true);
    expect(await listJobsByStatus("pending", 0)).toEqual([]);
  });

  describe("CHECK / uniqueness enforcement", () => {
    it("rejects a consolidate job carrying reconcile fields (mj_reconcile_fields)", async () => {
      const entryId = await seedKnowledgeEntry("badconsolidate");
      await expect(
        execute(
          "INSERT INTO memory_jobs (job_kind, reconcile_entry_id) VALUES ('consolidate', $1)",
          [entryId],
        ),
      ).rejects.toThrow(/mj_reconcile_fields/);
    });

    it("rejects a reconcile job missing an outcome_version (mj_reconcile_fields)", async () => {
      const entryId = await seedKnowledgeEntry("badreconcile");
      await expect(
        execute(
          "INSERT INTO memory_jobs (job_kind, reconcile_entry_id) VALUES ('reconcile', $1)",
          [entryId],
        ),
      ).rejects.toThrow(/mj_reconcile_fields/);
    });

    it("enforces uniq_mj_reconcile across all statuses (raw second insert)", async () => {
      const entryId = await seedKnowledgeEntry("uniqr");
      await enqueueReconcileJob(entryId, 5);
      await expect(
        execute(
          "INSERT INTO memory_jobs (job_kind, reconcile_entry_id, reconcile_outcome_version, status) VALUES ('reconcile', $1, 5, 'completed')",
          [entryId],
        ),
      ).rejects.toThrow(/uniq_mj_reconcile/);
    });

    it("cascades reconcile jobs when the knowledge entry is deleted", async () => {
      const entryId = await seedKnowledgeEntry("cascade");
      const { job } = await enqueueReconcileJob(entryId, 0);
      await execute("DELETE FROM knowledge_entries WHERE id=$1", [entryId]);
      expect(await getJobById(job.id)).toBeNull();
    });
  });
});
