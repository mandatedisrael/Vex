/**
 * Integration (real pgvector): the S6a reinforcement seam end-to-end. A candidate
 * that DUPLICATES an existing ACTIVE knowledge entry is a 2nd confirmation →
 * `consolidateCandidate` resolves a reinforcement target → `applyDecisionAtomically`
 * reinforces that entry (activation↑, maturity advance) in the SAME tx as the
 * duplicate-reject decision, and audits it.
 *
 * Two paths:
 *   - D4 exact content-hash dup → reinforce resolved by `findActiveByContentHash`;
 *   - D5 near-dup (high cosine, no differing number) → reinforce by the matched id.
 *
 * The deterministic gate produces the reject; no judge call happens.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import {
  consolidateCandidate,
  applyDecisionAtomically,
  getCandidateById,
  getCandidateEmbedding,
} from "@vex-agent/memory/manager/index.js";
import { getMaturityEventsForEntry } from "@vex-agent/db/repos/knowledge-maturity-events/index.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import {
  claimNextDueJob,
  enqueueConsolidateJob,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import {
  reserveCandidatesForJob,
  listItemsByJob,
  markItemProcessing,
  markItemDone,
} from "@vex-agent/db/repos/memory-job-items/index.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { resetDb, randVector } from "../setup/fixtures.js";
import { makeSession, seedCandidate, depsWithStubJudge, PROMOTE_VERDICT, EMBEDDING_DIM, EMBEDDING_MODEL } from "../repos/_s4-fixtures.js";

const KIND = "strategy_lesson";
const TITLE = "Lesson dup: scale into strength on confirmed momentum";
const SUMMARY = "Durable pre-decision lesson with no live values.";
const CONTENT = "Process narrative only.";

/** Seed an ACTIVE established entry whose content_hash matches the seedCandidate default text. */
async function seedActiveEntry(seed: string, vectorSeed: string): Promise<number> {
  const contentHash = computeContentHash({ kind: KIND, title: TITLE, summary: SUMMARY, contentMd: CONTENT });
  const rows = await query<{ id: number }>(
    `INSERT INTO knowledge_entries
       (kind, title, summary, content_md, content_hash, embedding_model, embedding_dim, embedding,
        source, maturity_state, activation_strength, decay_policy, last_reinforced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector,
        'observed', 'established', 0.6, 'regime_aware', '2026-01-01T00:00:00Z')
     RETURNING id`,
    [
      KIND, TITLE, SUMMARY, CONTENT, contentHash,
      EMBEDDING_MODEL, EMBEDDING_DIM,
      `[${randVector(EMBEDDING_DIM, vectorSeed).join(",")}]`,
    ],
  );
  return rows[0]!.id;
}

async function reserveAndProcess(candidateId: string): Promise<{ jobId: number; workerId: string; itemId: number }> {
  await enqueueConsolidateJob();
  const workerId = "w-reinf";
  const job = await claimNextDueJob(workerId);
  if (!job) throw new Error("no job");
  await reserveCandidatesForJob(job.id, workerId, 16);
  const item = (await listItemsByJob(job.id, "reserved")).find((i) => i.candidateId === candidateId);
  if (!item) throw new Error("candidate not reserved");
  await markItemProcessing(item.id, job.id, workerId);
  return { jobId: job.id, workerId, itemId: item.id };
}

describe("S6a reinforcement seam (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("an exact-dup candidate reinforces the active entry it confirms (D4) and audits it", async () => {
    const session = await makeSession();
    // The active entry and the candidate share content_hash + vector neighborhood.
    const entryId = await seedActiveEntry("dup", "shared-dup");
    const candidateId = await seedCandidate(session, "dup", { vectorSeed: "shared-dup" });

    const { jobId, workerId, itemId } = await reserveAndProcess(candidateId);
    const candidate = await getCandidateById(candidateId);
    const embedding = await getCandidateEmbedding(candidateId);

    const decision = await consolidateCandidate(candidate!, embedding!, depsWithStubJudge(PROMOTE_VERDICT));
    expect(decision.plan).toMatchObject({ type: "reject", reason: "duplicate" });
    expect(decision.reinforce).not.toBeNull();

    const applied = await applyDecisionAtomically({
      candidate: candidate!,
      plan: decision.plan,
      jobId,
      workerId,
      reinforce: decision.reinforce,
    });
    await markItemDone(itemId, jobId, workerId, applied.decisionId);

    // The active entry was reinforced: activation↑ (0.6 + step capped), maturity advanced.
    const entry = await knowledgeRepo.getById(entryId);
    expect(entry!.activationStrength).toBeGreaterThan(0.6);
    expect(entry!.maturityState).toBe("reinforced"); // established → reinforced

    const history = await getMaturityEventsForEntry(entryId);
    expect(history).toHaveLength(1);
    expect(history[0]!.event).toBe("matured");
    expect(history[0]!.reasonCode).toBe("recurrence_confirmation");
    expect(history[0]!.triggerRefs).toEqual({ candidateId });

    // The candidate itself is recorded as a duplicate reject (not promoted).
    const after = await getCandidateById(candidateId);
    expect(after!.status).toBe("rejected");
  });
});
