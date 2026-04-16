import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function recallOverflowSuite(ctx: SuiteCtx): void {
  const { handleKnowledgeRecallOverflow, makeTestContext, mockCacheRead } = ctx;

  describe("handleKnowledgeRecallOverflow", () => {
    it("fails on missing cacheKey", async () => {
      const result = await handleKnowledgeRecallOverflow({}, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing required parameter");
      expect(mockCacheRead).not.toHaveBeenCalled();
    });

    it("accepts both `cacheKey` and `cache_key` parameter names", async () => {
      mockCacheRead.mockResolvedValueOnce({
        results: [{ id: 1, kind: "memo", title: "t", summary: "s", contentMd: "c", similarity: 0.5, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] }],
        expiresAt: "2026-04-06T12:15:00Z",
      });
      const result = await handleKnowledgeRecallOverflow({ cache_key: "rcl-snake" }, makeTestContext());
      expect(result.success).toBe(true);
      expect(mockCacheRead).toHaveBeenCalledWith("rcl-snake");
    });

    it("fails on cache miss with cacheKey in error message", async () => {
      mockCacheRead.mockResolvedValueOnce(null);
      const result = await handleKnowledgeRecallOverflow({ cacheKey: "rcl-missing" }, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("cache not found or expired");
      expect(result.output).toContain("rcl-missing");
    });

    it("fails when readCache throws", async () => {
      mockCacheRead.mockRejectedValueOnce(new Error("DB connection refused"));
      const result = await handleKnowledgeRecallOverflow({ cacheKey: "rcl-x" }, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("knowledge_recall_overflow failed");
    });

    it("happy path returns cached results + expiresAt", async () => {
      const cached = {
        results: [
          { id: 11, kind: "memo", title: "t11", summary: "s", contentMd: "c", similarity: 0.5, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] },
          { id: 12, kind: "memo", title: "t12", summary: "s", contentMd: "c", similarity: 0.4, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] },
        ],
        expiresAt: "2026-04-06T12:15:00Z",
      };
      mockCacheRead.mockResolvedValueOnce(cached);
      const result = await handleKnowledgeRecallOverflow({ cacheKey: "rcl-x" }, makeTestContext());
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.expiresAt).toBe("2026-04-06T12:15:00Z");
    });
  });
}
