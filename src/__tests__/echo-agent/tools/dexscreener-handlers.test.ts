import { describe, it, expect } from "vitest";
import { DEXSCREENER_HANDLERS } from "../../../echo-agent/tools/protocols/dexscreener/handlers.js";
import { DEXSCREENER_TOOLS } from "../../../echo-agent/tools/protocols/dexscreener/manifest.js";

describe("dexscreener handlers", () => {
  // ── Handler coverage ─────────────────────────────────────────────

  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(DEXSCREENER_HANDLERS));
    const manifestIds = DEXSCREENER_TOOLS.map(t => t.toolId);
    const missing = manifestIds.filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(DEXSCREENER_TOOLS.map(t => t.toolId));
    const handlerKeys = Object.keys(DEXSCREENER_HANDLERS);
    const extra = handlerKeys.filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count (11)", () => {
    expect(Object.keys(DEXSCREENER_HANDLERS)).toHaveLength(11);
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(DEXSCREENER_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation ────────────────────────────────────

  it("dexscreener.search fails without query", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.search"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  it("dexscreener.pairs fails without chainId and pairAddress", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.pairs"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chainId");
  });

  it("dexscreener.pairs fails with only chainId", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.pairs"]!(
      { chainId: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("pairAddress");
  });

  it("dexscreener.tokens fails without chainId and tokenAddresses", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.tokens"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chainId");
  });

  it("dexscreener.tokens fails with only chainId", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.tokens"]!(
      { chainId: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("tokenAddresses");
  });

  it("dexscreener.tokenPairs fails without chainId and tokenAddress", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chainId");
  });

  it("dexscreener.tokenPairs fails with only chainId", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      { chainId: "solana" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("tokenAddress");
  });

  it("dexscreener.orders fails without chainId and tokenAddress", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.orders"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chainId");
  });

  it("dexscreener.orders fails with only chainId", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.orders"]!(
      { chainId: "solana" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("tokenAddress");
  });

  // ── Read-only handlers return data (no wallet needed) ────────────

  it("dexscreener.search returns pairs for a known query", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.search"]!(
      { query: "USDC" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.query).toBe("USDC");
    expect(typeof data.pairCount).toBe("number");
    expect(Array.isArray(data.pairs)).toBe(true);
  });

  it("dexscreener.profiles returns profiles array", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.profiles"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.profiles)).toBe(true);
  });

  it("dexscreener.boosts returns boosts array", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.boosts"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.boosts)).toBe(true);
  });

  it("dexscreener.trending returns merged items", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.trending"]!(
      { limit: 5 },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(typeof data.count).toBe("number");
    expect(data.count).toBeLessThanOrEqual(5);
    expect(Array.isArray(data.items)).toBe(true);
    if (data.items.length > 0) {
      expect(data.items[0].chainId).toBeDefined();
      expect(data.items[0].tokenAddress).toBeDefined();
      expect(typeof data.items[0].boostTotalAmount).toBe("number");
      expect(typeof data.items[0].hasProfile).toBe("boolean");
    }
  });

  it("dexscreener.ads returns ads array", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.ads"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.ads)).toBe(true);
  });
});
