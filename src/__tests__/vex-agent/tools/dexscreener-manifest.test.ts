import { describe, it, expect } from "vitest";
import { DEXSCREENER_TOOLS } from "../../../vex-agent/tools/protocols/dexscreener/manifest.js";

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

  it("dexscreener.tokenPairs declares an optional numeric limit", () => {
    const tool = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.tokenPairs")!;
    const limit = tool.params.find(p => p.key === "limit");
    expect(limit).toBeDefined();
    expect(limit!.type).toBe("number");
    // Optional: limit must NOT be required (no hardcoded default; omit ⇒ all pairs).
    expect(limit!.required).toBeFalsy();
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

  // ── Retrieval metadata ───────────────────────────────────────────

  it("every tool has retrieval-only embedding text", () => {
    for (const tool of DEXSCREENER_TOOLS) {
      expect(
        tool.discovery?.embeddingText,
        `${tool.toolId} missing discovery.embeddingText`,
      ).toBeTruthy();
      expect(tool.discovery!.embeddingText!.length).toBeGreaterThan(80);
    }
  });

  // Note: assertions check intent-level content the agent-style refactor
  // preserves. Implementation-detail phrases ("pair analytics", "Batch
  // lookup", "marketing legitimacy", "unified DEX Screener trending
  // discovery") were API-doc jargon and were intentionally replaced with
  // user-intent phrasing in the new passages.

  it("core market-data embeddings capture search, pair, token, and liquidity intent", () => {
    const search = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.search")!;
    const pairs = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.pairs")!;
    const tokens = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.tokens")!;
    const tokenPairs = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.tokenPairs")!;
    expect(search.discovery?.embeddingText).toContain("Search trading pairs");
    expect(search.discovery?.embeddingText).toContain("contract address");
    expect(pairs.discovery?.embeddingText).toContain("Full analytics");
    expect(pairs.discovery?.embeddingText).toContain("liquidity");
    expect(tokens.discovery?.embeddingText).toContain("up to 30 token contract addresses");
    expect(tokens.discovery?.embeddingText?.toLowerCase()).toContain("batch pricing");
    expect(tokenPairs.discovery?.embeddingText).toContain("every pool");
    expect(tokenPairs.discovery?.embeddingText).toContain("most liquidity");
  });

  it("trend embeddings capture boosted, profile, community takeover, and unified trending intent", () => {
    const profiles = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.profiles")!;
    const boosts = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.boosts")!;
    const topBoosts = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.boosts.top")!;
    const communityTakeovers = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.communityTakeovers")!;
    const trending = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.trending")!;
    expect(profiles.discovery?.embeddingText).toContain("latest token profiles");
    expect(profiles.discovery?.embeddingText?.toLowerCase()).toContain("newly listed");
    expect(boosts.discovery?.embeddingText).toContain("latest tokens that received paid boosts");
    expect(boosts.discovery?.embeddingText?.toLowerCase()).toContain("promoted");
    expect(topBoosts.discovery?.embeddingText).toContain("most active boosts");
    expect(topBoosts.discovery?.embeddingText?.toLowerCase()).toContain("ranked by total boost amount");
    expect(communityTakeovers.discovery?.embeddingText).toContain("community takeover");
    expect(communityTakeovers.discovery?.embeddingText).toContain("CTO");
    expect(trending.discovery?.embeddingText?.toLowerCase()).toContain("unified ranked feed");
    expect(trending.discovery?.embeddingText?.toLowerCase()).toContain("trending");
  });

  it("orders and ads embeddings capture paid promotion verification intent", () => {
    const orders = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.orders")!;
    const ads = DEXSCREENER_TOOLS.find(t => t.toolId === "dexscreener.ads")!;
    expect(orders.discovery?.embeddingText).toContain("paid promotional orders");
    expect(orders.discovery?.embeddingText?.toLowerCase()).toContain("marketing");
    expect(ads.discovery?.embeddingText).toContain("ad placements");
    expect(ads.discovery?.embeddingText?.toLowerCase()).toContain("visibility");
  });
});
