/**
 * Integration: findLatestCandidateByContentHash (S2 loop-prevention query).
 *
 * Runs against the ephemeral pgvector container from `setup/globalSetup.ts`.
 * S2's loop-prevention needs a check BEYOND the live pending row: the partial
 * unique index only dedupes against a `pending` candidate, so a hash that
 * already reached a terminal status must still block a re-suggest. This suite
 * proves the query returns the newest row across statuses and that a terminal
 * (e.g. promoted) hash is observable to the boundary.
 *
 * Synthetic vectors via `randVector` — no embeddings endpoint is touched.
 */

import { createHash } from "node:crypto";

import { describe, it, expect, beforeEach } from "vitest";

import {
  insertCandidate,
  findLatestCandidateByContentHash,
  updateCandidateStatus,
  type InsertCandidateInput,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { makeSession, randVector, resetDb } from "../setup/fixtures.js";

const EMBEDDING_DIM = 8;
const EMBEDDING_MODEL = "test-model";

function hex64(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function baseInput(
  sessionId: string,
  overrides: Partial<InsertCandidateInput> = {},
): InsertCandidateInput {
  return {
    sessionId,
    proposedBy: "parent",
    kind: "trade_lesson",
    title: "Candidate title",
    summary: "A short candidate summary.",
    contentMd: "Full candidate body.",
    entities: ["SOL"],
    tags: ["risk"],
    sourceRefs: { messageIds: [1] },
    evidenceRefs: [{ executionId: 5 }],
    source: "hypothesis",
    confidence: null,
    importance: 5,
    sensitivity: "normal",
    evidenceStrength: "none",
    retrievalVisibility: "not_consolidated",
    retrievalUntil: null,
    retainUntil: null,
    embedding: randVector(EMBEDDING_DIM, "cand"),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    contentHash: hex64("base"),
    eventTime: null,
    observedAt: null,
    availableAtDecisionTime: null,
    ...overrides,
  };
}

describe("findLatestCandidateByContentHash (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns null when no candidate exists for the hash", async () => {
    expect(await findLatestCandidateByContentHash(hex64("absent"))).toBeNull();
  });

  it("returns null for an empty hash without querying", async () => {
    expect(await findLatestCandidateByContentHash("")).toBeNull();
  });

  it("returns the pending candidate for a hash that is still pending", async () => {
    const sid = await makeSession();
    const hash = hex64("pending");
    const { candidate } = await insertCandidate(baseInput(sid, { contentHash: hash }));

    const found = await findLatestCandidateByContentHash(hash);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(candidate.id);
    expect(found?.status).toBe("pending");
  });

  it("surfaces a terminal status so a promoted hash blocks re-suggest", async () => {
    const sid = await makeSession();
    const hash = hex64("promote-block");
    const { candidate } = await insertCandidate(baseInput(sid, { contentHash: hash }));
    await updateCandidateStatus(candidate.id, "rejected", { expectedFromStatus: "pending" });

    const found = await findLatestCandidateByContentHash(hash);
    expect(found?.id).toBe(candidate.id);
    expect(found?.status).toBe("rejected");
  });

  it("returns the most recent row when the hash recurs across lifecycles", async () => {
    const sid = await makeSession();
    const hash = hex64("recurring");

    // First candidate for the hash, then terminalize it so the partial unique
    // index frees the hash for a second pending insert.
    const first = await insertCandidate(baseInput(sid, { contentHash: hash }));
    await updateCandidateStatus(first.candidate.id, "rejected", {
      expectedFromStatus: "pending",
    });
    const second = await insertCandidate(baseInput(sid, { contentHash: hash }));

    const found = await findLatestCandidateByContentHash(hash);
    // The newest recorded_at row wins — the second (pending) candidate.
    expect(found?.id).toBe(second.candidate.id);
    expect(found?.status).toBe("pending");
  });
});
