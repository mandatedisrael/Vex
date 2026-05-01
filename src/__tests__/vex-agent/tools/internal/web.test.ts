import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock search cache repo
const mockGetCached = vi.fn().mockResolvedValue(null);
const mockCacheResult = vi.fn().mockResolvedValue(undefined);
const mockGetCachedFetch = vi.fn().mockResolvedValue(null);
const mockCacheFetchResult = vi.fn().mockResolvedValue(undefined);

vi.mock("@vex-agent/db/repos/search.js", () => ({
  getCached: (...args: unknown[]) => mockGetCached(...args),
  cacheResult: (...args: unknown[]) => mockCacheResult(...args),
  getCachedFetch: (...args: unknown[]) => mockGetCachedFetch(...args),
  cacheFetchResult: (...args: unknown[]) => mockCacheFetchResult(...args),
}));

// Mock Tavily SDK so we can assert timeout option + simulate hangs without
// hitting the network. Each test resets these via vi.clearAllMocks().
const mockTavilySearch = vi.fn();
const mockTavilyExtract = vi.fn();
vi.mock("@tavily/core", () => ({
  tavily: () => ({ search: mockTavilySearch, extract: mockTavilyExtract }),
}));

const { handleWebSearch, handleWebFetch } = await import("../../../../vex-agent/tools/internal/web.js");
import { makeTestContext } from "../_test-context.js";

const baseContext = makeTestContext();

describe("web handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── web_search ────────────────────────────────────────────────────

  describe("handleWebSearch", () => {
    it("fails on missing query", async () => {
      const result = await handleWebSearch({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("query");
    });

    it("returns cached results when available", async () => {
      mockGetCached.mockResolvedValueOnce([
        { title: "Test", url: "https://example.com", content: "cached content" },
      ]);

      const result = await handleWebSearch({ query: "test" }, baseContext);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.count).toBe(1);
      expect(parsed.results[0].title).toBe("Test");
      expect(mockCacheResult).not.toHaveBeenCalled();
    });

    it("fails gracefully without TAVILY_API_KEY", async () => {
      const origKey = process.env.TAVILY_API_KEY;
      delete process.env.TAVILY_API_KEY;

      const result = await handleWebSearch({ query: "test" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("TAVILY_API_KEY");

      if (origKey) process.env.TAVILY_API_KEY = origKey;
    });

    // Regression: Tavily SDK calls without a timeout could wedge the engine
    // for the full 600 s loop budget when upstream hung (observed live as
    // 694 s+ stuck spinner). Pin `timeout: 30` and assert SDK rejection
    // surfaces as a clean fail() — no rethrow, no infinite wait, no cache
    // write. See node_modules/@tavily/core/dist/index.js:113 — SDK respects
    // the option at runtime.
    it("passes timeout: 30 to the Tavily search SDK", async () => {
      const origKey = process.env.TAVILY_API_KEY;
      process.env.TAVILY_API_KEY = "test-key";
      mockTavilySearch.mockResolvedValueOnce({ results: [] });

      await handleWebSearch({ query: "x" }, baseContext);
      expect(mockTavilySearch).toHaveBeenCalledTimes(1);
      const [, opts] = mockTavilySearch.mock.calls[0]!;
      expect((opts as { timeout?: number }).timeout).toBe(30);

      if (origKey) process.env.TAVILY_API_KEY = origKey; else delete process.env.TAVILY_API_KEY;
    });

    it("returns a clean failure when Tavily search times out", async () => {
      const origKey = process.env.TAVILY_API_KEY;
      process.env.TAVILY_API_KEY = "test-key";
      mockTavilySearch.mockRejectedValueOnce(new Error("Request timed out after 30000ms"));

      const result = await handleWebSearch({ query: "stuck-query" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output.toLowerCase()).toMatch(/timed out|timeout|failed/);
      // Failure path must not write to cache.
      expect(mockCacheResult).not.toHaveBeenCalled();

      if (origKey) process.env.TAVILY_API_KEY = origKey; else delete process.env.TAVILY_API_KEY;
    });
  });

  // ── web_fetch ─────────────────────────────────────────────────────

  describe("handleWebFetch", () => {
    it("fails on missing url", async () => {
      const result = await handleWebFetch({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("url");
    });

    it("fails on non-http url", async () => {
      const result = await handleWebFetch({ url: "ftp://example.com" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("http");
    });

    it("fails on plain string (not a url)", async () => {
      const result = await handleWebFetch({ url: "just-some-text" }, baseContext);
      expect(result.success).toBe(false);
    });

    it("returns cached fetch when available", async () => {
      mockGetCachedFetch.mockResolvedValueOnce({
        markdown: "# Hello World\n\nCached content",
        title: "Hello World",
      });

      const result = await handleWebFetch({ url: "https://example.com" }, baseContext);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.title).toBe("Hello World");
      expect(parsed.content).toContain("Cached content");
    });

    it("passes timeout: 25 to the Tavily extract SDK", async () => {
      const origKey = process.env.TAVILY_API_KEY;
      process.env.TAVILY_API_KEY = "test-key";
      mockTavilyExtract.mockResolvedValueOnce({
        results: [{ rawContent: "# Doc\n\nbody", url: "https://example.com" }],
      });

      await handleWebFetch({ url: "https://example.com/doc" }, baseContext);
      expect(mockTavilyExtract).toHaveBeenCalledTimes(1);
      const [, opts] = mockTavilyExtract.mock.calls[0]!;
      expect((opts as { timeout?: number }).timeout).toBe(25);

      if (origKey) process.env.TAVILY_API_KEY = origKey; else delete process.env.TAVILY_API_KEY;
    });
  });
});
