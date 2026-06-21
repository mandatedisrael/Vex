import { describe, it, expect, vi, afterEach } from "vitest";
import { DEXSCREENER_HANDLERS } from "../../../vex-agent/tools/protocols/dexscreener/handlers.js";
import { DEXSCREENER_TOOLS } from "../../../vex-agent/tools/protocols/dexscreener/manifest.js";
import { getDexScreenerClient } from "@tools/dexscreener/client.js";
import type { DexBoost, DexPair, DexTokenProfile } from "@tools/dexscreener/types.js";

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
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  it("dexscreener.pairs fails without chainId and pairAddress", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.pairs"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chainId");
  });

  it("dexscreener.pairs fails with only chainId", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.pairs"]!(
      { chainId: "ethereum" },
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("pairAddress");
  });

  it("dexscreener.tokens fails without chainId and tokenAddresses", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.tokens"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chainId");
  });

  it("dexscreener.tokens fails with only chainId", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.tokens"]!(
      { chainId: "ethereum" },
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("tokenAddresses");
  });

  it("dexscreener.tokenPairs fails without chainId and tokenAddress", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chainId");
  });

  it("dexscreener.tokenPairs fails with only chainId", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      { chainId: "solana" },
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("tokenAddress");
  });

  it("dexscreener.orders fails without chainId and tokenAddress", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.orders"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chainId");
  });

  it("dexscreener.orders fails with only chainId", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.orders"]!(
      { chainId: "solana" },
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("tokenAddress");
  });

  // ── Read-only handlers return data (no wallet needed) ────────────

  it("dexscreener.search returns pairs for a known query", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.search"]!(
      { query: "USDC" },
      { sessionPermission: "restricted", approved: false },
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
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.profiles)).toBe(true);
  });

  it("dexscreener.boosts returns boosts array", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.boosts"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.boosts)).toBe(true);
  });

  it("dexscreener.trending returns merged items", async () => {
    const result = await DEXSCREENER_HANDLERS["dexscreener.trending"]!(
      { limit: 5 },
      { sessionPermission: "restricted", approved: false },
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
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.ads)).toBe(true);
  });
});

// ── Deterministic sort / limit / projection (no live network) ──────
//
// These spy on the shared singleton client (`getDexScreenerClient()`) so the
// handler's sort/limit/projection logic is exercised against crafted fixtures
// instead of `https://api.dexscreener.com`. Spies are restored after each test
// so the live-network integration tests above stay untouched.

const PERM = { sessionPermission: "restricted" as const, approved: false };

/** Minimal valid `DexPair` fixture — only the fields the handler/projector read matter. */
function makePair(overrides: Partial<DexPair>): DexPair {
  return {
    chainId: "solana",
    dexId: "raydium",
    url: "https://dexscreener.com/solana/abc",
    pairAddress: "PAIRabc",
    labels: null,
    baseToken: { address: "BASE", name: "Base", symbol: "BASE" },
    quoteToken: { address: "QUOTE", name: "Quote", symbol: "QUOTE" },
    priceNative: "1",
    priceUsd: "1.00",
    txns: { h24: { buys: 1, sells: 1 } },
    volume: { h24: 1000 },
    priceChange: { h24: 0 },
    liquidity: { usd: 0, base: 0, quote: 0 },
    fdv: 0,
    marketCap: 0,
    pairCreatedAt: 0,
    info: { imageUrl: "https://img/x.png", websites: null, socials: null },
    boosts: { active: 0 },
    ...overrides,
  };
}

describe("dexscreener.tokenPairs sort / limit / projection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sorts pairs by liquidity.usd descending", async () => {
    const client = getDexScreenerClient();
    const pairs: DexPair[] = [
      makePair({ dexId: "low", liquidity: { usd: 10, base: 1, quote: 1 } }),
      makePair({ dexId: "high", liquidity: { usd: 1000, base: 1, quote: 1 } }),
      makePair({ dexId: "mid", liquidity: { usd: 500, base: 1, quote: 1 } }),
    ];
    vi.spyOn(client, "getTokenPairs").mockResolvedValue(pairs);

    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      { chainId: "solana", tokenAddress: "TOKEN" },
      PERM,
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.pairs.map((x: { dexId: string }) => x.dexId)).toEqual(["high", "mid", "low"]);
  });

  it("sinks null-liquidity pairs to the bottom (null-coalesced to -Infinity)", async () => {
    const client = getDexScreenerClient();
    const pairs: DexPair[] = [
      makePair({ dexId: "nullLiq", liquidity: { usd: null, base: 0, quote: 0 } }),
      makePair({ dexId: "noLiqBlock", liquidity: null }),
      makePair({ dexId: "real", liquidity: { usd: 5, base: 1, quote: 1 } }),
    ];
    vi.spyOn(client, "getTokenPairs").mockResolvedValue(pairs);

    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      { chainId: "solana", tokenAddress: "TOKEN" },
      PERM,
    );
    const data = JSON.parse(result.output);
    expect(data.pairs[0].dexId).toBe("real");
    expect(data.pairs.length).toBe(3);
  });

  it("applies limit when provided (top-N after sort)", async () => {
    const client = getDexScreenerClient();
    const pairs: DexPair[] = [
      makePair({ dexId: "a", liquidity: { usd: 10, base: 1, quote: 1 } }),
      makePair({ dexId: "b", liquidity: { usd: 1000, base: 1, quote: 1 } }),
      makePair({ dexId: "c", liquidity: { usd: 500, base: 1, quote: 1 } }),
    ];
    vi.spyOn(client, "getTokenPairs").mockResolvedValue(pairs);

    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      { chainId: "solana", tokenAddress: "TOKEN", limit: 2 },
      PERM,
    );
    const data = JSON.parse(result.output);
    expect(data.pairCount).toBe(2);
    expect(data.pairs.map((x: { dexId: string }) => x.dexId)).toEqual(["b", "c"]);
  });

  it("returns all pairs (no truncation) when limit is omitted", async () => {
    const client = getDexScreenerClient();
    const pairs: DexPair[] = Array.from({ length: 30 }, (_, i) =>
      makePair({ dexId: `dex${i}`, liquidity: { usd: i, base: 1, quote: 1 } }),
    );
    vi.spyOn(client, "getTokenPairs").mockResolvedValue(pairs);

    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      { chainId: "solana", tokenAddress: "TOKEN" },
      PERM,
    );
    const data = JSON.parse(result.output);
    expect(data.pairCount).toBe(30);
  });

  it("projects pairs concisely — drops info/url/boosts/txns/volume/priceChange, keeps pairAddress", async () => {
    const client = getDexScreenerClient();
    vi.spyOn(client, "getTokenPairs").mockResolvedValue([
      makePair({
        chainId: "ethereum",
        dexId: "uniswap",
        labels: ["v3"],
        liquidity: { usd: 42, base: 1, quote: 2 },
        fdv: 100,
        marketCap: 90,
        pairCreatedAt: 1700000000,
        priceUsd: "3.14",
      }),
    ]);

    const result = await DEXSCREENER_HANDLERS["dexscreener.tokenPairs"]!(
      { chainId: "ethereum", tokenAddress: "TOKEN" },
      PERM,
    );
    const data = JSON.parse(result.output);
    const pair = data.pairs[0];

    // KEEP
    expect(pair.chainId).toBe("ethereum");
    expect(pair.dexId).toBe("uniswap");
    expect(pair.pairAddress).toBe("PAIRabc"); // load-bearing for the zap pool-address workflow
    expect(pair.baseToken).toEqual({ address: "BASE", name: "Base", symbol: "BASE" });
    expect(pair.quoteToken).toEqual({ address: "QUOTE", name: "Quote", symbol: "QUOTE" });
    expect(pair.priceUsd).toBe("3.14");
    expect(pair.liquidity).toEqual({ usd: 42, base: 1, quote: 2 });
    expect(pair.fdv).toBe(100);
    expect(pair.marketCap).toBe(90);
    expect(pair.pairCreatedAt).toBe(1700000000);
    expect(pair.labels).toEqual(["v3"]);

    // DROP
    expect(pair.info).toBeUndefined();
    expect(pair.url).toBeUndefined();
    expect(pair.boosts).toBeUndefined();
    expect(pair.txns).toBeUndefined();
    expect(pair.volume).toBeUndefined();
    expect(pair.priceChange).toBeUndefined();
  });
});

describe("dexscreener.trending default limit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to 20 results when limit is omitted", async () => {
    const client = getDexScreenerClient();
    // 25 distinct boosted tokens → merged feed of 25, default limit must trim to 20.
    const boosts: DexBoost[] = Array.from({ length: 25 }, (_, i) => ({
      url: `https://dexscreener.com/solana/t${i}`,
      chainId: "solana",
      tokenAddress: `TOKEN${i}`,
      amount: 25 - i,
      totalAmount: 25 - i,
      icon: null,
      header: null,
      description: null,
      links: null,
    }));
    const profiles: DexTokenProfile[] = [];
    vi.spyOn(client, "getBoosts").mockResolvedValue(boosts);
    vi.spyOn(client, "getProfiles").mockResolvedValue(profiles);

    const result = await DEXSCREENER_HANDLERS["dexscreener.trending"]!({}, PERM);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.count).toBe(20);
    expect(data.items.length).toBe(20);
  });

  it("respects an explicit limit over the default", async () => {
    const client = getDexScreenerClient();
    const boosts: DexBoost[] = Array.from({ length: 25 }, (_, i) => ({
      url: `https://dexscreener.com/solana/t${i}`,
      chainId: "solana",
      tokenAddress: `TOKEN${i}`,
      amount: 25 - i,
      totalAmount: 25 - i,
      icon: null,
      header: null,
      description: null,
      links: null,
    }));
    vi.spyOn(client, "getBoosts").mockResolvedValue(boosts);
    vi.spyOn(client, "getProfiles").mockResolvedValue([]);

    const result = await DEXSCREENER_HANDLERS["dexscreener.trending"]!({ limit: 5 }, PERM);
    const data = JSON.parse(result.output);
    expect(data.count).toBe(5);
  });
});
