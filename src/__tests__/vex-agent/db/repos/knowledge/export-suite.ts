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
      // FIX-2: source + all memory-v2 columns must be in the SELECT, else
      // backup/restore silently resets durable provenance + influence.
      expect(sqlA).toMatch(/k\.source\b/);
      expect(sqlA).toContain("k.maturity_state");
      expect(sqlA).toContain("k.activation_strength");
      expect(sqlA).toContain("k.influence_scope");
      expect(sqlA).toContain("k.decay_policy");
      expect(sqlA).toContain("k.regime_tags");
      expect(sqlA).toContain("k.first_promoted_at");
      expect(sqlA).toContain("k.last_reinforced_at");
      expect(sqlA).toContain("k.next_review_at");
      expect(sqlA).toContain("k.outcome_version");
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

    it("carries source + memory-v2 influence fields verbatim (FIX-2 fidelity)", async () => {
      const row = {
        ...SAMPLE_ROW,
        id: 9,
        source: "inferred",
        maturity_state: "reinforced",
        activation_strength: 0.25,
        influence_scope: "retrieval_boost",
        decay_policy: "time",
        regime_tags: ["bull"],
        first_promoted_at: "2026-04-01T00:00:00Z",
        last_reinforced_at: "2026-04-05T00:00:00Z",
        next_review_at: "2026-05-01T00:00:00Z",
        outcome_version: 4,
        supersedes_content_hash: null,
      };
      mockQuery.mockResolvedValueOnce([row]);
      type ExportEntry =
        typeof streamAllForExport extends (b?: number) => AsyncIterable<infer T> ? T : never;
      const out: ExportEntry[] = [];
      for await (const e of streamAllForExport(50)) out.push(e);
      expect(out).toHaveLength(1);
      const e = out[0]!;
      expect(e.source).toBe("inferred");
      expect(e.maturityState).toBe("reinforced");
      expect(e.activationStrength).toBe(0.25);
      expect(e.influenceScope).toBe("retrieval_boost");
      expect(e.decayPolicy).toBe("time");
      expect(e.regimeTags).toEqual(["bull"]);
      expect(e.firstPromotedAt).toBe("2026-04-01T00:00:00Z");
      expect(e.lastReinforcedAt).toBe("2026-04-05T00:00:00Z");
      expect(e.nextReviewAt).toBe("2026-05-01T00:00:00Z");
      expect(e.outcomeVersion).toBe(4);
    });
  });
}
