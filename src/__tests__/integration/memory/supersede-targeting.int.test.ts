/**
 * F7: a steered judge can retire ANY active entry of ANY kind. This test pins
 * the gap — FLIP it to assert-REFUSED the day a same-kind / nearDupTopK guard
 * lands in planFromVerdict / supersede.
 *
 * ----------------------------------------------------------------------------
 * WAVE 0, TEST 0.3 — F7 adversarial cross-kind / arbitrary-target supersede
 * (integration, DETERMINISTIC CHARACTERIZATION gate).
 *
 * THE central adversarial concern (owner-flagged): the judge's
 * `previousKnowledgeId` is essentially UNCONSTRAINED. `planFromVerdict`
 * (consolidate.ts) takes `verdict.previousKnowledgeId ?? conflictKnowledgeId`
 * with NO check that the id is the same KIND, in the near-dup top-K, above any
 * cosine threshold, or even semantically related. `runSupersedeStatements` only
 * enforces (a) predecessor exists, (b) status='active', (c) content_hash
 * differs, (d) no existing successor. NET: a steered/poisoned judge can retire
 * ANY active entry of ANY kind by emitting its id.
 *
 * This is a CHARACTERIZATION gate: it asserts the current KNOWN-BAD behavior
 * SUCCEEDS — green by asserting what-IS. The test NAME is the durable finding
 * tracker (no recordFinding — the eval report-card is eval-lane-only; using it
 * from integration/memory would leave stale sidecar state). When a guard lands
 * (require same-kind OR cosine ≥ CONFLICT_COSINE OR previousKnowledgeId ∈
 * nearDupTopK ids), flip the assertions below to expect a refusal / downgrade.
 *
 * Determinism: synthetic dim-8 `test-model` vectors, NO judge — the supersede
 * verdict is force-driven via a fixed `{ type:"supersede", previousKnowledgeId }`
 * DecisionPlan applied through the production `applyDecisionAtomically` tx.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import {
  enqueueConsolidateJob,
  claimNextDueJob,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import {
  reserveCandidatesForJob,
  listItemsByJob,
  markItemProcessing,
  markItemDone,
} from "@vex-agent/db/repos/memory-job-items/index.js";
import {
  getCandidateById,
  getCandidateEmbedding,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { getById } from "@vex-agent/db/repos/knowledge.js";
import { applyDecisionAtomically } from "@vex-agent/memory/manager/index.js";
import type { DecisionPlan } from "@vex-agent/memory/manager/promote.js";
import { resetDb, randVector } from "../setup/fixtures.js";
import {
  makeSession,
  seedCandidate,
  hex64,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
} from "../repos/_s4-fixtures.js";

/** Seed ONE active knowledge entry of an arbitrary kind with a synthetic vector. */
async function seedActiveEntry(seed: string, kind: string): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO knowledge_entries
       (kind, title, summary, content_md, content_hash,
        embedding_model, embedding_dim, embedding,
        status, source, maturity_state, activation_strength,
        influence_scope, decay_policy, regime_tags, first_promoted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector,
        'active', 'observed', 'established', 1.0,
        'advisory', 'none', '{}', NOW())
     RETURNING id`,
    [
      kind,
      `Entry ${seed}`,
      `Entry summary ${seed}`,
      `Entry body ${seed}`,
      hex64(`f7-${seed}`),
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
      // Deliberately a DISTANT vector seed per entry — the F7 target is NOT in
      // any near-dup neighborhood; the point is that the supersede ignores that.
      `[${randVector(EMBEDDING_DIM, `f7-vec-${seed}`).join(",")}]`,
    ],
  );
  return rows[0]!.id;
}

describe("F7 — cross-kind / arbitrary-target supersede (characterization: pins the gap)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a risk_rule candidate force-superseding an UNRELATED market_note SUCCEEDS today (no kind/cosine/nearDup guard)", async () => {
    const session = await makeSession();

    // Two unrelated active entries of DIFFERENT kinds, cosine-distant from the
    // candidate and from each other.
    const riskRuleId = await seedActiveEntry("riskrule", "risk_rule");
    const marketNoteId = await seedActiveEntry("marketnote", "market_note");

    // A risk_rule candidate. Its content/vector have NOTHING to do with the
    // market_note — it is NOT in any nearDupTopK of the target.
    const candidateId = await seedCandidate(session, "f7", {
      kind: "risk_rule",
      title: "F7 candidate: cap position size <= 5%",
      summary: "An unrelated risk rule.",
      contentMd: "Risk rule body, unrelated to any market note.",
      vectorSeed: "f7-candidate",
    });

    // Reserve + markProcessing under a real consolidate job (owner-check precond).
    const workerId = "w-f7";
    await enqueueConsolidateJob();
    const job = await claimNextDueJob(workerId);
    if (!job) throw new Error("F7: no job claimed");
    await reserveCandidatesForJob(job.id, workerId, 16);
    const item = (await listItemsByJob(job.id, "reserved")).find(
      (i) => i.candidateId === candidateId,
    );
    if (!item) throw new Error("F7: candidate not reserved");
    if (!(await markItemProcessing(item.id, job.id, workerId))) {
      throw new Error("F7: markItemProcessing failed");
    }

    const candidate = await getCandidateById(candidateId);
    const embedding = await getCandidateEmbedding(candidateId);
    if (!candidate || !embedding) throw new Error("F7: candidate/embedding missing");

    // STEERED plan: the target is the market_note — a DIFFERENT kind, unrelated,
    // NOT in nearDupTopK. This is the poisoned-judge shape (judge emits an
    // arbitrary previousKnowledgeId).
    const steeredPlan: DecisionPlan = {
      type: "supersede",
      previousKnowledgeId: marketNoteId,
      sourceTier: "observed",
      regimeTags: ["bull"],
      inferenceProvider: null,
      inferenceModel: null,
      costUsd: null,
    };

    const applied = await applyDecisionAtomically({
      candidate,
      plan: steeredPlan,
      jobId: job.id,
      workerId,
    });
    await markItemDone(item.id, job.id, workerId, applied.decisionId);

    // ── CHARACTERIZATION: the unsafe supersede SUCCEEDED ──
    // (FLIP this block to expect a refusal/downgrade once a guard lands.)
    expect(applied.decisionType).toBe("supersede");

    const after = await getCandidateById(candidateId);
    const successorId = after!.promotedKnowledgeId!;

    // The cross-kind market_note was retired by a risk_rule successor.
    const marketNote = await getById(marketNoteId);
    expect(marketNote!.status).toBe("superseded");
    expect(marketNote!.supersededBy).toBe(successorId);

    const successor = await getById(successorId);
    expect(successor!.status).toBe("active");
    expect(successor!.kind).toBe("risk_rule"); // a risk_rule now "supersedes" a market_note
    expect(successor!.supersedesId).toBe(marketNoteId);

    // The UNRELATED risk_rule entry was untouched — only the explicitly targeted
    // (wrong-kind) entry was retired. This pins that the ONLY constraints are:
    // active + content-differs + single-successor — NO kind / cosine / nearDup
    // check exists anywhere in the path.
    const otherRiskRule = await getById(riskRuleId);
    expect(otherRiskRule!.status).toBe("active");
    expect(otherRiskRule!.supersededBy).toBeNull();
  });
});
