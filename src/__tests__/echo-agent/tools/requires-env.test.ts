import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock 0G compute to avoid .cts loading
vi.mock("@tools/0g-compute/readiness.js", () => ({
  loadComputeState: () => null,
}));

const { getOpenAITools, getAllTools } = await import(
  "../../../echo-agent/tools/registry.js"
);
const { discoverProtocolCapabilities } = await import(
  "../../../echo-agent/tools/protocols/runtime.js"
);
const { executeProtocolTool } = await import(
  "../../../echo-agent/tools/protocols/runtime.js"
);

describe("requiresEnv filtering", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.JUPITER_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── Internal tools (registry) ──────────────────────────────────

  describe("internal tools (registry)", () => {
    it("hides web_search when TAVILY_API_KEY not set", () => {
      const tools = getOpenAITools("off");
      const hasWebSearch = tools.some(t => t.function.name === "web_search");
      expect(hasWebSearch).toBe(false);
    });

    it("hides web_fetch when TAVILY_API_KEY not set", () => {
      const tools = getOpenAITools("off");
      const hasWebFetch = tools.some(t => t.function.name === "web_fetch");
      expect(hasWebFetch).toBe(false);
    });

    it("shows web_search when TAVILY_API_KEY is set", () => {
      process.env.TAVILY_API_KEY = "tvly-test-key-12345678";
      const tools = getOpenAITools("off");
      const hasWebSearch = tools.some(t => t.function.name === "web_search");
      expect(hasWebSearch).toBe(true);
    });

    it("shows web_fetch when TAVILY_API_KEY is set", () => {
      process.env.TAVILY_API_KEY = "tvly-test-key-12345678";
      const tools = getOpenAITools("off");
      const hasWebFetch = tools.some(t => t.function.name === "web_fetch");
      expect(hasWebFetch).toBe(true);
    });

    it("non-ENV tools always present regardless of ENV state", () => {
      const tools = getOpenAITools("off");
      const hasDiscover = tools.some(t => t.function.name === "discover_tools");
      const hasFileRead = tools.some(t => t.function.name === "document_read");
      expect(hasDiscover).toBe(true);
      expect(hasFileRead).toBe(true);
    });

    it("all knowledge_* tools are visible without EMBEDDING_BASE_URL (decision #10: no requiresEnv)", () => {
      delete process.env.EMBEDDING_BASE_URL;
      const tools = getOpenAITools("off");
      const names = tools.map(t => t.function.name);
      expect(names).toContain("knowledge_write");
      expect(names).toContain("knowledge_recall");
      expect(names).toContain("knowledge_recall_overflow");
      expect(names).toContain("knowledge_get");
      expect(names).toContain("knowledge_update_status");
      expect(names).toContain("knowledge_supersede");
    });

    it("knowledge_* tools have NO requiresEnv field (visible always, fail loud at runtime)", () => {
      const all = getAllTools();
      const knowledgeTools = all.filter(t => t.name.startsWith("knowledge_"));
      // 5 original (write / recall / recall_overflow / get / update_status) + 1 supersede.
      expect(knowledgeTools.length).toBe(6);
      for (const tool of knowledgeTools) {
        expect(tool.requiresEnv).toBeUndefined();
      }
    });

    it("getAllTools still returns all tools including ENV-gated ones", () => {
      const all = getAllTools();
      const webSearch = all.find(t => t.name === "web_search");
      expect(webSearch).toBeDefined();
      expect(webSearch!.requiresEnv).toBe("TAVILY_API_KEY");
    });
  });

  // ── Protocol tools (discovery) ─────────────────────────────────

  describe("protocol discovery", () => {
    it("hides ALL solana tools when JUPITER_API_KEY not set", () => {
      const result = discoverProtocolCapabilities({
        namespace: "solana",
        includeMutating: true,
      });
      expect(result.count).toBe(0);
    });

    it("shows all 20 solana tools when JUPITER_API_KEY is set", () => {
      process.env.JUPITER_API_KEY = "test-jupiter-key";
      const result = discoverProtocolCapabilities({
        namespace: "solana",
        includeMutating: true,
        limit: 100,
      });
      expect(result.count).toBe(20);
    });

    it("khalani tools unaffected by JUPITER_API_KEY", () => {
      const result = discoverProtocolCapabilities({ namespace: "khalani" });
      expect(result.count).toBeGreaterThan(0);
    });

    it("total tool count is higher with JUPITER_API_KEY", () => {
      const without = discoverProtocolCapabilities({ includeMutating: true, limit: 300 });
      process.env.JUPITER_API_KEY = "test-key";
      const withKey = discoverProtocolCapabilities({ includeMutating: true, limit: 300 });
      expect(withKey.totalCount).toBe(without.totalCount + 20);
    });
  });

  // ── Protocol execute guard ─────────────────────────────────────

  describe("protocol execute guard", () => {
    it("blocks solana.swap.quote without JUPITER_API_KEY", async () => {
      const result = await executeProtocolTool(
        { toolId: "solana.swap.quote", params: { inputToken: "SOL", outputToken: "USDC", amount: 1 } },
        { loopMode: "off", approved: false },
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("JUPITER_API_KEY");
    });

    it("blocks solana.tokens.search without JUPITER_API_KEY", async () => {
      const result = await executeProtocolTool(
        { toolId: "solana.tokens.search", params: { query: "SOL" } },
        { loopMode: "off", approved: false },
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("JUPITER_API_KEY");
    });

    it("blocks solana.predict.events without JUPITER_API_KEY", async () => {
      const result = await executeProtocolTool(
        { toolId: "solana.predict.events", params: {} },
        { loopMode: "off", approved: false },
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("JUPITER_API_KEY");
    });

    it("blocks solana.lend.rates without JUPITER_API_KEY", async () => {
      const result = await executeProtocolTool(
        { toolId: "solana.lend.rates", params: {} },
        { loopMode: "off", approved: false },
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("JUPITER_API_KEY");
    });
  });
});
