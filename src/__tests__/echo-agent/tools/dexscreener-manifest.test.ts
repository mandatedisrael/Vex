import { describe, it, expect } from "vitest";
import { DEXSCREENER_TOOLS } from "../../../echo-agent/tools/protocols/dexscreener/manifest.js";

describe("dexscreener manifest", () => {
  // ── Completeness ─────────────────────────────────────────────────

  it("has 11 tools total", () => {
    expect(DEXSCREENER_TOOLS).toHaveLength(11);
  });

  const EXPECTED_TOOL_IDS = [
    // Core (4)
    "dexscreener.search",
    "dexscreener.pairs",
    "dexscreener.tokens",
    "dexscreener.tokenPairs",
    // Trending (5)
    "dexscreener.profiles",
    "dexscreener.boosts",
    "dexscreener.boosts.top",
    "dexscreener.communityTakeovers",
    "dexscreener.trending",
    // Orders & Ads (2)
    "dexscreener.orders",
    "dexscreener.ads",
  ];

  it("expected toolId count matches manifest count", () => {
    expect(EXPECTED_TOOL_IDS).toHaveLength(11);
  });

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      const tool = DEXSCREENER_TOOLS.find(t => t.toolId === toolId);
      expect(tool).toBeDefined();
    });
  }

  it("has no tools beyond expected list", () => {
    const expectedSet = new Set(EXPECTED_TOOL_IDS);
    const unexpected = DEXSCREENER_TOOLS.filter(t => !expectedSet.has(t.toolId));
    expect(unexpected).toHaveLength(0);
  });

  // ── Namespace ────────────────────────────────────────────────────

  it("all tools belong to dexscreener namespace", () => {
    for (const tool of DEXSCREENER_TOOLS) {
      expect(tool.namespace).toBe("dexscreener");
    }
  });

  it("all tools are active lifecycle", () => {
    for (const tool of DEXSCREENER_TOOLS) {
      expect(tool.lifecycle).toBe("active");
    }
  });

  it("all toolIds start with dexscreener.", () => {
    for (const tool of DEXSCREENER_TOOLS) {
      expect(tool.toolId).toMatch(/^dexscreener\./);
    }
  });

  // ── Mutating flags (all read-only) ────────────────────────────────

  it("all tools are read-only (not mutating)", () => {
    for (const tool of DEXSCREENER_TOOLS) {
      expect(tool.mutating).toBe(false);
    }
  });

  it("has zero mutating tools", () => {
    const mutating = DEXSCREENER_TOOLS.filter(t => t.mutating);
    expect(mutating).toHaveLength(0);
  });

  // ── Required params ──────────────────────────────────────────────

  it("dexscreener.search requires query", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.search")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["query"]);
  });

  it("dexscreener.pairs requires chainId, pairAddress", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.pairs")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("chainId");
    expect(required).toContain("pairAddress");
  });

  it("dexscreener.tokens requires chainId, tokenAddresses", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.tokens")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("chainId");
    expect(required).toContain("tokenAddresses");
  });

  it("dexscreener.tokenPairs requires chainId, tokenAddress", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.tokenPairs")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("chainId");
    expect(required).toContain("tokenAddress");
  });

  it("dexscreener.orders requires chainId, tokenAddress", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.orders")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("chainId");
    expect(required).toContain("tokenAddress");
  });

  it("dexscreener.profiles has no required params", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.profiles")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  it("dexscreener.boosts has no required params", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.boosts")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  it("dexscreener.boosts.top has no required params", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.boosts.top")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  it("dexscreener.communityTakeovers has no required params", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.communityTakeovers")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  it("dexscreener.trending has no required params", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.trending")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  it("dexscreener.ads has no required params", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.ads")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  // ── No requiresEnv (DexScreener is free) ─────────────────────────

  it("no tools require ENV", () => {
    for (const tool of DEXSCREENER_TOOLS) {
      expect(tool.requiresEnv).toBeUndefined();
    }
  });

  // ── Descriptions quality ──────────────────────────────────────────

  it("every tool has non-empty description", () => {
    for (const tool of DEXSCREENER_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(15);
    }
  });

  it("every param has non-empty description", () => {
    for (const tool of DEXSCREENER_TOOLS) {
      for (const param of tool.params) {
        expect(param.description.length).toBeGreaterThan(3);
      }
    }
  });
});
