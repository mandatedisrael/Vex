import { describe, it, expect } from "vitest";
import { POLYMARKET_HANDLERS } from "../../../echo-agent/tools/protocols/polymarket/handlers.js";
import { POLYMARKET_TOOLS } from "../../../echo-agent/tools/protocols/polymarket/manifest.js";

describe("polymarket handlers (bridge + clob + data + gamma)", () => {
  it("handler for every manifest toolId", () => {
    const keys = new Set(Object.keys(POLYMARKET_HANDLERS));
    const missing = POLYMARKET_TOOLS.map(t => t.toolId).filter(id => !keys.has(id));
    expect(missing).toEqual([]);
  });

  it("no extra handlers", () => {
    const ids = new Set(POLYMARKET_TOOLS.map(t => t.toolId));
    expect(Object.keys(POLYMARKET_HANDLERS).filter(k => !ids.has(k))).toEqual([]);
  });

  it("handler count matches manifest (79)", () => {
    expect(Object.keys(POLYMARKET_HANDLERS)).toHaveLength(79);
  });

  it("every handler is a function", () => {
    for (const [, h] of Object.entries(POLYMARKET_HANDLERS)) expect(typeof h).toBe("function");
  });

  // Bridge param validation
  it("bridge.deposit fails without address", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.deposit"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("address");
  });
  it("bridge.quote fails without params", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.quote"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("fromAmountBaseUnit");
  });
  it("bridge.status fails without address", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.status"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("address");
  });

  // CLOB market data param validation
  it("clob.orderbook fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.orderbook"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.price fails without tokenId/side", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.price"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.prices fails without tokenIds/sides", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.prices"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenIds");
  });
  it("clob.midpoint fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.midpoint"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.spread fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.spread"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.lastTrade fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.lastTrade"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.priceHistory fails without market", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.priceHistory"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("market");
  });
  it("clob.tickSize fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.tickSize"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.feeRate fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.feeRate"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });

  // CLOB trading param validation
  it("clob.buy fails without required", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.buy"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("conditionId");
  });
  it("clob.sell fails without required", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.sell"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("conditionId");
  });
  it("clob.cancel fails without orderId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancel"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("orderId");
  });
  it("clob.cancelOrders fails without orderIds", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelOrders"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("orderIds");
  });
  it("clob.cancelMarket fails without market/assetId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelMarket"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("market");
  });
  it("clob.order fails without orderId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.order"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("orderId");
  });
  it("clob.orderScoring fails without orderId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.orderScoring"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("orderId");
  });

  // Data param validation
  it("data.positions fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.positions"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.closedPositions fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.closedPositions"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.activity fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.activity"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.value fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.value"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.traded fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.traded"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.holders fails without market", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.holders"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("market");
  });
  it("data.liveVolume fails without eventId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.liveVolume"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("eventId");
  });
  it("data.marketPositions fails without market", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.marketPositions"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("market");
  });
  it("data.accountingSnapshot fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.accountingSnapshot"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });

  // Gamma param validation
  it("gamma.event fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.event"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.eventBySlug fails without slug", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.eventBySlug"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("slug");
  });
  it("gamma.market fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.market"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.search fails without query", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.search"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("query");
  });
  it("gamma.tag fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.tag"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.seriesById fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.seriesById"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.comment fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.comment"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.comments rejects parentEntityId without parentEntityType (R10)", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.comments"]!(
      { parentEntityId: 12345 },
      { loopMode: "off", approved: false },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("parentEntityType");
  });

  it("gamma.commentsByUser fails without address", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.commentsByUser"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("address");
  });
  it("gamma.profile fails without address", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.profile"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("address");
  });

  // Live read-only
  it("bridge.assets returns data", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.assets"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(true);
    const d = JSON.parse(r.output);
    expect(typeof d.count).toBe("number");
  });
});
