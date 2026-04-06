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
  updateStatus,
  recallTopK,
  listActiveForHotContext,
  listKnownKinds,
} = await import("@echo-agent/db/repos/knowledge.js");

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
  embedding_model: "ai/embeddinggemma:300M-Q8_0",
  embedding_dim: 768,
  created_at: "2026-04-06T12:00:00Z",
  updated_at: "2026-04-06T12:00:00Z",
};

describe("knowledge repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── insertEntry ──────────────────────────────────────────────

  describe("insertEntry", () => {
    it("inserts with vector literal cast and returns mapped entry", async () => {
      mockQueryOne.mockResolvedValueOnce(SAMPLE_ROW);
      const result = await insertEntry({
        kind: "strategy_rule",
        title: "test title",
        summary: "test summary",
        contentMd: "full markdown",
        tags: ["solana"],
        sourceRefs: { protocol_executions: [1] },
        confidence: 0.7,
        pinned: false,
        validUntil: new Date("2026-04-13T12:00:00Z"),
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        embeddingDim: 768,
        embedding: [0.1, 0.2, 0.3],
      });

      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("INSERT INTO knowledge_entries");
      expect(sql).toContain("$12::vector");
      expect(sql).toContain("'active'");
      expect(sql).toContain("RETURNING *");
      // Vector serialized to literal
      expect(params).toContain("[0.1,0.2,0.3]");
      // JSONB stringified
      expect(params).toContainEqual(JSON.stringify({ protocol_executions: [1] }));
      // Tags as array
      expect(params).toContainEqual(["solana"]);

      expect(result.id).toBe(42);
      expect(result.kind).toBe("strategy_rule");
      expect(result.contentMd).toBe("full markdown");
      expect(result.embeddingModel).toBe("ai/embeddinggemma:300M-Q8_0");
    });

    it("passes null valid_until when pinned", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, pinned: true, valid_until: null });
      await insertEntry({
        kind: "risk_rule",
        title: "no leverage",
        summary: "...",
        contentMd: "...",
        tags: [],
        sourceRefs: {},
        confidence: null,
        pinned: true,
        validUntil: null,
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        embeddingDim: 768,
        embedding: [0.5],
      });
      const [, params] = mockQueryOne.mock.calls[0];
      // valid_until is the 9th positional param (1-indexed)
      expect(params[8]).toBeNull();
    });
  });

  // ── getById ──────────────────────────────────────────────────

  describe("getById", () => {
    it("returns mapped entry on hit", async () => {
      mockQueryOne.mockResolvedValueOnce(SAMPLE_ROW);
      const result = await getById(42);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("FROM knowledge_entries");
      expect(sql).toContain("WHERE id = $1");
      expect(params).toEqual([42]);
      expect(result?.id).toBe(42);
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

  // ── updateStatus ─────────────────────────────────────────────

  describe("updateStatus", () => {
    it("issues UPDATE with new status and id", async () => {
      mockExecute.mockResolvedValueOnce(1);
      const result = await updateStatus(42, "invalidated");
      expect(result).toBe(true);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE knowledge_entries");
      expect(sql).toContain("SET status = $1");
      expect(sql).toContain("updated_at = NOW()");
      expect(sql).toContain("WHERE id = $2");
      expect(params).toEqual(["invalidated", 42]);
    });

    it("returns false when no rows affected", async () => {
      mockExecute.mockResolvedValueOnce(0);
      expect(await updateStatus(99, "archived")).toBe(false);
    });

    it("returns false for invalid id without hitting DB", async () => {
      expect(await updateStatus(0, "archived")).toBe(false);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── recallTopK ───────────────────────────────────────────────

  describe("recallTopK", () => {
    it("issues vector search with pgvector cast and LIMIT k*2", async () => {
      mockQuery.mockResolvedValueOnce([{ ...SAMPLE_ROW, cosine_distance: 0.1 }]);
      const result = await recallTopK([0.1, 0.2, 0.3], {}, 8);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("FROM knowledge_entries");
      expect(sql).toContain("WHERE status = 'active'");
      expect(sql).toContain("$1::vector");
      expect(sql).toContain("ORDER BY embedding <=> $1::vector");
      // LIMIT param is the last one
      expect(sql).toContain("LIMIT $2");
      expect(params[0]).toBe("[0.1,0.2,0.3]");
      expect(params[params.length - 1]).toBe(16); // k*2
      expect(result).toHaveLength(1);
      // similarity = 1 - cosine_distance
      expect(result[0]?.similarity).toBeCloseTo(0.9, 5);
    });

    it("adds kind filter when supplied", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await recallTopK([0.1], { kind: "strategy_rule" }, 5);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("AND kind = $2");
      expect(params).toContain("strategy_rule");
    });

    it("excludes expired when include_expired=false", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await recallTopK([0.1], { includeExpired: false }, 5);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("valid_until IS NULL OR valid_until > now()");
    });

    it("includes expired by default", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await recallTopK([0.1], {}, 5);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).not.toContain("valid_until > now()");
    });

    it("returns [] when k <= 0 without DB call", async () => {
      const result = await recallTopK([0.1], {}, 0);
      expect(result).toEqual([]);
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
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("WHERE status = 'active'");
      expect(sql).toContain("(pinned = TRUE OR valid_until > now())");
      expect(sql).toContain("ORDER BY pinned DESC, updated_at DESC");
      expect(sql).toContain("LIMIT $1");
      expect(params).toEqual([12]);
      expect(result).toHaveLength(1);
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
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("SELECT kind, count(*) AS n");
      expect(sql).toContain("FROM knowledge_entries");
      expect(sql).toContain("WHERE status = 'active'");
      expect(sql).toContain("GROUP BY kind");
      expect(sql).toContain("ORDER BY n DESC");
      expect(sql).toContain("LIMIT $1");
      expect(params).toEqual([30]);
      expect(result).toEqual([
        { kind: "pumpfun_entry_pattern", count: 12 },
        { kind: "risk_rule", count: 3 },
      ]);
    });
  });
});
