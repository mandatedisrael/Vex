import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function recallSuite(ctx: SuiteCtx): void {
  const { recallTopK, mockQuery, SAMPLE_ROW, makeEmbedding } = ctx;

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
}
