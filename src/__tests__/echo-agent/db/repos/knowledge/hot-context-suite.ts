import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function hotContextSuite(ctx: SuiteCtx): void {
  const { listActiveForHotContext, listKnownKinds, mockQuery } = ctx;

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
}
