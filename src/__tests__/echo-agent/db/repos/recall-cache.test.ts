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

describe("recall-cache repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── writeCache ───────────────────────────────────────────────

  describe("writeCache", () => {
    it("ensures cache folder then upserts cache row in documents(space='cache')", async () => {
      // First call: SELECT folder by slug — miss
      // Second call: INSERT folder, returns id
      // Third call: INSERT into documents (via execute)
      mockQueryOne
        .mockResolvedValueOnce(null) // folder lookup miss
        .mockResolvedValueOnce({ id: 7 }); // folder insert returning id
      mockExecute.mockResolvedValueOnce(1);

      const result = await writeCache("rcl-test-key", [entry(1), entry(2)]);

      expect(mockQueryOne).toHaveBeenCalledTimes(2);
      // Folder lookup
      const [lookupSql, lookupParams] = mockQueryOne.mock.calls[0];
      expect(lookupSql).toContain("FROM folders");
      expect(lookupSql).toContain("space = $1");
      expect(lookupSql).toContain("parent_id IS NULL");
      expect(lookupParams[0]).toBe("cache");

      // Folder insert
      const [insertFolderSql, insertFolderParams] = mockQueryOne.mock.calls[1];
      expect(insertFolderSql).toContain("INSERT INTO folders");
      expect(insertFolderParams[0]).toBe("cache");

      // Document upsert
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [docSql, docParams] = mockExecute.mock.calls[0];
      expect(docSql).toContain("INSERT INTO documents");
      expect(docSql).toContain("ON CONFLICT (space, folder_id, slug)");
      expect(docSql).toContain("DO UPDATE SET content_md");
      expect(docParams[0]).toBe("cache");
      expect(docParams[1]).toBe(7); // folder id
      expect(docParams[3]).toBe("rcl-test-key"); // slug

      // content_md is JSON
      const contentMd = docParams[4] as string;
      const parsed = JSON.parse(contentMd);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe(1);
      expect(parsed[1].id).toBe(2);

      // expiresAt is ISO timestamp
      expect(typeof result.expiresAt).toBe("string");
      expect(result.cacheKey).toBe("rcl-test-key");
    });

    it("reuses existing folder when present", async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 7 }); // folder lookup hit
      mockExecute.mockResolvedValueOnce(1);

      await writeCache("rcl-test-key", [entry(1)]);
      // Only one queryOne call (lookup) — no folder insert
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });
  });

  // ── readCache ────────────────────────────────────────────────

  describe("readCache", () => {
    it("returns parsed entries with expiresAt when fresh row exists", async () => {
      const updatedAt = "2026-04-06T12:00:00Z";
      const cached = [
        { id: 1, kind: "memo", title: "t", summary: "s", contentMd: "c", similarity: 0.5, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] },
      ];
      mockQueryOne.mockResolvedValueOnce({
        content_md: JSON.stringify(cached),
        updated_at: updatedAt,
      });
      const result = await readCache("rcl-test-key");
      expect(result).not.toBeNull();
      expect(result?.results).toHaveLength(1);
      expect(result?.results[0]?.id).toBe(1);
      expect(result?.expiresAt).toBeTruthy();

      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("FROM documents");
      expect(sql).toContain("space = $1");
      expect(sql).toContain("slug = $2");
      expect(sql).toContain("INTERVAL '15 minutes'");
      expect(sql).toContain("updated_at > now() - INTERVAL");
      expect(params).toEqual(["cache", "rcl-test-key"]);
    });

    it("returns null when row missing or expired", async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await readCache("missing")).toBeNull();
    });

    it("returns null when content_md is invalid JSON", async () => {
      mockQueryOne.mockResolvedValueOnce({
        content_md: "not json",
        updated_at: "2026-04-06T12:00:00Z",
      });
      expect(await readCache("bad")).toBeNull();
    });
  });

  // ── cleanupExpired ───────────────────────────────────────────

  describe("cleanupExpired", () => {
    it("issues DELETE on cache space older than TTL", async () => {
      mockExecute.mockResolvedValueOnce(3);
      const deleted = await cleanupExpired();
      expect(deleted).toBe(3);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("DELETE FROM documents");
      expect(sql).toContain("space = $1");
      expect(sql).toContain("INTERVAL '15 minutes'");
      expect(sql).toContain("updated_at < now() - INTERVAL");
      expect(params).toEqual(["cache"]);
    });
  });

  // ── generateCacheKey (post fix 2) ────────────────────────────

  describe("generateCacheKey", () => {
    const baseFilters = { k: 8, kind: undefined, includeExpired: true };

    it("differs across queries (fix 2 — full filter set + ms precision)", () => {
      const a = generateCacheKey("hello", baseFilters, NOW);
      const b = generateCacheKey("world", baseFilters, NOW);
      expect(a).not.toBe(b);
    });

    it("differs across `k` values for the same query (was a collision before fix 2)", () => {
      const a = generateCacheKey("hello", { ...baseFilters, k: 5 }, NOW);
      const b = generateCacheKey("hello", { ...baseFilters, k: 12 }, NOW);
      expect(a).not.toBe(b);
    });

    it("differs across `kind` filters for the same query (was a collision before fix 2)", () => {
      const a = generateCacheKey("hello", { ...baseFilters, kind: "memo" }, NOW);
      const b = generateCacheKey("hello", { ...baseFilters, kind: "risk_rule" }, NOW);
      expect(a).not.toBe(b);
    });

    it("differs across `includeExpired` for the same query (was a collision before fix 2)", () => {
      const a = generateCacheKey("hello", { ...baseFilters, includeExpired: true }, NOW);
      const b = generateCacheKey("hello", { ...baseFilters, includeExpired: false }, NOW);
      expect(a).not.toBe(b);
    });

    it("differs across milliseconds within the same minute (was a collision before fix 2)", () => {
      const a = generateCacheKey("hello", baseFilters, new Date("2026-04-06T12:00:00.000Z"));
      const b = generateCacheKey("hello", baseFilters, new Date("2026-04-06T12:00:00.001Z"));
      expect(a).not.toBe(b);
    });

    it("is reproducible for fully-identical input (same query, filters, ms)", () => {
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
