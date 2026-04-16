import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function recallSuite(ctx: SuiteCtx): void {
  const {
    handleKnowledgeRecall,
    makeTestContext,
    mockEmbedQuery,
    mockRecallTopK,
    mockCacheWrite,
    mockCacheCleanup,
    mockGenerateCacheKey,
    makeEmbedResult,
    makeCandidate,
    TEST_DIM,
    TEST_PROVIDER_MODEL,
  } = ctx;

  describe("handleKnowledgeRecall", () => {
    it("fails on missing query without calling embed/cleanup", async () => {
      const result = await handleKnowledgeRecall({}, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing required parameter: query");
      expect(mockCacheCleanup).not.toHaveBeenCalled();
      expect(mockEmbedQuery).not.toHaveBeenCalled();
    });

    it("calls cleanupExpired BEFORE embedQuery and BEFORE writeCache (sequence)", async () => {
      mockRecallTopK.mockResolvedValueOnce(
        Array.from({ length: 12 }, (_, i) => makeCandidate(i + 1)),
      );
      await handleKnowledgeRecall({ query: "test", k: 12 }, makeTestContext());

      expect(mockCacheCleanup).toHaveBeenCalledTimes(1);
      expect(mockCacheWrite).toHaveBeenCalledTimes(1);

      const cleanupOrder = mockCacheCleanup.mock.invocationCallOrder[0]!;
      const embedOrder = mockEmbedQuery.mock.invocationCallOrder[0]!;
      const writeOrder = mockCacheWrite.mock.invocationCallOrder[0]!;
      expect(cleanupOrder).toBeLessThan(embedOrder);
      expect(cleanupOrder).toBeLessThan(writeOrder);
    });

    it("fails loud when embedding service throws", async () => {
      mockEmbedQuery.mockRejectedValueOnce(new Error("sidecar offline"));
      const result = await handleKnowledgeRecall({ query: "test" }, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("embedding service unavailable");
      expect(mockRecallTopK).not.toHaveBeenCalled();
      expect(mockCacheWrite).not.toHaveBeenCalled();
    });

    it("k=5 returns all inline, no overflow, no cache write", async () => {
      mockRecallTopK.mockResolvedValueOnce(
        Array.from({ length: 5 }, (_, i) => makeCandidate(i + 1)),
      );
      const result = await handleKnowledgeRecall({ query: "test", k: 5 }, makeTestContext());
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.count).toBe(5);
      expect(parsed.inline).toHaveLength(5);
      expect(parsed.overflow).toBeUndefined();
      expect(mockCacheWrite).not.toHaveBeenCalled();
      expect(mockGenerateCacheKey).not.toHaveBeenCalled();
    });

    it("k=12 returns 10 inline + 2 overflow, writes cache, returns overflow meta", async () => {
      mockRecallTopK.mockResolvedValueOnce(
        Array.from({ length: 12 }, (_, i) => makeCandidate(i + 1)),
      );
      const result = await handleKnowledgeRecall({ query: "test", k: 12 }, makeTestContext());
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.inline).toHaveLength(10);
      expect(parsed.overflow).toBeDefined();
      expect(parsed.overflow.cacheKey).toBe("rcl-test-key");
      expect(parsed.overflow.remainingCount).toBe(2);
      expect(parsed.overflow.expiresAt).toBe("2026-04-06T12:15:00Z");

      expect(mockCacheWrite).toHaveBeenCalledTimes(1);
      const [cacheKeyArg, overflowArg] = mockCacheWrite.mock.calls[0]!;
      expect(cacheKeyArg).toBe("rcl-test-key");
      expect(overflowArg).toHaveLength(2);
    });

    it("passes FULL filter set to generateCacheKey (fix 2 guard)", async () => {
      mockRecallTopK.mockResolvedValueOnce(
        Array.from({ length: 12 }, (_, i) => makeCandidate(i + 1)),
      );
      await handleKnowledgeRecall(
        { query: "early holder count", k: 12, kind: "pumpfun_entry_pattern", include_expired: false },
        makeTestContext(),
      );
      expect(mockGenerateCacheKey).toHaveBeenCalledTimes(1);
      const [calledQuery, calledFilters, calledNow] = mockGenerateCacheKey.mock.calls[0]!;
      expect(calledQuery).toBe("early holder count");
      expect(calledFilters).toEqual({ k: 12, kind: "pumpfun_entry_pattern", includeExpired: false });
      expect(calledNow).toBeInstanceOf(Date);
    });

    it("fails loud when overflow cache write throws (fix 3 guard)", async () => {
      mockRecallTopK.mockResolvedValueOnce(
        Array.from({ length: 12 }, (_, i) => makeCandidate(i + 1)),
      );
      mockCacheWrite.mockRejectedValueOnce(new Error("disk full"));

      const result = await handleKnowledgeRecall({ query: "test", k: 12 }, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("overflow cache write failed");
      expect(result.output).toContain("disk full");
      expect(result.output).toContain("Retry with k=10");
    });

    it("includeExpired defaults to true when omitted", async () => {
      mockRecallTopK.mockResolvedValueOnce([]);
      await handleKnowledgeRecall({ query: "test" }, makeTestContext());
      const [, filters] = mockRecallTopK.mock.calls[0]!;
      expect(filters.includeExpired).toBe(true);
    });

    it("includeExpired=false is passed through to repo", async () => {
      mockRecallTopK.mockResolvedValueOnce([]);
      await handleKnowledgeRecall({ query: "test", include_expired: false }, makeTestContext());
      const [, filters] = mockRecallTopK.mock.calls[0]!;
      expect(filters.includeExpired).toBe(false);
    });

    it("kind filter is passed through to repo", async () => {
      mockRecallTopK.mockResolvedValueOnce([]);
      await handleKnowledgeRecall({ query: "test", kind: "risk_rule" }, makeTestContext());
      const [, filters] = mockRecallTopK.mock.calls[0]!;
      expect(filters.kind).toBe("risk_rule");
    });

    it("passes embeddingModel (from providerModel) + embeddingDim to recallTopK", async () => {
      mockRecallTopK.mockResolvedValueOnce([]);
      await handleKnowledgeRecall({ query: "test" }, makeTestContext());
      const [, filters] = mockRecallTopK.mock.calls[0]!;
      // Filter is the providerModel from THIS embedQuery call, not config.model.
      expect(filters.embeddingModel).toBe(TEST_PROVIDER_MODEL);
      expect(filters.embeddingDim).toBe(TEST_DIM);
    });

    it("recall filter uses providerModel from embedQuery (R2 Fix 2)", async () => {
      // Provider aliases requested name to a different one in the response.
      mockEmbedQuery.mockResolvedValueOnce(makeEmbedResult("aliased-recall-model"));
      mockRecallTopK.mockResolvedValueOnce([]);
      await handleKnowledgeRecall({ query: "test" }, makeTestContext());
      const [, filters] = mockRecallTopK.mock.calls[0]!;
      expect(filters.embeddingModel).toBe("aliased-recall-model");
    });

    it("embedQuery is called with config (configOverride)", async () => {
      mockRecallTopK.mockResolvedValueOnce([]);
      await handleKnowledgeRecall({ query: "test" }, makeTestContext());
      expect(mockEmbedQuery).toHaveBeenCalledTimes(1);
      const [q, cfg] = mockEmbedQuery.mock.calls[0]!;
      expect(q).toBe("test");
      expect(cfg).toEqual({
        baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
        model: "ai/embeddinggemma:300M-Q8_0",
        dim: TEST_DIM,
        provider: "local",
      });
    });

    it("k is clamped to RECALL_MAX_K (15) when caller asks for more", async () => {
      mockRecallTopK.mockResolvedValueOnce([]);
      await handleKnowledgeRecall({ query: "test", k: 9999 }, makeTestContext());
      const [, , kArg] = mockRecallTopK.mock.calls[0]!;
      expect(kArg).toBe(15);
    });

    it("cleanupExpired failure is non-fatal (logs but continues)", async () => {
      mockCacheCleanup.mockRejectedValueOnce(new Error("cleanup boom"));
      mockRecallTopK.mockResolvedValueOnce([makeCandidate(1)]);
      const result = await handleKnowledgeRecall({ query: "test" }, makeTestContext());
      expect(result.success).toBe(true);
    });
  });
}
