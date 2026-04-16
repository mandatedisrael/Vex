import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function reembedSuite(ctx: SuiteCtx): void {
  const {
    updateEmbedding,
    streamRowsForReembed,
    findRowsWithDimNotMatching,
    isRuntimeActive,
    mockExecute,
    mockQueryOne,
    mockQuery,
    makeEmbedding,
  } = ctx;

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
}
