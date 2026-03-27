import { describe, it, expect } from "vitest";
import { KYBERSWAP_HANDLERS } from "../../../echo-agent/tools/protocols/kyberswap/handlers.js";
import { KYBERSWAP_TOOLS } from "../../../echo-agent/tools/protocols/kyberswap/manifest.js";

describe("kyberswap handlers", () => {
  // ── Handler coverage ─────────────────────────────────────────────

  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(KYBERSWAP_HANDLERS));
    const manifestIds = KYBERSWAP_TOOLS.map(t => t.toolId);
    const missing = manifestIds.filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(KYBERSWAP_TOOLS.map(t => t.toolId));
    const handlerKeys = Object.keys(KYBERSWAP_HANDLERS);
    const extra = handlerKeys.filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count (19)", () => {
    expect(Object.keys(KYBERSWAP_HANDLERS)).toHaveLength(19);
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(KYBERSWAP_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation ────────────────────────────────────

  it("kyberswap.tokens.search fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.tokens.search"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.tokens.check fails without chain and address", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.tokens.check"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.swap.quote fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.swap.sell fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.sell"]!(
      { chain: "ethereum", tokenIn: "ETH" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.list fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.list"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.activeMakingAmount fails without chain and makerAsset", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.activeMakingAmount"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("makerAsset");
  });

  it("kyberswap.limitOrder.create fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.create"]!(
      { chain: "ethereum", makerAsset: "USDC" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.cancel fails without chain and orderId", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.cancel"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("orderId");
  });

  it("kyberswap.limitOrder.hardCancel fails without chain and orderId", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.hardCancel"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.pairs fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.pairs"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.fill fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.fill"]!(
      { chain: "ethereum", orderId: 123 },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.batchFill fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.batchFill"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.cancelAll fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.cancelAll"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.zap.in fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      { chain: "ethereum", dex: "uniswapv3" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.zap.out fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.out"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.zap.migrate fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.migrate"]!(
      { chain: "ethereum", dexFrom: "uniswapv3" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  // ── Read-only handlers return data (no wallet needed) ────────────

  it("kyberswap.chains returns chain list", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.chains"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(20);
    expect(data[0].slug).toBeDefined();
    expect(data[0].chainId).toBeDefined();
    expect(data[0].aggregator).toBeDefined();
  });
});
