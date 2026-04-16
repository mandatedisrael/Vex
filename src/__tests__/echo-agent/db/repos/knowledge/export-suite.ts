import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function exportSuite(ctx: SuiteCtx): void {
  const { streamAllForExport, mockQuery, SAMPLE_ROW, SAMPLE_HASH } = ctx;

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
}
