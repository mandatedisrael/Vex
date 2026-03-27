import { describe, it, expect } from "vitest";
import { SLOP_HANDLERS } from "../../../echo-agent/tools/protocols/0g/slop/handlers.js";
import { SLOP_TOOLS } from "../../../echo-agent/tools/protocols/0g/slop/manifest.js";

describe("slop handlers", () => {
  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(SLOP_HANDLERS));
    const missing = SLOP_TOOLS.map(t => t.toolId).filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(SLOP_TOOLS.map(t => t.toolId));
    const extra = Object.keys(SLOP_HANDLERS).filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count (13)", () => {
    expect(Object.keys(SLOP_HANDLERS)).toHaveLength(13);
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(SLOP_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // Required param validation
  it("slop.token.create fails without name and symbol", async () => {
    const result = await SLOP_HANDLERS["slop.token.create"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("name");
  });

  it("slop.token.info fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.token.info"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("slop.token.info fails with invalid address", async () => {
    const result = await SLOP_HANDLERS["slop.token.info"]!({ token: "not-addr" }, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid address");
  });

  it("slop.trade.buy fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.trade.buy"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("slop.trade.buy fails without amountOg", async () => {
    const result = await SLOP_HANDLERS["slop.trade.buy"]!({ token: "0x1234567890abcdef1234567890abcdef12345678" }, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("amountOg");
  });

  it("slop.trade.sell fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.trade.sell"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("slop.trade.sell fails without amountTokens", async () => {
    const result = await SLOP_HANDLERS["slop.trade.sell"]!({ token: "0x1234567890abcdef1234567890abcdef12345678" }, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("amountTokens");
  });

  it("slop.price fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.price"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("slop.curve fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.curve"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("slop.fees.stats fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.fees.stats"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("slop.fees.claimCreator fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.fees.claimCreator"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("slop.reward.pending fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.reward.pending"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("slop.reward.claim fails without token", async () => {
    const result = await SLOP_HANDLERS["slop.reward.claim"]!({}, { loopMode: "off", approved: false });
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });
});
