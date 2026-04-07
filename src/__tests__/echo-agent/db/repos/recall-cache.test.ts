import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockQueryOne = vi.fn().mockResolvedValue(null);

vi.mock("@echo-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: vi.fn().mockResolvedValue([]),
}));

const {
  writeCache,
  readCache,
  cleanupExpired,
  generateCacheKey,
} = await import("@echo-agent/db/repos/recall-cache.js");

import type { RankedRecallResult } from "@echo-agent/knowledge/ranking.js";

const NOW = new Date("2026-04-06T12:00:00Z");

function entry(id: number): RankedRecallResult {
  return {
    id,
    kind: "memo",
    title: `entry ${id}`,
    summary: "summary",
    contentMd: "content",
    similarity: 0.5,
    confidence: null,
    status: "active",
    pinned: false,
    validUntil: null,
    validFrom: NOW,
    updatedAt: NOW,
    sourceRefs: {},
    tags: [],
    score: 0.5,
  };
}

describe("recall-cache repo (recall_cache_entries backend)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── writeCache ───────────────────────────────────────────────

  describe("writeCache", () => {
    it("upserts directly into recall_cache_entries with computed expires_at", async () => {
      mockExecute.mockResolvedValueOnce(1);
      const before = Date.now();
      const result = await writeCache("rcl-test-key", [entry(1), entry(2)]);
      const after = Date.now();

      // No folder bootstrap any more — only ONE DB call (the upsert)
      expect(mockQueryOne).not.toHaveBeenCalled();
      expect(mockExecute).toHaveBeenCalledTimes(1);

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO recall_cache_entries");
      expect(sql).toContain("ON CONFLICT (cache_key) DO UPDATE");
      expect(sql).toContain("SET payload = EXCLUDED.payload");
      expect(sql).toContain("expires_at = EXCLUDED.expires_at");

      // Params: cache_key, payload (JSON string), expires_at (ISO)
      expect(params[0]).toBe("rcl-test-key");
      const payload = JSON.parse(params[1] as string);
      expect(payload).toHaveLength(2);
      expect(payload[0].id).toBe(1);
      expect(payload[1].id).toBe(2);

      // expires_at is ~15 minutes after the call, returned as ISO
      const expiresMs = new Date(params[2] as string).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 100);
      expect(expiresMs).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 100);

      expect(result.cacheKey).toBe("rcl-test-key");
      expect(result.expiresAt).toBe(params[2]);
    });

    it("payload is the same JSON written to the row (sanity)", async () => {
      mockExecute.mockResolvedValueOnce(1);
      await writeCache("k", [entry(7)]);
      const [, params] = mockExecute.mock.calls[0];
      const payload = JSON.parse(params[1] as string);
      expect(payload[0].id).toBe(7);
      expect(payload[0].kind).toBe("memo");
      expect(payload[0].title).toBe("entry 7");
    });
  });

  // ── readCache ────────────────────────────────────────────────

  describe("readCache", () => {
    it("returns parsed entries with expiresAt when fresh row exists", async () => {
      const expiresAt = "2026-04-06T12:15:00Z";
      const cached = [
        {
          id: 1,
          kind: "memo",
          title: "t",
          summary: "s",
          contentMd: "c",
          similarity: 0.5,
          confidence: null,
          status: "active",
          pinned: false,
          validUntil: null,
          sourceRefs: {},
          tags: [],
        },
      ];
      // node-postgres returns JSONB as parsed object — pass an array directly
      mockQueryOne.mockResolvedValueOnce({
        payload: cached,
        expires_at: expiresAt,
      });
      const result = await readCache("rcl-test-key");
      expect(result).not.toBeNull();
      expect(result?.results).toHaveLength(1);
      expect(result?.results[0]?.id).toBe(1);
      expect(result?.expiresAt).toBe(new Date(expiresAt).toISOString());

      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("FROM recall_cache_entries");
      expect(sql).toContain("WHERE cache_key = $1");
      expect(sql).toContain("expires_at > NOW()");
      expect(params).toEqual(["rcl-test-key"]);
    });

    it("returns null when row missing or expired (DB filters via WHERE expires_at > NOW())", async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await readCache("missing")).toBeNull();
    });

    it("returns empty results when payload is not an array (defensive)", async () => {
      mockQueryOne.mockResolvedValueOnce({
        payload: { not: "an array" },
        expires_at: "2026-04-06T12:15:00Z",
      });
      const result = await readCache("bad");
      expect(result).not.toBeNull();
      expect(result?.results).toEqual([]);
    });
  });

  // ── cleanupExpired ───────────────────────────────────────────

  describe("cleanupExpired", () => {
    it("issues DELETE on expired recall_cache_entries", async () => {
      mockExecute.mockResolvedValueOnce(3);
      const deleted = await cleanupExpired();
      expect(deleted).toBe(3);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("DELETE FROM recall_cache_entries");
      expect(sql).toContain("WHERE expires_at < NOW()");
      // No params now — DB time only
      expect(params).toBeUndefined();
    });
  });

  // ── generateCacheKey (unchanged — pure function) ─────────────

  describe("generateCacheKey", () => {
    const baseFilters = { k: 8, kind: undefined, includeExpired: true };

    it("differs across queries", () => {
      const a = generateCacheKey("hello", baseFilters, NOW);
      const b = generateCacheKey("world", baseFilters, NOW);
      expect(a).not.toBe(b);
    });

    it("differs across `k` values for the same query", () => {
      const a = generateCacheKey("hello", { ...baseFilters, k: 5 }, NOW);
      const b = generateCacheKey("hello", { ...baseFilters, k: 12 }, NOW);
      expect(a).not.toBe(b);
    });

    it("differs across `kind` filters for the same query", () => {
      const a = generateCacheKey("hello", { ...baseFilters, kind: "memo" }, NOW);
      const b = generateCacheKey("hello", { ...baseFilters, kind: "risk_rule" }, NOW);
      expect(a).not.toBe(b);
    });

    it("differs across `includeExpired` for the same query", () => {
      const a = generateCacheKey("hello", { ...baseFilters, includeExpired: true }, NOW);
      const b = generateCacheKey("hello", { ...baseFilters, includeExpired: false }, NOW);
      expect(a).not.toBe(b);
    });

    it("differs across milliseconds within the same minute", () => {
      const a = generateCacheKey("hello", baseFilters, new Date("2026-04-06T12:00:00.000Z"));
      const b = generateCacheKey("hello", baseFilters, new Date("2026-04-06T12:00:00.001Z"));
      expect(a).not.toBe(b);
    });

    it("is reproducible for fully-identical input", () => {
      const t = new Date("2026-04-06T12:00:00.123Z");
      const a = generateCacheKey("hello", baseFilters, t);
      const b = generateCacheKey("hello", baseFilters, t);
      expect(a).toBe(b);
    });

    it("matches expected shape rcl-YYYYMMDD-<16hex>", () => {
      const key = generateCacheKey("hello", baseFilters, new Date("2026-04-06T12:00:00Z"));
      expect(key).toMatch(/^rcl-20260406-[0-9a-f]{16}$/);
    });
  });
});
