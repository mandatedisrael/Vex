import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockQueryOne = vi.fn().mockResolvedValue(null);
const mockQuery = vi.fn().mockResolvedValue([]);

vi.mock("@echo-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: (...args: unknown[]) => mockQuery(...args),
}));

const {
  insertEntry,
  getById,
  findByContentHash,
  updateStatus,
  updateEmbedding,
  recallTopK,
  listActiveForHotContext,
  listKnownKinds,
  streamAllForExport,
  streamRowsForReembed,
  findRowsWithDimNotMatching,
  isRuntimeActive,
} = await import("@echo-agent/db/repos/knowledge.js");

const SAMPLE_HASH = "0".repeat(64);

const SAMPLE_ROW = {
  id: 42,
  kind: "strategy_rule",
  title: "test title",
  summary: "test summary",
  content_md: "full markdown",
  tags: ["solana"],
  source_refs: { protocol_executions: [1] },
  confidence: 0.7,
  status: "active",
  pinned: false,
  valid_from: "2026-04-06T12:00:00Z",
  valid_until: "2026-04-13T12:00:00Z",
  content_hash: SAMPLE_HASH,
  embedding_model: "ai/embeddinggemma:300M-Q8_0",
  embedding_dim: 768,
  created_at: "2026-04-06T12:00:00Z",
  updated_at: "2026-04-06T12:00:00Z",
};

function makeEmbedding(dim = 768): number[] {
  return Array.from({ length: dim }, (_, i) => i / dim);
}

function baseInsertInput() {
  return {
    kind: "strategy_rule",
    title: "test title",
    summary: "test summary",
    contentMd: "full markdown",
    tags: ["solana"],
    sourceRefs: { protocol_executions: [1] },
    confidence: 0.7,
    pinned: false,
    validUntil: new Date("2026-04-13T12:00:00Z"),
    contentHash: SAMPLE_HASH,
    embeddingModel: "ai/embeddinggemma:300M-Q8_0",
    embeddingDim: 768,
    embedding: makeEmbedding(768),
  };
}

describe("knowledge repo", () => {
  beforeEach(() => {
    // mockReset() also clears the queue from `mockResolvedValueOnce` so a
    // never-consumed once-mock from a previous test cannot bleed into the
    // next one. clearAllMocks() only resets call history, not the queue.
    mockExecute.mockReset();
    mockExecute.mockResolvedValue(0);
    mockQueryOne.mockReset();
    mockQueryOne.mockResolvedValue(null);
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  // ── insertEntry ──────────────────────────────────────────────

  describe("insertEntry", () => {
    it("inserts via CTE upsert with vector cast and returns {entry, inserted: true}", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: true });
      const result = await insertEntry(baseInsertInput());

      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("WITH ins AS");
      expect(sql).toContain("INSERT INTO knowledge_entries");
      expect(sql).toContain("$15::vector");
      expect(sql).toContain("ON CONFLICT (content_hash) DO NOTHING");
      expect(sql).toContain("UNION ALL");
      // Vector serialized to literal as the 15th positional param
      expect(params[14]).toBe(`[${makeEmbedding(768).join(",")}]`);
      // content_hash is positional param 12 (0-indexed: 11)
      expect(params[11]).toBe(SAMPLE_HASH);
      // tags as array
      expect(params).toContainEqual(["solana"]);
      // JSONB stringified
      expect(params).toContainEqual(JSON.stringify({ protocol_executions: [1] }));

      expect(result.inserted).toBe(true);
      expect(result.entry.id).toBe(42);
      expect(result.entry.contentHash).toBe(SAMPLE_HASH);
      expect(result.entry.embeddingModel).toBe("ai/embeddinggemma:300M-Q8_0");
    });

    it("returns {inserted: false} when content_hash already exists (upsert no-op)", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: false });
      const result = await insertEntry(baseInsertInput());
      expect(result.inserted).toBe(false);
      expect(result.entry.id).toBe(42);
    });

    it("passes null valid_until when pinned", async () => {
      mockQueryOne.mockResolvedValueOnce({
        ...SAMPLE_ROW,
        pinned: true,
        valid_until: null,
        inserted: true,
      });
      await insertEntry({ ...baseInsertInput(), pinned: true, validUntil: null });
      const [, params] = mockQueryOne.mock.calls[0];
      // valid_until is the 11th positional param (0-indexed 10)
      expect(params[10]).toBeNull();
    });

    it("uses COALESCE defaults when audit fields are not provided", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: true });
      await insertEntry(baseInsertInput());
      const [, params] = mockQueryOne.mock.calls[0];
      // Param order after the source_surface/source_session add (R3 knowledge
      // provenance migration):
      //   7  status        → COALESCE → 'active'
      //   9  valid_from    → COALESCE → NOW()
      //   15 source_surface → COALESCE → 'echo_agent'
      //   16 source_session → NULL when not provided
      //   17 created_at    → COALESCE → NOW()
      //   18 updated_at    → COALESCE → NOW()
      expect(params[7]).toBeNull();
      expect(params[9]).toBeNull();
      expect(params[15]).toBeNull(); // sourceSurface defaults to undefined → null at param level
      expect(params[16]).toBeNull(); // sourceSession defaults to undefined → null
      expect(params[17]).toBeNull();
      expect(params[18]).toBeNull();
    });

    it("preserves audit fields when provided (import roundtrip)", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: true });
      const validFrom = new Date("2025-01-01T00:00:00Z");
      const createdAt = new Date("2025-01-01T00:00:00Z");
      const updatedAt = new Date("2025-06-01T00:00:00Z");
      await insertEntry({
        ...baseInsertInput(),
        status: "invalidated",
        validFrom,
        createdAt,
        updatedAt,
      });
      const [, params] = mockQueryOne.mock.calls[0];
      expect(params[7]).toBe("invalidated");
      expect(params[9]).toBe(validFrom.toISOString());
      // After lifecycle columns (supersedes_id/status_reason/change_summary/what_failed
      // at params 17..20), created_at moved 17 → 21, updated_at 18 → 22.
      expect(params[17]).toBeNull(); // supersedesId default
      expect(params[18]).toBeNull(); // statusReason default
      expect(params[19]).toBeNull(); // changeSummary default
      expect(params[20]).toBeNull(); // whatFailed default
      expect(params[21]).toBe(createdAt.toISOString());
      expect(params[22]).toBe(updatedAt.toISOString());
    });

    it("passes lifecycle fields (supersedesId + reason + change_summary + what_failed) when provided", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: true });
      await insertEntry({
        ...baseInsertInput(),
        supersedesId: 7,
        statusReason: "replaced by tighter rule",
        changeSummary: "threshold 10% → 5%",
        whatFailed: "3/24 days hit >7% drawdown",
      });
      const [, params] = mockQueryOne.mock.calls[0];
      expect(params[17]).toBe(7);
      expect(params[18]).toBe("replaced by tighter rule");
      expect(params[19]).toBe("threshold 10% → 5%");
      expect(params[20]).toBe("3/24 days hit >7% drawdown");
    });

    it("throws when embedding length does not match embeddingDim (pre-DB guard)", async () => {
      const input = baseInsertInput();
      input.embedding = makeEmbedding(512);
      input.embeddingDim = 768;
      await expect(insertEntry(input)).rejects.toThrow(
        /embedding length 512 does not match embeddingDim 768/,
      );
      expect(mockQueryOne).not.toHaveBeenCalled();
    });
  });

  // ── getById ──────────────────────────────────────────────────

  describe("getById", () => {
    it("returns mapped entry on hit with lineage LEFT JOIN", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, superseded_by: null });
      const result = await getById(42);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("FROM knowledge_entries k");
      expect(sql).toContain("LEFT JOIN knowledge_entries succ ON succ.supersedes_id = k.id");
      expect(sql).toContain("WHERE k.id = $1");
      expect(params).toEqual([42]);
      expect(result?.id).toBe(42);
      expect(result?.contentHash).toBe(SAMPLE_HASH);
      expect(result?.supersededBy).toBeNull();
    });

    it("returns supersededBy id when a successor exists", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, superseded_by: 99 });
      const result = await getById(42);
      expect(result?.supersededBy).toBe(99);
    });

    it("returns null on miss", async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await getById(99)).toBeNull();
    });

    it("returns null for invalid id without hitting DB", async () => {
      expect(await getById(0)).toBeNull();
      expect(await getById(-1)).toBeNull();
      expect(await getById(NaN)).toBeNull();
      expect(mockQueryOne).not.toHaveBeenCalled();
    });
  });

  // ── findByContentHash ────────────────────────────────────────

  describe("findByContentHash", () => {
    it("returns mapped entry on hash hit", async () => {
      mockQueryOne.mockResolvedValueOnce(SAMPLE_ROW);
      const result = await findByContentHash(SAMPLE_HASH);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("WHERE content_hash = $1");
      expect(params).toEqual([SAMPLE_HASH]);
      expect(result?.id).toBe(42);
    });

    it("returns null on miss", async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await findByContentHash("deadbeef")).toBeNull();
    });

    it("returns null on empty hash without hitting DB", async () => {
      expect(await findByContentHash("")).toBeNull();
      expect(mockQueryOne).not.toHaveBeenCalled();
    });
  });

  // ── updateStatus ─────────────────────────────────────────────

  describe("updateStatus", () => {
    it("issues UPDATE with new status and id (no reason)", async () => {
      mockExecute.mockResolvedValueOnce(1);
      const result = await updateStatus(42, "invalidated");
      expect(result).toBe(true);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE knowledge_entries");
      expect(sql).toContain("SET status = $1");
      expect(sql).not.toContain("status_reason");
      expect(params).toEqual(["invalidated", 42]);
    });

    it("persists reason to status_reason when provided", async () => {
      mockExecute.mockResolvedValueOnce(1);
      const result = await updateStatus(42, "invalidated", "contradicted by Apr 12 data");
      expect(result).toBe(true);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("status_reason = $2");
      expect(params).toEqual(["invalidated", "contradicted by Apr 12 data", 42]);
    });

    it("explicit null clears status_reason", async () => {
      mockExecute.mockResolvedValueOnce(1);
      await updateStatus(42, "archived", null);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("status_reason = $2");
      expect(params).toEqual(["archived", null, 42]);
    });

    it("returns false when no rows affected", async () => {
      mockExecute.mockResolvedValueOnce(0);
      expect(await updateStatus(99, "archived")).toBe(false);
    });
  });

  // ── updateEmbedding ──────────────────────────────────────────

  describe("updateEmbedding", () => {
    it("issues UPDATE with vector literal cast and bumps updated_at", async () => {
      mockExecute.mockResolvedValueOnce(1);
      const vec = makeEmbedding(768);
      const ok = await updateEmbedding(42, "new-model", 768, vec);
      expect(ok).toBe(true);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE knowledge_entries");
      expect(sql).toContain("embedding = $1::vector");
      expect(sql).toContain("embedding_model = $2");
      expect(sql).toContain("embedding_dim = $3");
      expect(sql).toContain("updated_at = NOW()");
      expect(params[0]).toBe(`[${vec.join(",")}]`);
      expect(params[1]).toBe("new-model");
      expect(params[2]).toBe(768);
      expect(params[3]).toBe(42);
    });

    it("throws when vector length does not match dim", async () => {
      await expect(
        updateEmbedding(42, "model", 768, makeEmbedding(1024)),
      ).rejects.toThrow(/vector length 1024 does not match dim 768/);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("returns false for invalid id without hitting DB", async () => {
      expect(await updateEmbedding(0, "m", 768, makeEmbedding(768))).toBe(false);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── recallTopK ───────────────────────────────────────────────

  describe("recallTopK", () => {
    it("filters by embedding_model AND embedding_dim (mandatory mixed-dim crash protection)", async () => {
      mockQuery.mockResolvedValueOnce([{ ...SAMPLE_ROW, cosine_distance: 0.1 }]);
      await recallTopK(
        makeEmbedding(768),
        { embeddingModel: "ai/embeddinggemma:300M-Q8_0", embeddingDim: 768 },
        8,
      );
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("WHERE status = 'active'");
      expect(sql).toContain("AND embedding_model = $2");
      expect(sql).toContain("AND embedding_dim = $3");
      expect(sql).toContain("ORDER BY embedding <=> $1::vector");
      expect(params[1]).toBe("ai/embeddinggemma:300M-Q8_0");
      expect(params[2]).toBe(768);
      // LIMIT param is the last one, k*2
      expect(params[params.length - 1]).toBe(16);
    });

    it("similarity = 1 - cosine_distance, clamped to [0,1]", async () => {
      mockQuery.mockResolvedValueOnce([{ ...SAMPLE_ROW, cosine_distance: 0.1 }]);
      const result = await recallTopK(
        makeEmbedding(768),
        { embeddingModel: "m", embeddingDim: 768 },
        8,
      );
      expect(result[0]?.similarity).toBeCloseTo(0.9, 5);
    });

    it("adds kind filter as $4 when supplied", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await recallTopK(
        makeEmbedding(768),
        { embeddingModel: "m", embeddingDim: 768, kind: "strategy_rule" },
        5,
      );
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("AND kind = $4");
      expect(params).toContain("strategy_rule");
    });

    it("excludes expired when include_expired=false", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await recallTopK(
        makeEmbedding(768),
        { embeddingModel: "m", embeddingDim: 768, includeExpired: false },
        5,
      );
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("valid_until IS NULL OR valid_until > now()");
    });

    it("includes expired by default", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await recallTopK(makeEmbedding(768), { embeddingModel: "m", embeddingDim: 768 }, 5);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).not.toContain("valid_until > now()");
    });

    it("returns [] when k <= 0 without DB call", async () => {
      const result = await recallTopK(
        makeEmbedding(768),
        { embeddingModel: "m", embeddingDim: 768 },
        0,
      );
      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("throws when query embedding length does not match filter dim", async () => {
      await expect(
        recallTopK(makeEmbedding(512), { embeddingModel: "m", embeddingDim: 768 }, 5),
      ).rejects.toThrow(/query embedding length 512 does not match filter dim 768/);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ── listActiveForHotContext ──────────────────────────────────

  describe("listActiveForHotContext", () => {
    it("queries for active+pinned/non-expired ordered pinned DESC, updated_at DESC", async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 1,
          kind: "risk_rule",
          title: "no leverage",
          summary: "...",
          pinned: true,
          valid_until: null,
          updated_at: "2026-04-06T12:00:00Z",
        },
      ]);
      const result = await listActiveForHotContext({ limit: 12 });
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("WHERE status = 'active'");
      expect(sql).toContain("(pinned = TRUE OR valid_until > now())");
      expect(sql).toContain("ORDER BY pinned DESC, updated_at DESC");
      expect(params).toEqual([12]);
      expect(result[0]?.kind).toBe("risk_rule");
    });
  });

  // ── listKnownKinds ───────────────────────────────────────────

  describe("listKnownKinds", () => {
    it("groups by kind, orders by count desc, limits to N", async () => {
      mockQuery.mockResolvedValueOnce([
        { kind: "pumpfun_entry_pattern", n: "12" },
        { kind: "risk_rule", n: "3" },
      ]);
      const result = await listKnownKinds({ limit: 30 });
      expect(result).toEqual([
        { kind: "pumpfun_entry_pattern", count: 12 },
        { kind: "risk_rule", count: 3 },
      ]);
    });
  });

  // ── streamAllForExport ───────────────────────────────────────

  describe("streamAllForExport", () => {
    it("paginates by id, left-joins predecessor, yields supersedesContentHash", async () => {
      const rowA = { ...SAMPLE_ROW, id: 1, supersedes_content_hash: null };
      const rowB = {
        ...SAMPLE_ROW,
        id: 2,
        supersedes_id: 1,
        status: "active",
        supersedes_content_hash: SAMPLE_HASH,
      };
      // Two pages: first with 2 rows, second with 0
      mockQuery
        .mockResolvedValueOnce([rowA, rowB])
        .mockResolvedValueOnce([]);
      const yielded: Array<{ id: number; supersedesContentHash: string | null }> = [];
      for await (const e of streamAllForExport(2)) {
        yielded.push({ id: e.id, supersedesContentHash: e.supersedesContentHash });
      }
      expect(yielded).toEqual([
        { id: 1, supersedesContentHash: null },
        { id: 2, supersedesContentHash: SAMPLE_HASH },
      ]);
      // Two queries: first page + termination check
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const [sqlA, paramsA] = mockQuery.mock.calls[0];
      expect(sqlA).toContain("WHERE k.id > $1");
      expect(sqlA).toContain("ORDER BY k.id ASC");
      expect(sqlA).toContain("LEFT JOIN knowledge_entries pred ON pred.id = k.supersedes_id");
      expect(paramsA).toEqual([0, 2]);
      const [, paramsB] = mockQuery.mock.calls[1];
      expect(paramsB).toEqual([2, 2]);
    });

    it("stops after a partial page (rows.length < batchSize)", async () => {
      mockQuery.mockResolvedValueOnce([{ ...SAMPLE_ROW, id: 1, supersedes_content_hash: null }]);
      const yielded: number[] = [];
      for await (const e of streamAllForExport(50)) {
        yielded.push(e.id);
      }
      expect(yielded).toEqual([1]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ── streamRowsForReembed ─────────────────────────────────────

  describe("streamRowsForReembed", () => {
    it("filters by embedding_model != current.model by default", async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, kind: "k", title: "t", summary: "s", content_md: "c" },
      ]);
      mockQuery.mockResolvedValueOnce([]);
      const out: number[] = [];
      for await (const r of streamRowsForReembed("new-model", { batchSize: 50 })) {
        out.push(r.id);
      }
      expect(out).toEqual([1]);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("AND embedding_model <> $2");
      expect(params).toEqual([0, "new-model", 50]);
    });

    it("with includeMatching: true streams every row regardless of model", async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 7, kind: "k", title: "t", summary: "s", content_md: "c" },
      ]);
      mockQuery.mockResolvedValueOnce([]);
      const out: number[] = [];
      for await (const r of streamRowsForReembed("any", { includeMatching: true, batchSize: 10 })) {
        out.push(r.id);
      }
      expect(out).toEqual([7]);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).not.toContain("embedding_model");
      expect(params).toEqual([0, 10]);
    });
  });

  // ── findRowsWithDimNotMatching ───────────────────────────────

  describe("findRowsWithDimNotMatching", () => {
    it("returns count of rows whose embedding_dim differs", async () => {
      mockQueryOne.mockResolvedValueOnce({ n: "5" });
      const n = await findRowsWithDimNotMatching(768);
      expect(n).toBe(5);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("WHERE embedding_dim <> $1");
      expect(params).toEqual([768]);
    });

    it("returns 0 on empty result", async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await findRowsWithDimNotMatching(1024)).toBe(0);
    });
  });

  // ── isRuntimeActive ──────────────────────────────────────────

  describe("isRuntimeActive", () => {
    it("returns the active flag from runtime_state singleton", async () => {
      mockQueryOne.mockResolvedValueOnce({ active: true });
      expect(await isRuntimeActive()).toBe(true);
    });

    it("returns false when runtime_state row is missing", async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await isRuntimeActive()).toBe(false);
    });

    it("returns false when active is false", async () => {
      mockQueryOne.mockResolvedValueOnce({ active: false });
      expect(await isRuntimeActive()).toBe(false);
    });
  });
});
