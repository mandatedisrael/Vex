/**
 * Integration: session-episodes repo against a real Postgres + pgvector.
 *
 * Proofs that mocks cannot give us:
 *   - Dedupe partial unique index `(session_id, source_end_message_id,
 *     episode_hash) WHERE source_end_message_id IS NOT NULL` — second insert
 *     with the same triple is dropped when `source_end_message_id` is set,
 *     and NOT dropped (both rows land) when it's NULL.
 *   - `recallTopK` mandatory filter on `(embedding_model, embedding_dim)` —
 *     rows with a different model OR different dim are excluded BEFORE
 *     pgvector's `<=>` sees them (otherwise mixed-dim crashes the op).
 *   - `listRecentBySession` DESC ordering + limit.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  insertEpisodes,
  recallTopK,
  listRecentBySession,
  type NewEpisode,
} from "@echo-agent/db/repos/session-episodes.js";
import {
  episodeHash,
  makeSession,
  randVector,
  resetDb,
} from "../setup/fixtures.js";

function newEpisode(
  sessionId: string,
  overrides: Partial<NewEpisode> & {
    summaryEn: string;
    embeddingDim: number;
    embeddingModel: string;
  },
): NewEpisode {
  const kind = overrides.episodeKind ?? "fact";
  const hash = overrides.episodeHash ?? episodeHash(kind, overrides.summaryEn);
  const seed = overrides.summaryEn + "|" + overrides.embeddingModel;
  return {
    sessionId,
    memoryScopeKey: overrides.memoryScopeKey ?? sessionId,
    episodeKind: kind,
    summaryEn: overrides.summaryEn,
    facts: overrides.facts,
    decisions: overrides.decisions,
    openLoops: overrides.openLoops,
    entities: overrides.entities,
    toolOutcomes: overrides.toolOutcomes,
    sourceSurface: overrides.sourceSurface ?? "echo_agent",
    sourceSession: overrides.sourceSession ?? null,
    sourceStartMessageId: overrides.sourceStartMessageId ?? null,
    sourceEndMessageId: overrides.sourceEndMessageId ?? null,
    episodeHash: hash,
    embeddingModel: overrides.embeddingModel,
    embeddingDim: overrides.embeddingDim,
    embedding: overrides.embedding ?? randVector(overrides.embeddingDim, seed),
  };
}

describe("session-episodes insertEpisodes dedupe (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("drops the second row with same (session, source_end_message_id, episode_hash) when source_end_message_id IS NOT NULL", async () => {
    const sid = await makeSession(undefined, { memoryScopeKey: "scope-a" });
    const base = {
      summaryEn: "Held SOL at 180.",
      embeddingModel: "test-model",
      embeddingDim: 8,
      sourceEndMessageId: 42,
    };

    const first = await insertEpisodes([newEpisode(sid, base)]);
    const second = await insertEpisodes([newEpisode(sid, base)]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);

    const all = await listRecentBySession(sid);
    expect(all).toHaveLength(1);
  });

  it("keeps BOTH rows when source_end_message_id IS NULL (partial index does not apply)", async () => {
    const sid = await makeSession(undefined, { memoryScopeKey: "scope-a" });
    const base = {
      summaryEn: "Prefers translating Polish to English before recall.",
      embeddingModel: "test-model",
      embeddingDim: 8,
      sourceEndMessageId: null,
    };

    const first = await insertEpisodes([newEpisode(sid, base)]);
    const second = await insertEpisodes([newEpisode(sid, base)]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    const all = await listRecentBySession(sid);
    expect(all).toHaveLength(2);
  });
});

describe("session-episodes recallTopK filtering (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("excludes rows with a different embedding_model even when memoryScopeKey matches", async () => {
    const sid = await makeSession(undefined, { memoryScopeKey: "scope-a" });

    await insertEpisodes([
      newEpisode(sid, { summaryEn: "A", embeddingModel: "model-a", embeddingDim: 8, memoryScopeKey: "scope-a" }),
      newEpisode(sid, { summaryEn: "B", embeddingModel: "model-b", embeddingDim: 8, memoryScopeKey: "scope-a" }),
    ]);

    const hits = await recallTopK(randVector(8, "query"), {
      memoryScopeKey: "scope-a",
      embeddingModel: "model-a",
      embeddingDim: 8,
      topK: 10,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].episode.summaryEn).toBe("A");
  });

  it("excludes rows with a different embedding_dim (protects pgvector from mixed-dim <=>)", async () => {
    const sid = await makeSession(undefined, { memoryScopeKey: "scope-a" });

    await insertEpisodes([
      newEpisode(sid, { summaryEn: "small", embeddingModel: "model-a", embeddingDim: 8, memoryScopeKey: "scope-a" }),
      newEpisode(sid, { summaryEn: "large", embeddingModel: "model-a", embeddingDim: 16, memoryScopeKey: "scope-a" }),
    ]);

    const hits = await recallTopK(randVector(8, "q"), {
      memoryScopeKey: "scope-a",
      embeddingModel: "model-a",
      embeddingDim: 8,
      topK: 10,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].episode.summaryEn).toBe("small");
  });

  it("excludes rows with a different memoryScopeKey", async () => {
    const sidA = await makeSession(undefined, { memoryScopeKey: "scope-a" });
    const sidB = await makeSession(undefined, { memoryScopeKey: "scope-b" });

    await insertEpisodes([
      newEpisode(sidA, { summaryEn: "A-row", embeddingModel: "model-x", embeddingDim: 8, memoryScopeKey: "scope-a" }),
      newEpisode(sidB, { summaryEn: "B-row", embeddingModel: "model-x", embeddingDim: 8, memoryScopeKey: "scope-b" }),
    ]);

    const hits = await recallTopK(randVector(8, "q"), {
      memoryScopeKey: "scope-a",
      embeddingModel: "model-x",
      embeddingDim: 8,
      topK: 10,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].episode.summaryEn).toBe("A-row");
  });

  it("respects topK cap", async () => {
    const sid = await makeSession(undefined, { memoryScopeKey: "scope-k" });
    await insertEpisodes(
      Array.from({ length: 5 }, (_, i) =>
        newEpisode(sid, {
          summaryEn: `row-${i}`,
          embeddingModel: "model-a",
          embeddingDim: 8,
          memoryScopeKey: "scope-k",
        }),
      ),
    );

    const hits = await recallTopK(randVector(8, "q"), {
      memoryScopeKey: "scope-k",
      embeddingModel: "model-a",
      embeddingDim: 8,
      topK: 2,
    });

    expect(hits).toHaveLength(2);
  });
});

describe("session-episodes listRecentBySession (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns rows DESC by created_at,id with limit honored", async () => {
    const sid = await makeSession(undefined, { memoryScopeKey: "scope-l" });
    await insertEpisodes([
      newEpisode(sid, { summaryEn: "first", embeddingModel: "m", embeddingDim: 8, memoryScopeKey: "scope-l" }),
      newEpisode(sid, { summaryEn: "second", embeddingModel: "m", embeddingDim: 8, memoryScopeKey: "scope-l" }),
      newEpisode(sid, { summaryEn: "third", embeddingModel: "m", embeddingDim: 8, memoryScopeKey: "scope-l" }),
    ]);

    const recent = await listRecentBySession(sid, 2);
    expect(recent).toHaveLength(2);
    // Same NOW() for all three in a fast test run → tiebreaker is id DESC, so
    // the two most-recent inserted ids come back.
    expect(recent[0].summaryEn).toBe("third");
    expect(recent[1].summaryEn).toBe("second");
  });
});
