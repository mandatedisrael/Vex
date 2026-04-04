import { describe, it, expect } from "vitest";
import { POLYMARKET_TOOLS } from "../../../echo-agent/tools/protocols/polymarket/manifest.js";

describe("polymarket manifest (bridge + clob + data + gamma)", () => {
  it("has 79 tools total", () => {
    expect(POLYMARKET_TOOLS).toHaveLength(79);
  });

  const EXPECTED_TOOL_IDS = [
    // Bridge (5)
    "polymarket.bridge.assets", "polymarket.bridge.deposit", "polymarket.bridge.withdraw",
    "polymarket.bridge.quote", "polymarket.bridge.status",
    // CLOB Market Data (15)
    "polymarket.clob.orderbook", "polymarket.clob.orderbooks",
    "polymarket.clob.price", "polymarket.clob.prices",
    "polymarket.clob.midpoint", "polymarket.clob.midpoints",
    "polymarket.clob.spread", "polymarket.clob.spreads",
    "polymarket.clob.lastTrade", "polymarket.clob.lastTrades",
    "polymarket.clob.priceHistory", "polymarket.clob.batchPriceHistory",
    "polymarket.clob.tickSize", "polymarket.clob.feeRate", "polymarket.clob.serverTime",
    // CLOB Trading (11)
    "polymarket.clob.buy", "polymarket.clob.sell",
    "polymarket.clob.cancel", "polymarket.clob.cancelOrders",
    "polymarket.clob.cancelAll", "polymarket.clob.cancelMarket",
    "polymarket.clob.orders", "polymarket.clob.order",
    "polymarket.clob.trades", "polymarket.clob.heartbeat",
    "polymarket.clob.orderScoring",
    // CLOB Misc (2)
    "polymarket.clob.simplifiedMarkets", "polymarket.clob.rebates",
    // Data (14)
    "polymarket.data.positions", "polymarket.data.closedPositions",
    "polymarket.data.activity", "polymarket.data.trades",
    "polymarket.data.value", "polymarket.data.traded",
    "polymarket.data.holders", "polymarket.data.openInterest",
    "polymarket.data.liveVolume", "polymarket.data.marketPositions",
    "polymarket.data.leaderboard", "polymarket.data.builderLeaderboard",
    "polymarket.data.builderVolume", "polymarket.data.accountingSnapshot",
    // Gamma (25)
    "polymarket.gamma.events", "polymarket.gamma.event", "polymarket.gamma.eventBySlug", "polymarket.gamma.eventTags",
    "polymarket.gamma.markets", "polymarket.gamma.market", "polymarket.gamma.marketBySlug", "polymarket.gamma.marketTags",
    "polymarket.gamma.search",
    "polymarket.gamma.tags", "polymarket.gamma.tag", "polymarket.gamma.tagBySlug",
    "polymarket.gamma.relatedTags", "polymarket.gamma.relatedTagsBySlug",
    "polymarket.gamma.tagsRelatedToTag", "polymarket.gamma.tagsRelatedToTagBySlug",
    "polymarket.gamma.series", "polymarket.gamma.seriesById",
    "polymarket.gamma.comments", "polymarket.gamma.comment", "polymarket.gamma.commentsByUser",
    "polymarket.gamma.profile",
    "polymarket.gamma.sportsMetadata", "polymarket.gamma.sportsMarketTypes", "polymarket.gamma.teams",
    // Rewards (7)
    "polymarket.rewards.active", "polymarket.rewards.market", "polymarket.rewards.multi",
    "polymarket.rewards.earnings", "polymarket.rewards.totalEarnings",
    "polymarket.rewards.percentages", "polymarket.rewards.userMarkets",
  ];

  it("expected count matches", () => { expect(EXPECTED_TOOL_IDS).toHaveLength(79); });

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      expect(POLYMARKET_TOOLS.find(t => t.toolId === toolId)).toBeDefined();
    });
  }

  it("has no extra tools", () => {
    const s = new Set(EXPECTED_TOOL_IDS);
    expect(POLYMARKET_TOOLS.filter(t => !s.has(t.toolId))).toHaveLength(0);
  });

  it("all polymarket namespace", () => { for (const t of POLYMARKET_TOOLS) expect(t.namespace).toBe("polymarket"); });
  it("all active lifecycle", () => { for (const t of POLYMARKET_TOOLS) expect(t.lifecycle).toBe("active"); });
  it("all toolIds start with polymarket.", () => { for (const t of POLYMARKET_TOOLS) expect(t.toolId).toMatch(/^polymarket\./); });

  const EXPECTED_MUTATING = [
    "polymarket.bridge.deposit", "polymarket.bridge.withdraw",
    "polymarket.clob.buy", "polymarket.clob.sell",
    "polymarket.clob.cancel", "polymarket.clob.cancelOrders",
    "polymarket.clob.cancelAll", "polymarket.clob.cancelMarket",
    "polymarket.clob.heartbeat",
  ];

  it("correct mutating count (9)", () => { expect(POLYMARKET_TOOLS.filter(t => t.mutating)).toHaveLength(9); });
  for (const id of EXPECTED_MUTATING) {
    it(`${id} is mutating`, () => { expect(POLYMARKET_TOOLS.find(t => t.toolId === id)!.mutating).toBe(true); });
  }
  it("read-only not mutating", () => {
    const m = new Set(EXPECTED_MUTATING);
    for (const t of POLYMARKET_TOOLS.filter(t => !m.has(t.toolId))) expect(t.mutating).toBe(false);
  });

  it("CLOB trading tools require POLYMARKET_API_KEY", () => {
    const authTools = POLYMARKET_TOOLS.filter(t => t.toolId.startsWith("polymarket.clob.") && t.requiresEnv);
    expect(authTools.length).toBeGreaterThan(0);
    for (const t of authTools) expect(t.requiresEnv).toBe("POLYMARKET_API_KEY");
  });

  it("every tool has description", () => { for (const t of POLYMARKET_TOOLS) expect(t.description.length).toBeGreaterThan(15); });
  it("every param has description", () => {
    for (const t of POLYMARKET_TOOLS) for (const p of t.params) expect(p.description.length).toBeGreaterThan(3);
  });
});
