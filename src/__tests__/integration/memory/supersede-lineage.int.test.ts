/**
 * Integration (real testcontainers pgvector): WAVE 0, TEST 0.2 — real-DB
 * supersede end-to-end, DETERMINISTIC. The single biggest correctness hole today
 * is that supersede atomicity / lineage / the reverse-join supersededBy are
 * proven ONLY against a MOCK pg client. This file exercises the real
 * INSERT-successor + FLIP-predecessor in ONE tx, the partial unique index, the
 * getById reverse-join, the lineage CTE, the get-redirect tool, and the
 * superseded-never-recalled / never-in-hot-context invariants on REAL pg.
 *
 * Determinism: NO live judge, NO Gemma/OpenRouter dependency, NO live-quality
 * coupling. All vectors are SYNTHETIC dim-8 `test-model` vectors (`randVector`).
 * The supersede verdict is FORCE-DRIVEN — a fixed
 * `{ type:"supersede", previousKnowledgeId }` DecisionPlan is injected directly,
 * never produced by a model. (The integration globalSetup still probes the
 * embedding endpoint, so it must be reachable, but no test BODY embeds anything.)
 *
 * Path coverage (per Lead Dev):
 *   - At least ONE happy path drives a REAL reserved/processing item through the
 *     production `applyDecisionAtomically` tx (owner-check + apply + record) —
 *     scenarios A1 / NEVER-OVERWRITE / B1 / P5 / P6 / P8 use that path.
 *   - The rollback case (A2) and the rejection cases (A3 / A4) call
 *     `supersedeEntry` directly inside an explicit `withTransaction` where that
 *     makes the rollback / error assertion simpler.
 *
 * graph-v1.int.test.ts already pins P10 (predecessor edge retraction on
 * supersede) — NOT duplicated here.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query, withTransaction } from "@vex-agent/db/client.js";
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
import {
  getById,
  getActiveEntriesByIds,
  recallLongMemoryTopK,
  listActiveForHotContext,
  getLineageChain,
} from "@vex-agent/db/repos/knowledge.js";
import {
  supersedeEntry,
  SupersedeError,
} from "@vex-agent/db/repos/knowledge-lifecycle.js";
import { applyDecisionAtomically } from "@vex-agent/memory/manager/index.js";
import type { DecisionPlan } from "@vex-agent/memory/manager/promote.js";
import { handleLongMemoryGet } from "@vex-agent/tools/internal/long-memory/get.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { PROBATION_ACTIVATION } from "@vex-agent/engine/memory-manager/policy.js";
import { resetDb, randVector } from "../setup/fixtures.js";
import {
  makeSession,
  seedExecution,
  seedCandidate,
  hex64,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
} from "../repos/_s4-fixtures.js";

// ── Predecessor seeding (raw SQL → full control of source/maturity/TTL) ──

interface SeedPredecessorOpts {
  kind?: string;
  source?: string;
  maturityState?: string;
  /** `valid_until` (ISO) — FUTURE keeps it hot-context eligible (non-vacuous P8). */
  validUntil?: string | null;
  pinned?: boolean;
  vectorSeed?: string;
  contentMd?: string;
  status?: string;
}

/**
 * Seed ONE knowledge_entries row with explicit influence / bi-temporal state and
 * a synthetic dim-8 vector. Returns its serial id + the durable byte-fields the
 * never-overwrite assertion pins (content_md, content_hash, embedding literal).
 */
async function seedPredecessor(
  seed: string,
  opts: SeedPredecessorOpts = {},
): Promise<{ id: number; contentMd: string; contentHash: string; embeddingText: string }> {
  const kind = opts.kind ?? "risk_rule";
  const contentMd = opts.contentMd ?? `Predecessor body ${seed}: cap position size <= 10%.`;
  const contentHash = hex64(`pred-${seed}`);
  const vec = `[${randVector(EMBEDDING_DIM, opts.vectorSeed ?? `pred-${seed}`).join(",")}]`;
  const rows = await query<{ id: number; embedding: string }>(
    `INSERT INTO knowledge_entries
       (kind, title, summary, content_md, content_hash,
        embedding_model, embedding_dim, embedding,
        status, source, maturity_state, activation_strength,
        influence_scope, decay_policy, regime_tags,
        valid_until, pinned, first_promoted_at)
     VALUES ($1, $2, $3, $4, $5,
        $6, $7, $8::vector,
        $9, $10, $11, 1.0,
        'advisory', 'none', '{}',
        $12::timestamptz, $13, NOW())
     RETURNING id, embedding::text AS embedding`,
    [
      kind,
      `Predecessor ${seed}`,
      `Predecessor summary ${seed}`,
      contentMd,
      contentHash,
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
      vec,
      opts.status ?? "active",
      opts.source ?? "observed",
      opts.maturityState ?? "established",
      opts.validUntil ?? null,
      opts.pinned ?? false,
    ],
  );
  const row = rows[0]!;
  return { id: row.id, contentMd, contentHash, embeddingText: row.embedding };
}

/** Read the durable byte-fields of a row for the never-overwrite check. */
async function readByteFields(
  id: number,
): Promise<{ contentMd: string; contentHash: string; embeddingText: string }> {
  const rows = await query<{ content_md: string; content_hash: string; embedding: string }>(
    `SELECT content_md, content_hash, embedding::text AS embedding
       FROM knowledge_entries WHERE id = $1`,
    [id],
  );
  const r = rows[0]!;
  return { contentMd: r.content_md, contentHash: r.content_hash, embeddingText: r.embedding };
}

async function countSuccessorsOf(predId: number): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM knowledge_entries WHERE supersedes_id = $1`,
    [predId],
  );
  return Number(rows[0]!.n);
}

// ── Reserved/processing candidate → forced-plan apply driver ─────────

interface ReservedItem {
  candidateId: string;
  jobId: number;
  workerId: string;
  itemId: number;
}

/**
 * Seed ONE pending candidate (synthetic vector) and reserve+markProcessing it
 * under a fresh consolidate job — the precondition `applyDecisionAtomically`'s
 * owner-check requires. Returns the ids needed to drive the apply tx.
 */
async function reserveCandidate(args: {
  sessionId: string;
  seed: string;
  workerId: string;
  kind?: string;
  title?: string;
  summary?: string;
  contentMd?: string;
  vectorSeed?: string;
  executionIds?: number[];
}): Promise<ReservedItem> {
  const candidateId = await seedCandidate(args.sessionId, args.seed, {
    kind: args.kind,
    title: args.title,
    summary: args.summary,
    contentMd: args.contentMd,
    vectorSeed: args.vectorSeed,
    executionIds: args.executionIds ?? [],
  });
  await enqueueConsolidateJob();
  const job = await claimNextDueJob(args.workerId);
  if (!job) throw new Error("reserveCandidate: no job claimed");
  await reserveCandidatesForJob(job.id, args.workerId, 16);
  const item = (await listItemsByJob(job.id, "reserved")).find(
    (i) => i.candidateId === candidateId,
  );
  if (!item) throw new Error("reserveCandidate: candidate not reserved");
  const ok = await markItemProcessing(item.id, job.id, args.workerId);
  if (!ok) throw new Error("reserveCandidate: markItemProcessing failed");
  return { candidateId, jobId: job.id, workerId: args.workerId, itemId: item.id };
}

/**
 * Force-drive ONE supersede through the PRODUCTION apply tx: a fixed
 * `{ type:"supersede", previousKnowledgeId }` plan applied via
 * `applyDecisionAtomically` against the reserved/processing item, then close it.
 * Returns the new successor knowledge id.
 */
async function forceSupersedeViaApply(
  reserved: ReservedItem,
  previousKnowledgeId: number,
): Promise<number> {
  const candidate = await getCandidateById(reserved.candidateId);
  if (!candidate) throw new Error("forceSupersedeViaApply: candidate missing");
  const embedding = await getCandidateEmbedding(reserved.candidateId);
  if (!embedding) throw new Error("forceSupersedeViaApply: embedding missing");

  const plan: DecisionPlan = {
    type: "supersede",
    previousKnowledgeId,
    sourceTier: "observed",
    regimeTags: ["bull"],
    inferenceProvider: null,
    inferenceModel: null,
    costUsd: null,
  };

  const applied = await applyDecisionAtomically({
    candidate,
    plan,
    jobId: reserved.jobId,
    workerId: reserved.workerId,
  });
  expect(applied.decisionType).toBe("supersede");
  await markItemDone(reserved.itemId, reserved.jobId, reserved.workerId, applied.decisionId);

  const after = await getCandidateById(reserved.candidateId);
  if (!after?.promotedKnowledgeId) throw new Error("forceSupersedeViaApply: no successor id");
  return after.promotedKnowledgeId;
}

/** A bare InternalToolContext stub sufficient for handleLongMemoryGet. */
function toolCtx(): InternalToolContext {
  return { loadedDocuments: new Map<string, string>() } as unknown as InternalToolContext;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("supersede lineage end-to-end (integration, deterministic)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // ── A1 + NEVER-OVERWRITE — same-tx flip via the production apply path ──
  it("A1: supersede flips the predecessor in the same tx and NEVER overwrites it", async () => {
    const session = await makeSession();
    const pred = await seedPredecessor("a1", {
      kind: "risk_rule",
      maturityState: "established",
      source: "observed",
      vectorSeed: "a1-shared",
    });
    const byteBefore = await readByteFields(pred.id);

    const reserved = await reserveCandidate({
      sessionId: session,
      seed: "a1",
      workerId: "w-a1",
      kind: "risk_rule",
      title: "Lesson a1: cap position size <= 5%",
      summary: "Tighter cap after a drawdown.",
      contentMd: "Cap 5 percent, not 10.",
      vectorSeed: "a1-shared",
    });
    const succId = await forceSupersedeViaApply(reserved, pred.id);

    // Predecessor flipped to superseded, pointing FORWARD to the successor.
    const predAfter = await getById(pred.id);
    expect(predAfter!.status).toBe("superseded");
    expect(predAfter!.supersededBy).toBe(succId);

    // Successor is the active head, pointing BACK to the predecessor.
    const succAfter = await getById(succId);
    expect(succAfter!.status).toBe("active");
    expect(succAfter!.supersedesId).toBe(pred.id);

    // Exactly one successor (single-successor lineage / partial unique index).
    expect(await countSuccessorsOf(pred.id)).toBe(1);

    // NEVER-OVERWRITE: the predecessor's durable body is byte-identical — only
    // status / supersededBy changed. content_md, content_hash, embedding are all
    // unchanged. This is the core "supersede never overwrites" safety property.
    const byteAfter = await readByteFields(pred.id);
    expect(byteAfter.contentMd).toBe(byteBefore.contentMd);
    expect(byteAfter.contentHash).toBe(byteBefore.contentHash);
    expect(byteAfter.embeddingText).toBe(byteBefore.embeddingText);
    expect(byteAfter.contentHash).toBe(pred.contentHash);
  });

  // ── P5 — successor is born probationary / advisory / valid_from honored ──
  it("P5: the successor is probationary + advisory + PROBATION_ACTIVATION", async () => {
    const session = await makeSession();
    const pred = await seedPredecessor("p5", { vectorSeed: "p5-shared" });
    const reserved = await reserveCandidate({
      sessionId: session,
      seed: "p5",
      workerId: "w-p5",
      kind: "risk_rule",
      title: "Lesson p5: cap 4%",
      summary: "p5 summary",
      contentMd: "p5 body distinct",
      vectorSeed: "p5-shared",
    });
    const succId = await forceSupersedeViaApply(reserved, pred.id);

    const succ = await getById(succId);
    expect(succ!.maturityState).toBe("probationary");
    expect(succ!.influenceScope).toBe("advisory");
    expect(succ!.activationStrength).toBe(PROBATION_ACTIVATION);
    // No outcome boundary was forced on this non-trade kind → valid_from is the
    // DB ingestion default (NOW()), and the row IS valid (a real timestamp).
    expect(succ!.validFrom).not.toBeNull();
  });

  // ── A2 — atomicity rollback: the two writes are one tx ──
  it("A2: a thrown tx rolls BOTH writes back — predecessor stays active, no successor", async () => {
    const pred = await seedPredecessor("a2", { vectorSeed: "a2-shared" });

    // Run supersedeEntry inside a tx that then throws → the whole tx rolls back.
    const boom = new Error("forced rollback after supersede");
    await expect(
      withTransaction(async (tx) => {
        await supersedeEntry(
          {
            previousId: pred.id,
            reason: "superseded_by_candidate",
            kind: "risk_rule",
            title: "A2 successor",
            summary: "A2 successor summary",
            contentMd: "A2 successor body distinct",
            tags: [],
            sourceRefs: {},
            confidence: null,
            pinned: false,
            validUntil: null,
            contentHash: hex64("a2-successor"),
            embeddingModel: EMBEDDING_MODEL,
            embeddingDim: EMBEDDING_DIM,
            embedding: randVector(EMBEDDING_DIM, "a2-successor"),
            source: "observed",
            maturityState: "probationary",
            activationStrength: PROBATION_ACTIVATION,
            influenceScope: "advisory",
            decayPolicy: "none",
            regimeTags: [],
            firstPromotedAt: new Date(),
          },
          tx,
        );
        // The successor INSERT + predecessor UPDATE both ran; now abort.
        throw boom;
      }),
    ).rejects.toBe(boom);

    // After rollback: predecessor STILL active, NO successor row exists.
    const predAfter = await getById(pred.id);
    expect(predAfter!.status).toBe("active");
    expect(predAfter!.supersededBy).toBeNull();
    expect(await countSuccessorsOf(pred.id)).toBe(0);
  });

  // ── A3 — a second supersede of the same predecessor rejects ──
  it("A3: a second supersede of the same predecessor throws predecessor_already_superseded", async () => {
    const session = await makeSession();
    const pred = await seedPredecessor("a3", { vectorSeed: "a3-shared" });
    const reserved = await reserveCandidate({
      sessionId: session,
      seed: "a3",
      workerId: "w-a3",
      kind: "risk_rule",
      title: "A3 successor 1",
      summary: "s",
      contentMd: "A3 successor 1 body",
      vectorSeed: "a3-shared",
    });
    const succ1 = await forceSupersedeViaApply(reserved, pred.id);

    // A SECOND supersede of the now-superseded predecessor must be refused.
    let caught: unknown;
    try {
      await supersedeEntry({
        previousId: pred.id,
        reason: "superseded_by_candidate",
        kind: "risk_rule",
        title: "A3 successor 2",
        summary: "s2",
        contentMd: "A3 successor 2 body distinct",
        tags: [],
        sourceRefs: {},
        confidence: null,
        pinned: false,
        validUntil: null,
        contentHash: hex64("a3-successor-2"),
        embeddingModel: EMBEDDING_MODEL,
        embeddingDim: EMBEDDING_DIM,
        embedding: randVector(EMBEDDING_DIM, "a3-successor-2"),
        source: "observed",
        maturityState: "probationary",
        activationStrength: PROBATION_ACTIVATION,
        influenceScope: "advisory",
        decayPolicy: "none",
        regimeTags: [],
        firstPromotedAt: new Date(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SupersedeError);
    const se = caught as SupersedeError;
    expect(se.code).toBe("predecessor_already_superseded");
    // The error points at the existing successor.
    expect(se.details.supersededBy).toBe(succ1);

    // Still exactly ONE successor — no second active head / lineage fork.
    expect(await countSuccessorsOf(pred.id)).toBe(1);
  });

  // ── A4 — supersede of a non-active predecessor rejects ──
  it("A4: superseding an already-invalidated predecessor throws predecessor_not_active", async () => {
    const pred = await seedPredecessor("a4", { status: "invalidated", vectorSeed: "a4-shared" });

    let caught: unknown;
    try {
      await supersedeEntry({
        previousId: pred.id,
        reason: "superseded_by_candidate",
        kind: "risk_rule",
        title: "A4 successor",
        summary: "s",
        contentMd: "A4 successor body distinct",
        tags: [],
        sourceRefs: {},
        confidence: null,
        pinned: false,
        validUntil: null,
        contentHash: hex64("a4-successor"),
        embeddingModel: EMBEDDING_MODEL,
        embeddingDim: EMBEDDING_DIM,
        embedding: randVector(EMBEDDING_DIM, "a4-successor"),
        source: "observed",
        maturityState: "probationary",
        activationStrength: PROBATION_ACTIVATION,
        influenceScope: "advisory",
        decayPolicy: "none",
        regimeTags: [],
        firstPromotedAt: new Date(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SupersedeError);
    expect((caught as SupersedeError).code).toBe("predecessor_not_active");
    // No successor was forked off the inactive row.
    expect(await countSuccessorsOf(pred.id)).toBe(0);
  });

  // ── B1 — 3-hop chain A→B→C: order, head=active, exactly one active ──
  it("B1: a 3-hop chain returns [A,B,C] root→head from any node; only the head is active", async () => {
    const session = await makeSession();
    const a = await seedPredecessor("b1-a", { vectorSeed: "b1" });

    // A → B
    const rB = await reserveCandidate({
      sessionId: session,
      seed: "b1-b",
      workerId: "w-b1-b",
      kind: "risk_rule",
      title: "B1 B: cap 8%",
      summary: "B",
      contentMd: "B1 successor B body",
      vectorSeed: "b1",
    });
    const b = await forceSupersedeViaApply(rB, a.id);

    // B → C
    const rC = await reserveCandidate({
      sessionId: session,
      seed: "b1-c",
      workerId: "w-b1-c",
      kind: "risk_rule",
      title: "B1 C: cap 6%",
      summary: "C",
      contentMd: "B1 successor C body",
      vectorSeed: "b1",
    });
    const c = await forceSupersedeViaApply(rC, b);

    for (const queriedFrom of [a.id, b, c]) {
      const chain = await getLineageChain(queriedFrom);
      expect(chain).not.toBeNull();
      expect(chain!.chain.map((n) => n.id)).toEqual([a.id, b, c]); // root → head
      expect(chain!.headId).toBe(c);
      expect(chain!.headStatus).toBe("active");
      expect(chain!.requestedId).toBe(queriedFrom);
      const active = chain!.chain.filter((n) => n.status === "active");
      expect(active.map((n) => n.id)).toEqual([c]); // exactly ONE active node = head
      const superseded = chain!.chain.filter((n) => n.status === "superseded").map((n) => n.id);
      expect(superseded.sort()).toEqual([a.id, b].sort());
    }
  });

  // ── P6 — long_memory_get on a superseded predecessor redirects to the successor ──
  it("P6: long_memory_get on the superseded predecessor fails with a redirect to the successor", async () => {
    const session = await makeSession();
    const pred = await seedPredecessor("p6", { vectorSeed: "p6-shared" });
    const reserved = await reserveCandidate({
      sessionId: session,
      seed: "p6",
      workerId: "w-p6",
      kind: "risk_rule",
      title: "P6 successor",
      summary: "s",
      contentMd: "P6 successor body distinct",
      vectorSeed: "p6-shared",
    });
    const succId = await forceSupersedeViaApply(reserved, pred.id);

    const ctx = toolCtx();
    const res = await handleLongMemoryGet({ id: pred.id }, ctx);
    expect(res.success).toBe(false);
    // The steering message (ToolResult.output) names the live successor id.
    expect(res.output).toContain(`entry ${succId}`);
    // No content_md for the superseded predecessor was injected.
    expect(ctx.loadedDocuments.has(`long_memory:${pred.id}`)).toBe(false);

    // The active successor fetches normally and injects its body.
    const okRes = await handleLongMemoryGet({ id: succId }, ctx);
    expect(okRes.success).toBe(true);
    expect(ctx.loadedDocuments.has(`long_memory:${succId}`)).toBe(true);
  });

  // ── P8 — a superseded predecessor never surfaces in recall or hot-context ──
  it("P8: after supersede A→B, A is excluded from recall, getActiveEntriesByIds, and hot-context (NON-vacuously)", async () => {
    const session = await makeSession();
    // CRITICAL non-vacuity (Lead Dev): seed the predecessor observed + established
    // + valid_until in the FUTURE so it WOULD be hot-context eligible if active —
    // otherwise the known F1 null-TTL hot-list bug makes the exclusion vacuous.
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString();
    const pred = await seedPredecessor("p8", {
      kind: "risk_rule",
      source: "observed",
      maturityState: "established",
      validUntil: future,
      vectorSeed: "p8-shared",
    });

    // A CONTROL active entry in the same model/dim/neighborhood that MUST be
    // recalled — proves the recall filter isn't silently returning empty (which
    // would make the A-exclusion pass vacuously). Same vectorSeed → cosine 0.
    const control = await seedPredecessor("p8-control", {
      kind: "risk_rule",
      source: "observed",
      maturityState: "established",
      validUntil: future,
      vectorSeed: "p8-shared",
    });

    // Sanity: BEFORE supersede, A is hot-context eligible (non-vacuity guard).
    const hotBefore = await listActiveForHotContext({ limit: 50 });
    expect(hotBefore.map((h) => h.id)).toContain(pred.id);

    const reserved = await reserveCandidate({
      sessionId: session,
      seed: "p8",
      workerId: "w-p8",
      kind: "risk_rule",
      title: "P8 successor: cap 5%",
      summary: "s",
      contentMd: "P8 successor body distinct",
      vectorSeed: "p8-shared", // successor shares the neighborhood → recallable
    });
    const succId = await forceSupersedeViaApply(reserved, pred.id);

    const qvec = randVector(EMBEDDING_DIM, "p8-shared");
    const recalled = await recallLongMemoryTopK(
      qvec,
      { embeddingModel: EMBEDDING_MODEL, embeddingDim: EMBEDDING_DIM, includeExpired: false },
      20,
    );
    const recalledIds = recalled.map((r) => r.id);
    // NON-vacuous: the control AND the active successor ARE recalled…
    expect(recalledIds).toContain(control.id);
    expect(recalledIds).toContain(succId);
    // …but the superseded predecessor A is NOT.
    expect(recalledIds).not.toContain(pred.id);

    // getActiveEntriesByIds excludes the superseded predecessor, keeps the rest.
    const active = await getActiveEntriesByIds([pred.id, succId, control.id]);
    const activeIds = active.map((e) => e.id);
    expect(activeIds).not.toContain(pred.id);
    expect(activeIds).toContain(succId);
    expect(activeIds).toContain(control.id);

    // Hot-context: A is gone (superseded). The control (established, observed,
    // future TTL) STILL appears → proves the exclusion is about A's status, not a
    // blanket empty list. The probationary successor is correctly NOT hot yet.
    const hotAfter = await listActiveForHotContext({ limit: 50 });
    const hotIds = hotAfter.map((h) => h.id);
    expect(hotIds).not.toContain(pred.id);
    expect(hotIds).toContain(control.id);
    expect(hotIds).not.toContain(succId); // probationary → excluded (P5 cross-check)
  });
});
